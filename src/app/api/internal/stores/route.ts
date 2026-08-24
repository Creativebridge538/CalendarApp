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

  const { store_name, contact_name, contact_email, login_id, password } = await request.json().catch(() => ({}))
  if (!store_name || !contact_name || !contact_email || !login_id || !password) {
    return NextResponse.json({ error: '店舗名・管理者氏名・管理者メールアドレス・ユーザーID・パスワードは必須です' }, { status: 400 })
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

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: contact_email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    await admin.from('store_settings').delete().eq('store_id', store.id)
    await admin.from('stores').delete().eq('id', store.id)
    const message = createError?.message.includes('already registered') || createError?.message.includes('already been registered')
      ? 'このメールアドレスは既に登録されています'
      : `管理者アカウントの作成に失敗しました: ${createError?.message}`
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: updateError } = await admin.from('users').update({
    role: 'admin',
    store_id: store.id,
    display_name: contact_name,
    login_id,
  }).eq('id', created.user.id)

  if (updateError) {
    await admin.auth.admin.deleteUser(created.user.id)
    await admin.from('store_settings').delete().eq('store_id', store.id)
    await admin.from('stores').delete().eq('id', store.id)
    const message = updateError.message.includes('duplicate') || updateError.code === '23505'
      ? 'このユーザーIDは既に使用されています'
      : `管理者アカウントの設定に失敗しました: ${updateError.message}`
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, store })
}
