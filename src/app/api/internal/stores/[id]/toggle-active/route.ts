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

  const { is_active } = await request.json().catch(() => ({ is_active: undefined }))
  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: store } = await admin.from('stores').select('id').eq('id', id).single()
  if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })

  const { error } = await admin.from('stores').update({ is_active }).eq('id', id)
  if (error) return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
