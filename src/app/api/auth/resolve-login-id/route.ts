import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { login_id } = await request.json()
  if (!login_id || typeof login_id !== 'string') {
    return NextResponse.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data } = await admin.from('users').select('email').eq('login_id', login_id).single()
  if (!data?.email) {
    return NextResponse.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, { status: 400 })
  }

  return NextResponse.json({ email: data.email })
}
