import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await isPlatformOwner(supabase, user?.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { admin_user_id, login_id, password } = await request.json().catch(() => ({}))
  if (!admin_user_id || typeof admin_user_id !== 'string') {
    return NextResponse.json({ error: '対象の管理者が指定されていません' }, { status: 400 })
  }
  if (!login_id || typeof login_id !== 'string') {
    return NextResponse.json({ error: 'ユーザーIDは必須です' }, { status: 400 })
  }
  if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
    return NextResponse.json({ error: 'パスワードは8文字以上で入力してください' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: targetUser } = await admin.from('users').select('id, store_id, role').eq('id', admin_user_id).single()
  if (!targetUser || targetUser.store_id !== id || targetUser.role !== 'admin') {
    return NextResponse.json({ error: '管理者が見つかりません' }, { status: 404 })
  }

  const { data: dup } = await admin.from('users').select('id').eq('login_id', login_id).neq('id', admin_user_id).maybeSingle()
  if (dup) {
    return NextResponse.json({ error: 'このユーザーIDは既に使用されています' }, { status: 400 })
  }

  const { error: updateError } = await admin.from('users').update({ login_id }).eq('id', admin_user_id)
  if (updateError) {
    return NextResponse.json({ error: 'ユーザーIDの更新に失敗しました' }, { status: 500 })
  }

  if (password) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(admin_user_id, { password })
    if (passwordError) {
      return NextResponse.json({ error: 'パスワードの更新に失敗しました' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
