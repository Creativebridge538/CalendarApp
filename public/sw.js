// 新しいService Workerを即座に有効化する（バッジ対応など更新の反映待ちで
// アプリを完全に終了させないと反映されない、という事態を避けるため）
self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: '通知', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || '通知'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { link: data.link || '/' },
  }

  // 通知表示・バッジ設定・診断ログ送信は互いに独立させる（どれか1つが失敗/遅延しても
  // 他に影響しないように）。通知表示は必ず1回だけ行う
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      setAppBadge(),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'set-app-badge' })
      }).catch(() => {}),
    ])
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = event.notification.data?.link || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(link)
    }).then(() => clearAppBadge())
  )
})

// 実装によってsetAppBadgeがself.registration / self.navigator / self のどこに生えるか差があるため、
// 見つかった場所を順番に全部試す（1つの実装だけに賭けない）
function badgeTargets() {
  const targets = []
  if (self.registration && self.registration.setAppBadge) targets.push(['registration', self.registration])
  if (self.navigator && self.navigator.setAppBadge) targets.push(['navigator', self.navigator])
  if (self.setAppBadge) targets.push(['self', self])
  return targets
}

// 実機のコンソールを見なくても原因を確認できるよう、結果をサーバーにこっそり送る（通知表示には一切影響しない）。
// 原因が分かったら削除する
function reportBadgeDebug(report) {
  return fetch('/api/debug/badge-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  }).catch(() => {})
}

function setAppBadge() {
  const targets = badgeTargets()
  const report = { at: 'push', found: targets.map(([name]) => name), errors: [] }
  return Promise.all(
    targets.map(([name, t]) => t.setAppBadge().catch(e => { report.errors.push(`${name}: ${e && e.message ? e.message : e}`) }))
  ).then(() => reportBadgeDebug(report)).catch(e => reportBadgeDebug({ ...report, unexpected: String(e) }))
}

function clearAppBadge() {
  const targets = badgeTargets()
  return Promise.all(targets.map(([, t]) => t.clearAppBadge().catch(() => {})))
}
