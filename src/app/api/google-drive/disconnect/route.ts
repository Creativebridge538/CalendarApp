import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/current-user'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const { user, profile } = await getCurrentUser()
  if (!user || profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('store_google_drive_tokens').delete().eq('store_id', profile.store_id)
  if (error) return NextResponse.json({ error: '連携解除に失敗しました' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
