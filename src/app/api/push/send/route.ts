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

  if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID環境変数が未設定です' }, { status: 500 })
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const admin = createAdminClient()
  const { data: subscriptions } = await admin.from('push_subscriptions').select('*').eq('user_id', user_id)

  if (!subscriptions?.length) {
    console.error('[push/send] no subscriptions for user', { user_id })
    return NextResponse.json({ sent: 0 })
  }

  const payload = JSON.stringify({ title, body: body ?? undefined, link: link ?? undefined })

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

  results.forEach((r, i) => {
    const endpointTail = subscriptions[i].endpoint.slice(-24)
    if (r.status === 'rejected') {
      const reason = r.reason as { statusCode?: number; body?: string; message?: string }
      console.error('[push/send] delivery failed', { user_id, endpointTail, statusCode: reason?.statusCode, body: reason?.body, message: reason?.message })
    } else {
      console.log('[push/send] delivered', { user_id, endpointTail, statusCode: (r.value as { statusCode?: number })?.statusCode })
    }
  })

  const sent = results.filter(r => r.status === 'fulfilled').length
  return NextResponse.json({ sent, total: subscriptions.length })
}
