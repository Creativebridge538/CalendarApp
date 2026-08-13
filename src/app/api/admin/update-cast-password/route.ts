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
  const { userId, password } = body
  if (!userId || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'パスワードは8文字以上で入力してください' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target } = await admin.from('users').select('store_id').eq('id', userId).single()
  if (!target || target.store_id !== profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) {
    console.error('update-cast-password: updateUserById failed', error)
    return NextResponse.json({ error: 'パスワードの変更に失敗しました' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
