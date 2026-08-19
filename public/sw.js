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

  const badgeCount = typeof data.badge === 'number' ? data.badge : 1

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      setAppBadge(badgeCount),
      // Service Worker側でのAPI呼び出しが効かない環境向けの保険として、
      // 開いているページ（window/navigatorコンテキスト）側でも試させる
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) client.postMessage({ type: 'set-app-badge', count: badgeCount })
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
// 見つかった場所を順番に全部試す（1つの実装だけに賭けない）。
// 完全に非アクティブな状態からのプッシュではiOS側の制約で反映されないことがあるが、
// アプリが開いている・開いた直後は機能するため、ベストエフォートとして残す
function badgeTargets() {
  const targets = []
  if (self.registration && self.registration.setAppBadge) targets.push(self.registration)
  if (self.navigator && self.navigator.setAppBadge) targets.push(self.navigator)
  if (self.setAppBadge) targets.push(self)
  return targets
}

function setAppBadge(count) {
  const targets = badgeTargets()
  // 成功したwindow側の単体テストはsetAppBadge(1)と数値を渡していた。
  // 引数なしのsetAppBadge()は「未指定」を表す別の呼び方で、実装によって挙動が違う可能性があるため揃える
  return Promise.all(targets.map(t => t.setAppBadge(count).catch(() => {})))
}

function clearAppBadge() {
  const targets = badgeTargets()
  return Promise.all(targets.map(t => t.clearAppBadge().catch(() => {})))
}
