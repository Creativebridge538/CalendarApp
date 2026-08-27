import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await isPlatformOwner(supabase, user?.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: signup } = await admin.from('store_signup_requests').select('*').eq('id', id).single()
  if (!signup) return NextResponse.json({ error: '申込が見つかりません' }, { status: 404 })
  if (signup.status !== 'pending') {
    return NextResponse.json({ error: 'この申込は既に処理済みです' }, { status: 400 })
  }

  // inviteUserByEmail は既存メールアドレスでもエラーを返さず既存ユーザーをそのまま返すことがあるため、
  // 事前にチェックしておかないと既存店舗の管理者アカウントを別店舗に付け替えてしまう恐れがある
  const { data: existingUser } = await admin.from('users').select('id').eq('email', signup.contact_email).maybeSingle()
  if (existingUser) {
    return NextResponse.json({ error: 'このメールアドレスは既に登録されています' }, { status: 400 })
  }

  const { data: store, error: storeError } = await admin.from('stores')
    .insert({ name: signup.store_name, contact_name: signup.contact_name, contact_email: signup.contact_email })
    .select().single()
  if (storeError || !store) {
    return NextResponse.json({ error: '店舗の作成に失敗しました' }, { status: 500 })
  }

  const { error: settingsError } = await admin.from('store_settings').insert({ store_id: store.id })
  if (settingsError) {
    await admin.from('stores').delete().eq('id', store.id)
    return NextResponse.json({ error: '店舗設定の作成に失敗しました' }, { status: 500 })
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(signup.contact_email)
  if (inviteError || !invited.user) {
    await admin.from('store_settings').delete().eq('store_id', store.id)
    await admin.from('stores').delete().eq('id', store.id)
    const message = inviteError?.message.includes('already registered')
      ? 'このメールアドレスは既に登録されています'
      : '招待メールの送信に失敗しました'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: updateError } = await admin.from('users').update({
    role: 'admin',
    store_id: store.id,
    display_name: signup.contact_name,
    phone: signup.phone,
  }).eq('id', invited.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(invited.user.id)
    await admin.from('store_settings').delete().eq('store_id', store.id)
    await admin.from('stores').delete().eq('id', store.id)
    return NextResponse.json({ error: '管理者アカウントの設定に失敗しました' }, { status: 500 })
  }

  await admin.from('store_signup_requests').update({
    status: 'approved',
    created_store_id: store.id,
    reviewed_by: user!.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true, store_id: store.id })
}
