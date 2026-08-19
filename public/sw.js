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

  // バッジ設定を先に済ませてから通知を出す。並行実行だと、通知表示のタイミングで
  // iOS側がこのプッシュの処理を完了したとみなし、他の処理(バッジ設定)が完了する前に
  // Service Workerごと止めてしまっている可能性があるため、順序を入れ替えて試す。
  // 通知表示は必ず1回だけ行う（2回出すと通知自体が握りつぶされることが分かっているため）
  event.waitUntil(
    setAppBadge()
      .catch(() => {})
      .then(() => self.registration.showNotification(title, options))
      .then(() => (
        // Service Worker側でのAPI呼び出しが効かない環境向けの保険として、
        // 開いているページ（window/navigatorコンテキスト）側でも試させる（通知表示後、失敗しても無視）
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
          for (const client of clientList) client.postMessage({ type: 'set-app-badge' })
        }).catch(() => {})
      ))
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

// getNotifications()の件数に頼らず、プッシュを受けたら無条件にバッジを立てる
// （表示直後はgetNotifications()がまだ反映されていないことがあり、件数ベースだと取りこぼすため）
// 実装によってsetAppBadgeがself.registration / self.navigator / self のどこに生えるか差があるため、
// 見つかった場所を順番に全部試す（1つの実装だけに賭けない）
function badgeTargets() {
  const targets = []
  if (self.registration && self.registration.setAppBadge) targets.push(self.registration)
  if (self.navigator && self.navigator.setAppBadge) targets.push(self.navigator)
  if (self.setAppBadge) targets.push(self)
  return targets
}

function setAppBadge() {
  const targets = badgeTargets()
  return Promise.all(targets.map(t => t.setAppBadge().catch(() => {})))
}

function clearAppBadge() {
  const targets = badgeTargets()
  return Promise.all(targets.map(t => t.clearAppBadge().catch(() => {})))
}
