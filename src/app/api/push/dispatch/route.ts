import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  hasArbitraryPayload, isAllowedNotificationLink, MAX_DISPATCH_PER_REQUEST, MAX_PUSH_PER_MINUTE, PENDING_WINDOW_MINUTES,
} from '@/lib/push-dispatch'

// Web Pushの送信。宛先・タイトル・本文・リンクはリクエストから一切受け取らない。
// DB内の専用経路（RPC・トリガー）が notifications に作成した通知のうち、
//   ・呼び出し元自身が作成した(created_by = 自分)
//   ・まだ送信していない(push_sent_at is null)
//   ・直近PENDING_WINDOW_MINUTES分以内に作成された
//   ・宛先が呼び出し元と同じ店舗
// ものだけを、保存されている title/body/link のまま1回だけ送る。送信対象は先に push_sent_at を立てて確保する
// （同時・連続の呼び出しでも二重送信しない）。Push失敗は再送しない（アプリ内通知とDB処理は完了済み）。
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  // 任意の宛先・文面・リンクの指定は受け付けない（ボディは空でなければならない）
  const raw = await request.text()
  if (raw.trim() !== '') {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 }) }
    if (hasArbitraryPayload(parsed)) return NextResponse.json({ error: '宛先・文面・リンクは指定できません' }, { status: 400 })
  }

  const { data: me, error: meError } = await supabase.from('users').select('store_id').eq('id', user.id).single()
  if (meError) { console.error('[push/dispatch] users fetch failed', meError); return NextResponse.json({ error: '確認に失敗しました' }, { status: 500 }) }
  if (!me?.store_id) return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    // codeは呼び出し元（ブラウザ）が原因別に文言を出し分けるための機械可読な識別子。
    // errorの日本語文言は変更せず維持する（既存の呼び出し元はcodeを見ずerrorだけ使っても壊れない）
    return NextResponse.json({ error: 'Push送信の設定が未完了です', code: 'vapid_not_configured' }, { status: 500 })
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)

  const admin = createAdminClient()

  // v18レビュー対応（Push不具合①）: 1回のdispatchで処理できるのは最大MAX_DISPATCH_PER_REQUEST件
  // （claim_pending_push_notificationsのDB側ハード上限）であり、それを超える未送信が残っている場合、
  // 呼び出し元（dispatchPush()）が「まだ残っているか」を知る手段がこれまで無かった（結果だけ見て
  // 「全件成功」と誤認する原因になっていた）。
  //
  // claim_pending_push_notificationsと同じpending window（直近PENDING_WINDOW_MINUTES分以内）で
  // 絞り込む。DEVでの実API検証で判明した点: windowを掛けずに「push_sent_at未設定」を無条件に数えると、
  // window期限切れで元から二度とclaimされない古い通知（既存の、本migrationより前からの取り残し等）が
  // 常に1件以上残り続け、remainingが恒久的に0にならず、dispatchPush()側のループが（進展が無いまま）
  // 無意味に繰り返されたり、実際には今回分を全件処理し終えているのに毎回「未完了」と表示され続ける
  // 結果になった。windowを合わせることで、「今まさに処理を続けられる対象が残っているか」を正しく表す。
  const countRemaining = async () => {
    const { count, error } = await admin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', user.id)
      .is('push_sent_at', null)
      .gte('created_at', new Date(Date.now() - PENDING_WINDOW_MINUTES * 60_000).toISOString())
    if (error) {
      console.error('[push/dispatch] remaining count failed', error)
      // 件数が確認できない場合は「残っているかもしれない」側に倒す（falseの0件断定はしない）
      return null
    }
    return count ?? 0
  }

  // 連続送信の抑止（直近1分の件数確認）と、未送信通知の確保(push_sent_at設定)を、DB関数1つ・1トランザクションで
  // 原子的に行う（claim_pending_push_notifications。呼び出し元単位のアドバイザリロックで直列化）。
  // 別クエリのままだと、同じ呼び出し元から同時に複数リクエストが来た場合、両方が確認の時点では古い（上限未満の）
  // 件数を見て、それぞれ別々の通知をclaimしてしまい、合計がMAX_PUSH_PER_MINUTEを超える可能性があった。
  //
  // このRPCはPUBLIC/anon/authenticatedにEXECUTEが無く、service_role専用（誰の通知でも指定できるp_user_idを
  // 引数に取り、宛先user_idを含む通知行を返すため、ブラウザから直接呼べてはならない）。呼び出し元の本人確認は
  // 上のsupabase（ユーザーのセッション）のauth.getUser()で既に完了しているため、そのuser.idをadmin client
  // （service_role）経由でRPCへ明示的に渡す。取得に失敗した場合は「対象0件・成功」を返さない（失敗を隠さない）。
  const { data: claimed, error: claimError } = await admin.rpc('claim_pending_push_notifications', {
    p_user_id: user.id,
    p_max_per_minute: MAX_PUSH_PER_MINUTE,
    p_pending_window_minutes: PENDING_WINDOW_MINUTES,
    p_max_batch: MAX_DISPATCH_PER_REQUEST,
  })
  if (claimError) {
    if (claimError.code === '23514') return NextResponse.json({ error: '送信が多すぎます。しばらくしてからお試しください', code: 'rate_limited' }, { status: 429 })
    console.error('[push/dispatch] claim failed', claimError)
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 })
  }
  if (!claimed?.length) {
    return NextResponse.json({ total: 0, delivered: 0, failed: 0, noSubscription: 0, remaining: await countRemaining() })
  }

  // 二重の安全確認: 他店舗宛・許可されないリンクの通知は送らない（DBの制約で通常は起こらない）
  const sendable = claimed.filter(n => n.store_id === me.store_id && isAllowedNotificationLink(n.link))
  const skipped = claimed.length - sendable.length

  // ここから先で失敗すると、対象の通知は push_sent_at 済み（＝確保済み）のまま、実際には送信を試みていない状態になり得る。
  // 「送信を試みて失敗した」ものは再送しない設計（アプリ内通知とDB処理は完了済みのため。以下のPush送信自体の失敗は再送しない）だが、
  // 送信を試みる前段階（購読の取得）で失敗した場合は、確保を解除（push_sent_at を戻す）して次回のdispatch呼び出しで
  // 再試行できるようにし、呼び出し元へも失敗として返す（「送信済み扱いのまま消える」ことを防ぐ）。
  const recipientIds = [...new Set(sendable.map(n => n.user_id))]
  const { data: subscriptions, error: subsError } = recipientIds.length
    ? await admin.from('push_subscriptions').select('*').in('user_id', recipientIds)
    : { data: [], error: null }
  if (subsError) {
    console.error('[push/dispatch] subscriptions fetch failed', subsError)
    const { error: unclaimError } = await admin.from('notifications').update({ push_sent_at: null }).in('id', sendable.map(n => n.id))
    if (unclaimError) console.error('[push/dispatch] unclaim after subscriptions failure also failed', unclaimError)
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 })
  }
  const subsByUser = new Map<string, NonNullable<typeof subscriptions>>()
  for (const s of subscriptions ?? []) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s])

  // ホーム画面アイコンのバッジ用に、宛先ごとの未読件数を反映する。これは付随情報（ベストエフォート）のため、
  // 取得に失敗しても送信自体は中断せず、バッジは1件扱い（フォールバック）にする
  const unreadByUser = new Map<string, number>()
  await Promise.all(recipientIds.map(async id => {
    const { count, error } = await admin.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', id).is('read_at', null)
    if (error) console.error('[push/dispatch] unread count failed', { user_id: id, error })
    unreadByUser.set(id, count ?? 1)
  }))

  let delivered = 0
  let failed = skipped
  let noSubscription = 0
  const staleIds: string[] = []
  await Promise.all(sendable.map(async n => {
    const subs = subsByUser.get(n.user_id) ?? []
    if (subs.length === 0) { noSubscription++; delivered++; return }
    const payload = JSON.stringify({ title: n.title, body: n.body ?? undefined, link: n.link ?? undefined, badge: unreadByUser.get(n.user_id) ?? 1 })
    const results = await Promise.allSettled(subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)))
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const status = (r.reason as { statusCode?: number })?.statusCode
        console.error('[push/dispatch] delivery failed', { notification_id: n.id, statusCode: status })
        if (status === 404 || status === 410) staleIds.push(subs[i].id)
      }
    })
    if (results.some(r => r.status === 'fulfilled')) delivered++
    else failed++
  }))
  // 失効した購読の削除はベストエフォートの後始末。失敗しても今回の送信結果には影響しない（次回以降に無駄な送信を試みるだけ）
  if (staleIds.length) {
    const { error: staleError } = await admin.from('push_subscriptions').delete().in('id', staleIds)
    if (staleError) console.error('[push/dispatch] stale subscription cleanup failed', staleError)
  }

  // 失敗の詳細（送信先サービスの応答など）は呼び出し元へ返さない（サーバーログのみ）
  return NextResponse.json({ total: claimed.length, delivered, failed, noSubscription, remaining: await countRemaining() })
}
