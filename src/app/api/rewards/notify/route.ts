import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  const { cast_id, from, to, total_reward, notice_id } = await request.json()
  if (!cast_id || !from || !to) {
    return NextResponse.json({ error: 'cast_id, from, to は必須です' }, { status: 400 })
  }

  // 任意送信の通知なので、APIキー未設定でもエラーにせずスキップする
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ sent: false, reason: 'RESEND_API_KEY未設定' })
  }

  const admin = createAdminClient()
  const { data: cast } = await admin.from('users').select('email, display_name').eq('id', cast_id).single()
  if (!cast?.email) {
    return NextResponse.json({ sent: false, reason: 'メールアドレスが見つかりません' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const periodLabel = `${from}〜${to}`
  const amountLabel = typeof total_reward === 'number' ? `¥${total_reward.toLocaleString()}` : null
  const origin = new URL(request.url).origin
  const noticeUrl = `${origin}/admin/rewards/notice?cast_id=${cast_id}&from=${from}&to=${to}${notice_id ? `&notice_id=${notice_id}` : ''}`

  try {
    await resend.emails.send({
      from: 'CalendarApp <onboarding@resend.dev>',
      to: cast.email,
      subject: `${periodLabel}分の支払通知書が届いています`,
      html: `
        <p>${cast.display_name ?? ''} 様</p>
        <p>${periodLabel}分の支払通知書が届いています。${amountLabel ? `<br>お支払額: ${amountLabel}` : ''}</p>
        <p><a href="${noticeUrl}">支払通知書を見る</a></p>
        <p style="color:#888;font-size:12px;">アプリにログインした状態でこのリンクを開くと、支払通知書をそのままプレビューできます。</p>
      `,
    })
    return NextResponse.json({ sent: true })
  } catch {
    return NextResponse.json({ sent: false, reason: '送信に失敗しました' })
  }
}
