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
  const { data: castRows } = castIds.length > 0
    ? await supabase.from('users').select('id, display_name').in('id', castIds)
    : { data: [] }
  const castNameById = new Map((castRows ?? []).map(c => [c.id, c.display_name]))

  // linkの from/to をここで解析しておく（クライアント側では文字列パースをしない）
  const notices = (noticeRows ?? []).flatMap(n => {
    try {
      const url = new URL(n.link ?? '', 'http://placeholder')
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      if (!from || !to) return []
      return [{
        id: n.id, castId: n.user_id, castName: castNameById.get(n.user_id) ?? '—',
        body: n.body, from, to, createdAt: n.created_at,
      }]
    } catch {
      return []
    }
  })

  const casts = (castRows ?? [])
    .map(c => ({ id: c.id, display_name: c.display_name }))
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ja'))

  return (
    <div className="p-6">
      <IssuedNoticesList notices={notices} casts={casts} />
    </div>
  )
}
