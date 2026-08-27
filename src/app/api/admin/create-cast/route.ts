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
  const {
    email, password, display_name, real_name, phone, reward_rate, login_id,
    bank_name, bank_branch, bank_account_number, bank_account_holder, platform_reward_rates, daily_payment_reward_rate,
  } = body

  if (!email || !password || !display_name || !real_name || !login_id || !bank_name || !bank_branch || !bank_account_number || !bank_account_holder) {
    return NextResponse.json({ error: 'email, password, display_name, real_name, login_id, bank_name, bank_branch, bank_account_number, bank_account_holder は必須です' }, { status: 400 })
  }
  if (!/^\d{7}$/.test(bank_account_number)) {
    return NextResponse.json({ error: '口座番号は7桁の数字で入力してください' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError) {
    console.error('create-cast: createUser failed', createError)
    let message: string
    if (createError.message.includes('already registered') || createError.message.includes('already been registered')) {
      message = 'このメールアドレスは既に登録されています'
    } else if (createError.message.toLowerCase().includes('password')) {
      message = `パスワードが要件を満たしていません（${createError.message}）`
    } else if (createError.message.toLowerCase().includes('email')) {
      message = `メールアドレスが不正です（${createError.message}）`
    } else if (createError.status === 429 || createError.code === 'over_request_rate_limit' || createError.message.toLowerCase().includes('rate limit')) {
      message = 'リクエストが多すぎます。しばらく時間をおいてから再度お試しください'
    } else {
      message = `キャストの作成に失敗しました: ${createError.message}`
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: updateError } = await admin.from('users').update({
    role: 'cast',
    store_id: profile.store_id,
    display_name,
    real_name: real_name || null,
    phone: phone || null,
    reward_rate: parseFloat(reward_rate) || 0.4,
    daily_payment_reward_rate: daily_payment_reward_rate != null && daily_payment_reward_rate !== '' ? parseFloat(daily_payment_reward_rate) : null,
    platform_reward_rates: platform_reward_rates && typeof platform_reward_rates === 'object' ? platform_reward_rates : {},
    is_active: true,
    login_id,
    bank_name,
    bank_branch,
    bank_account_number,
    bank_account_holder,
  }).eq('id', newUser.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(newUser.user.id)
    const message = updateError.message.includes('duplicate') || updateError.code === '23505'
      ? 'このユーザーIDは既に使用されています'
      : `プロフィール設定に失敗しました: ${updateError.message}`
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { data: cast } = await admin.from('users')
    .select('id, display_name, real_name, phone, reward_rate, platform_reward_rates, daily_payment_reward_rate, is_active, email, login_id, bank_name, bank_branch, bank_account_number, bank_account_holder')
    .eq('id', newUser.user.id)
    .single()

  return NextResponse.json({ cast })
}
