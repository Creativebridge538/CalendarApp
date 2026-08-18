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
      setAppBadge(),
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

// getNotifications()の件数に頼らず、プッシュを受けたら無条件にバッジを立てる
// （表示直後はgetNotifications()がまだ反映されていないことがあり、件数ベースだと取りこぼすため）
// 実装によってself.navigator.setAppBadgeとself.setAppBadgeのどちらに生えるか差があるため両方試す
function setAppBadge() {
  const fn = (self.navigator && self.navigator.setAppBadge) || self.setAppBadge
  if (!fn) return Promise.resolve()
  return fn.call(self.navigator || self).catch(() => {})
}

function clearAppBadge() {
  const fn = (self.navigator && self.navigator.clearAppBadge) || self.clearAppBadge
  if (!fn) return Promise.resolve()
  return fn.call(self.navigator || self).catch(() => {})
}
