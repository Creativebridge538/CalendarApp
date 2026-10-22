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

// Service Worker側でのsetAppBadge呼び出しが効かない環境向けの保険。
// SWがプッシュ受信時にpostMessageしてきたら、開いているページ側（navigatorコンテキスト）でも立てる
export function listenForBadgeUpdates(): void {
  if (!isPushSupported()) return
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'set-app-badge') return
    const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void> }
    nav.setAppBadge?.(event.data.count ?? 1).catch(() => {})
  })
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

export interface PushDispatchResult {
  /** リクエスト自体が成功したか */
  ok: boolean
  /** 今回送信を試みた通知の件数（複数回に分けて処理した場合は合計） */
  total: number
  /** 送信できた（または宛先の端末登録が無く送る先が無かった）通知の件数。端末未登録分を含む（noSubscriptionと重複してカウントされる） */
  delivered: number
  /** Pushの送信に実際に失敗した通知の件数（宛先の端末登録はあるが配信自体が失敗したもの）。okがfalseの場合、人数としての意味は持たない固定値1が入る（リクエスト自体が失敗したことを示すだけ） */
  failed: number
  /** 宛先の端末登録（購読）が1つも無かった通知の件数（配信の失敗ではない。delivered側にも重複して含まれる） */
  noSubscription: number
  /** okがfalseのとき、サーバーが返した機械可読な理由（'vapid_not_configured'・'rate_limited'等）。無ければ原因不明の失敗 */
  reason?: string
  /**
   * v18レビュー対応（Push不具合①）: 件数が多い・処理上限（イテレーション数／時間予算）に達した・
   * レート制限にかかった等の理由で、まだ送信を試みていない通知が残っている可能性がある場合にtrue。
   * true のときは「全件成功」として表示してはならない（呼び出し側のdescribe*関数が参照する）。
   */
  incomplete: boolean
}

/** リクエストが応答しない場合に待つ上限（ミリ秒）。業務処理（DB操作）は既に完了済みのため、
 * Push側が応答しないせいでその結果表示までいつまでも待たされることがないようにする */
const DISPATCH_TIMEOUT_MS = 10000

/**
 * v18レビュー対応（Push不具合①）: /api/push/dispatch は1回の呼び出しで最大
 * MAX_DISPATCH_PER_REQUEST（100）件しか処理できない（DB側のハード上限）。101件以上の
 * 未送信が残っている場合に備え、サーバーが返す remaining（まだpush_sent_at未設定の件数）を見て、
 * 残っている間は呼び出しを繰り返す。ただし無限ループを避けるため、繰り返し回数と合計の
 * 経過時間の両方に上限を設ける（どちらかに達したら、残っていても打ち切り、incomplete:true で返す）。
 */
const MAX_DISPATCH_ITERATIONS = 10
const DISPATCH_LOOP_BUDGET_MS = 20000

/**
 * Web Push（外部処理）の送信を依頼する。決して例外を投げない。
 * 宛先・文面・リンクは送らない。サーバーは「自分がDB内の専用経路で作成した未送信の通知」だけを、保存内容のまま送る。
 * アプリ内通知の登録・DB処理とは独立しており、失敗してもDB処理は取り消されない（呼び出し側は警告だけを出す）。
 * 101件以上が未送信の場合は、残っている間（上限まで）このRPC呼び出し自体を繰り返す。
 */
export async function dispatchPush(): Promise<PushDispatchResult> {
  let total = 0
  let delivered = 0
  let failed = 0
  let noSubscription = 0
  const loopStart = Date.now()

  for (let i = 0; i < MAX_DISPATCH_ITERATIONS; i++) {
    if (Date.now() - loopStart > DISPATCH_LOOP_BUDGET_MS) {
      // 時間予算を超えた。ここまでの集計を保ったまま「未完了」として返す（無限ループ防止）
      return { ok: true, total, delivered, failed, noSubscription, incomplete: true }
    }

    let res: Response
    try {
      res = await fetch('/api/push/dispatch', { method: 'POST', signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS) })
    } catch {
      // 1回目から通信エラーなら従来どおり「リクエスト自体が失敗」を返す。2回目以降（一部は
      // 既に処理済み）なら、その結果は捨てずに未完了として返す
      if (i === 0) return { ok: false, total: 0, delivered: 0, failed: 1, noSubscription: 0, incomplete: false }
      return { ok: true, total, delivered, failed, noSubscription, incomplete: true }
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (i === 0) return { ok: false, total: 0, delivered: 0, failed: 1, noSubscription: 0, reason: body?.code, incomplete: false }
      return { ok: true, total, delivered, failed, noSubscription, reason: body?.code, incomplete: true }
    }

    const data = (await res.json().catch(() => null)) as Partial<PushDispatchResult & { remaining: number | null }> | null
    total += data?.total ?? 0
    delivered += data?.delivered ?? 0
    failed += data?.failed ?? 0
    noSubscription += data?.noSubscription ?? 0

    const remaining = data?.remaining ?? null
    // remaining が null（サーバー側で件数を確認できなかった）の場合も、0件断定はせず未完了側に倒す
    if (remaining === 0) return { ok: true, total, delivered, failed, noSubscription, incomplete: false }
  }

  // イテレーション上限に達した（無限ループ防止）。残っている可能性があるため未完了として返す
  return { ok: true, total, delivered, failed, noSubscription, incomplete: true }
}
