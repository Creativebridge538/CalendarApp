import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await isPlatformOwner(supabase, user?.id))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { reject_reason } = await request.json().catch(() => ({ reject_reason: undefined }))

  const admin = createAdminClient()

  const { data: signup } = await admin.from('store_signup_requests').select('status').eq('id', id).single()
  if (!signup) return NextResponse.json({ error: '申込が見つかりません' }, { status: 404 })
  if (signup.status !== 'pending') {
    return NextResponse.json({ error: 'この申込は既に処理済みです' }, { status: 400 })
  }

  const { error } = await admin.from('store_signup_requests').update({
    status: 'rejected',
    reject_reason: reject_reason || null,
    reviewed_by: user!.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return NextResponse.json({ error: '却下に失敗しました' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
