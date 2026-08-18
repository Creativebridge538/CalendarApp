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
  const { email, password, display_name, real_name, phone, reward_rate, login_id } = body

  if (!email || !password || !display_name || !real_name || !login_id) {
    return NextResponse.json({ error: 'email, password, display_name, real_name, login_id は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError) {
    console.error('create-cast: createUser failed', createError)
    const message = createError.message.includes('already registered')
      ? 'このメールアドレスは既に登録されています'
      : 'キャストの作成に失敗しました。時間をおいて再度お試しください'
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
    login_id,
  }).eq('id', newUser.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(newUser.user.id)
    const message = updateError.message.includes('duplicate') || updateError.code === '23505'
      ? 'このユーザーIDは既に使用されています'
      : 'プロフィール設定に失敗しました'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { data: cast } = await admin.from('users')
    .select('id, display_name, real_name, phone, reward_rate, is_active, email, login_id')
    .eq('id', newUser.user.id)
    .single()

  return NextResponse.json({ cast })
}
