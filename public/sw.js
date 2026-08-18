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
    self.registration.showNotification(title, options).then(() => updateAppBadge())
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
    }).then(() => updateAppBadge())
  )
})

// ホーム画面アイコンのバッジを、現在表示中の通知件数に合わせて更新する
function updateAppBadge() {
  if (!self.registration.getNotifications || !self.navigator || !self.navigator.setAppBadge) return Promise.resolve()
  return self.registration.getNotifications().then((notifications) => (
    notifications.length > 0
      ? self.navigator.setAppBadge(notifications.length)
      : self.navigator.clearAppBadge()
  )).catch(() => {})
}
