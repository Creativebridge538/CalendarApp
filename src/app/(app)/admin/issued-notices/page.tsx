import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { IssuedNoticesList } from '@/components/rewards/issued-notices-list'

export default async function IssuedNoticesPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: noticeRows } = await supabase.from('notifications')
    .select('id, user_id, body, link, created_at')
    .eq('title', '支払通知書が届きました')
    .order('created_at', { ascending: false })
    .limit(300)

  const castIds = [...new Set((noticeRows ?? []).map(n => n.user_id))]
  const [{ data: castRows }, { data: noticeSnapshots }] = await Promise.all([
    castIds.length > 0
      ? supabase.from('users').select('id, display_name, real_name').in('id', castIds)
      : Promise.resolve({ data: [] }),
    castIds.length > 0
      ? supabase.from('payment_notices').select('cast_id, period_from, period_to, manually_edited')
          .eq('store_id', profile.store_id!).in('cast_id', castIds)
      : Promise.resolve({ data: [] }),
  ])
  const castById = new Map((castRows ?? []).map(c => [c.id, c]))
  const manuallyEditedByKey = new Map(
    (noticeSnapshots ?? []).map(s => [`${s.cast_id}_${s.period_from}_${s.period_to}`, s.manually_edited])
  )

  // linkの from/to をここで解析しておく（クライアント側では文字列パースをしない）
  const notices = (noticeRows ?? []).flatMap(n => {
    try {
      const url = new URL(n.link ?? '', 'http://placeholder')
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!from || !to) return []
      const cast = castById.get(n.user_id)
      return [{
        id: n.id, castId: n.user_id, castName: cast?.display_name ?? '—', castRealName: cast?.real_name ?? null,
        body: n.body, from, to, createdAt: n.created_at,
        manuallyEdited: manuallyEditedByKey.get(`${n.user_id}_${from}_${to}`) ?? false,
      }]
    } catch {
      return []
    }
  })

  const casts = (castRows ?? [])
    .map(c => ({ id: c.id, display_name: c.display_name }))
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ja'))

  const { data: driveToken } = await supabase.from('store_google_drive_tokens')
    .select('store_id').eq('store_id', profile.store_id!).maybeSingle()

  return (
    <div className="p-6">
      <IssuedNoticesList notices={notices} casts={casts} googleDriveConnected={!!driveToken} />
    </div>
  )
}
