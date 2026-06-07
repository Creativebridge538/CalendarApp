import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  const body = await request.json()
  const { email, password, display_name, real_name, phone, reward_rate } = body

  if (!email || !password || !display_name) {
    return NextResponse.json({ error: 'email, password, display_name は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError) {
    const message = createError.message.includes('already registered')
      ? 'このメールアドレスは既に登録されています'
      : createError.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: updateError } = await admin.from('users').update({
    role: 'cast',
    store_id: profile.store_id,
    display_name,
    real_name: real_name || null,
    phone: phone || null,
    reward_rate: parseFloat(reward_rate) || 0.4,
    is_active: true,
  }).eq('id', newUser.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'プロフィール設定に失敗しました' }, { status: 500 })
  }

  const { data: cast } = await admin.from('users')
    .select('id, display_name, real_name, phone, reward_rate, is_active, email')
    .eq('id', newUser.user.id)
    .single()

  return NextResponse.json({ cast })
}
