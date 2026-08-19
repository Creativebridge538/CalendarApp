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

  // 別々のevent.waitUntil()呼び出しでは、通知表示以外の処理が完了する前に
  // Service Worker自体が終了してしまっている疑いが強いため、1つのPromise.allに
  // まとめて、通知表示を含む全処理が完了するまでSWを生かす方式に戻す。
  // 通知表示は必ず1回だけ行う（ネットワーク通信は含まないので、通知表示を巻き込んで
  // 止まるリスクは低いはず）
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

// 実機のコンソールを見なくても原因を確認できるよう、結果をブラウザのローカルキャッシュに書いておく。
// サーバーへのfetchはネットワーク往復が絡んで通知表示自体を巻き込んで止めていた疑いがあるため、
// ネットワークを使わないCache APIに変更。ページ側（notification-list.tsx）がこれを読んで画面に表示する。
// 原因が分かったら削除する
function reportBadgeDebug(report) {
  return caches.open('badge-debug-v1')
    .then(cache => cache.put('/__badge-debug__', new Response(JSON.stringify(report))))
    .catch(() => {})
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
