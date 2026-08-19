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

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      setAppBadge().then(report => showBadgeDebugNotification(report)),
      // Service Worker側でのAPI呼び出しが効かない環境向けの保険として、
      // 開いているページ（window/navigatorコンテキスト）側でも試させる
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'set-app-badge' })
      }),
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

function setAppBadge() {
  const targets = badgeTargets()
  const report = { found: targets.map(([name]) => name), errors: [] }
  return Promise.all(
    targets.map(([name, t]) => t.setAppBadge().catch(e => { report.errors.push(`${name}: ${e && e.message ? e.message : e}`) }))
  ).then(() => report)
}

function clearAppBadge() {
  const targets = badgeTargets()
  return Promise.all(targets.map(([, t]) => t.clearAppBadge().catch(() => {})))
}

// 実機のコンソールを見なくても原因を確認できるよう、バッジ設定の結果を通知として出す一時的な診断用。
// 原因が分かったら削除する
function showBadgeDebugNotification(report) {
  const body = report.found.length === 0
    ? 'setAppBadgeが見つかりませんでした（registration/navigator/selfのどこにも存在しない）'
    : report.errors.length > 0
      ? `見つかった場所: ${report.found.join(', ')} / エラー: ${report.errors.join(' | ')}`
      : `見つかった場所: ${report.found.join(', ')} / エラーなしで呼び出し完了`
  return self.registration.showNotification('【診断】バッジ設定結果', { body })
}
