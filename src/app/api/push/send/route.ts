import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { user_id, title, body, link } = await request.json()
  if (!user_id || !title) {
    return NextResponse.json({ error: 'user_id, title は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 自分以外に送る場合は、同じ店舗のユーザー同士（管理者⇄キャスト等）のみ許可する
  if (user_id !== user.id) {
    const { data: caller } = await supabase.from('users').select('store_id').eq('id', user.id).single()
    const { data: target } = await admin.from('users').select('store_id').eq('id', user_id).single()
    if (!caller?.store_id || !target?.store_id || caller.store_id !== target.store_id) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }
  }

  if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID環境変数が未設定です' }, { status: 500 })
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const { data: subscriptions } = await admin.from('push_subscriptions').select('*').eq('user_id', user_id)

  if (!subscriptions?.length) {
    console.error('[push/send] no subscriptions for user', { user_id })
    return NextResponse.json({ sent: 0, total: 0 })
  }

  // ホーム画面アイコンのバッジに未読件数を反映する（setAppBadge(1)固定だと常に1のままになるため）
  const { count: unreadCount } = await admin.from('notifications')
    .select('*', { count: 'exact', head: true }).eq('user_id', user_id).is('read_at', null)

  const payload = JSON.stringify({ title, body: body ?? undefined, link: link ?? undefined, badge: unreadCount ?? 1 })

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  )

  const staleIds = subscriptions
    .filter((_, i) => {
      const r = results[i]
      return r.status === 'rejected' && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0)
    })
    .map(s => s.id)

  if (staleIds.length) {
    await admin.from('push_subscriptions').delete().in('id', staleIds)
  }

  const failures: { statusCode?: number; body?: string; message?: string }[] = []
  results.forEach((r, i) => {
    const endpointTail = subscriptions[i].endpoint.slice(-24)
    if (r.status === 'rejected') {
      const reason = r.reason as { statusCode?: number; body?: string; message?: string }
      const detail = { statusCode: reason?.statusCode, body: reason?.body, message: reason?.message }
      failures.push(detail)
      console.error('[push/send] delivery failed', { user_id, endpointTail, ...detail })
    } else {
      console.log('[push/send] delivered', { user_id, endpointTail, statusCode: (r.value as { statusCode?: number })?.statusCode })
    }
  })

  const sent = results.filter(r => r.status === 'fulfilled').length
  // 送信元にサーバーログを見せられない状況でも原因を切り分けられるよう、失敗の詳細をそのまま返す
  return NextResponse.json({ sent, total: subscriptions.length, failures: failures.length ? failures : undefined })
}
