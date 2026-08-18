import { createClient } from '@/lib/supabase/client'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getPushSubscriptionState(): Promise<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? 'subscribed' : 'unsubscribed'
}

export async function subscribeToPush(userId: string): Promise<void> {
  if (!isPushSupported()) throw new Error('このブラウザはプッシュ通知に対応していません')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知が許可されませんでした')

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('VAPID公開鍵が設定されていません')

  // ここから先はブラウザ・DB側の生の英語エラーが飛んでくる可能性があるため、
  // 呼び出し元にはユーザーに見せられる日本語メッセージに正規化して投げ直す
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    const json = subscription.toJSON()
    const supabase = createClient()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: json.endpoint!,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    }, { onConflict: 'endpoint' })
    if (error) throw error
  } catch (e) {
    console.error('subscribeToPush failed', e)
    throw new Error('プッシュ通知の登録に失敗しました')
  }
}

// アプリを開いた時点で、ホーム画面アイコンのバッジ（未読件数）をクリアする
export function clearAppBadge(): void {
  const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
  nav.clearAppBadge?.().catch(() => {})
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  const supabase = createClient()
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

// 通知テーブルへのinsertに続けて呼ぶ。プッシュ送信の失敗が呼び出し元の処理を止めないよう内部で握りつぶす
export function sendPushNotification(userId: string, title: string, body?: string | null, link?: string | null): void {
  fetch('/api/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, title, body, link }),
  }).catch(() => {})
}
