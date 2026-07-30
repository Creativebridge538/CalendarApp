import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await isPlatformOwner(supabase, user?.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { store_name, contact_name, contact_email } = await request.json().catch(() => ({}))
  if (!store_name || !contact_name || !contact_email) {
    return NextResponse.json({ error: '店舗名・管理者氏名・管理者メールアドレスは必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: existingUser } = await admin.from('users').select('id').eq('email', contact_email).maybeSingle()
  if (existingUser) {
    return NextResponse.json({ error: 'このメールアドレスは既に登録されています' }, { status: 400 })
  }

  const { data: store, error: storeError } = await admin.from('stores')
    .insert({ name: store_name }).select().single()
  if (storeError || !store) {
    return NextResponse.json({ error: '店舗の作成に失敗しました' }, { status: 500 })
  }

  const { error: settingsError } = await admin.from('store_settings').insert({ store_id: store.id })
  if (settingsError) {
    await admin.from('stores').delete().eq('id', store.id)
    return NextResponse.json({ error: '店舗設定の作成に失敗しました' }, { status: 500 })
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(contact_email)
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
    display_name: contact_name,
  }).eq('id', invited.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(invited.user.id)
    await admin.from('store_settings').delete().eq('store_id', store.id)
    await admin.from('stores').delete().eq('id', store.id)
    return NextResponse.json({ error: '管理者アカウントの設定に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, store })
}
