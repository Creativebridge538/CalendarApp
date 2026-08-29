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

  const { name, contact_name, contact_email, enabled_platforms } = await request.json().catch(() => ({}))
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: '店舗名は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: store } = await admin.from('stores').select('id').eq('id', id).single()
  if (!store) return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })

  const { error } = await admin.from('stores').update({
    name,
    contact_name: contact_name || null,
    contact_email: contact_email || null,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })

  if (Array.isArray(enabled_platforms)) {
    const VALID_PLATFORMS = ['stripchat', 'fc2', 'dxlive']
    const platforms = enabled_platforms.filter((p): p is string => VALID_PLATFORMS.includes(p))
    const { error: settingsError } = await admin.from('store_settings').update({ enabled_platforms: platforms }).eq('store_id', id)
    if (settingsError) return NextResponse.json({ error: 'プラットフォーム設定の更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
