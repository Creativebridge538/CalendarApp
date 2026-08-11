import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  const body = await request.json()
  const { userId, email } = body
  if (!userId || !email || typeof email !== 'string') {
    return NextResponse.json({ error: 'userId, email は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (userId !== user.id) {
    if (profile.role !== 'admin') return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    const { data: target } = await admin.from('users').select('store_id').eq('id', userId).single()
    if (!target || target.store_id !== profile.store_id) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true })
  if (authError) {
    const message = authError.message.includes('already been registered')
      ? 'このメールアドレスは既に使用されています'
      : 'メールアドレスの更新に失敗しました'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: dbError } = await admin.from('users').update({ email }).eq('id', userId)
  if (dbError) return NextResponse.json({ error: 'メールアドレスの更新に失敗しました' }, { status: 400 })

  return NextResponse.json({ email })
}
