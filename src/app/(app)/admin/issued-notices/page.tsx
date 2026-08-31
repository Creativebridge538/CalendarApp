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
    ? await supabase.from('users').select('id, display_name, real_name').in('id', castIds)
    : { data: [] }
  const castById = new Map((castRows ?? []).map(c => [c.id, c]))

  // linkの from/to/notice_id をここで解析しておく（クライアント側では文字列パースをしない）
  const parsedNotices = (noticeRows ?? []).flatMap(n => {
    try {
      const url = new URL(n.link ?? '', 'http://placeholder')
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const noticeId = url.searchParams.get('notice_id')
      if (!from || !to) return []
      const cast = castById.get(n.user_id)
      return [{
        id: n.id, castId: n.user_id, castName: cast?.display_name ?? '—', castRealName: cast?.real_name ?? null,
        body: n.body, from, to, createdAt: n.created_at, noticeId,
      }]
    } catch {
      return []
    }
  })

  const noticeIds = parsedNotices.flatMap(n => n.noticeId ? [n.noticeId] : [])
  const { data: noticeSnapshots } = noticeIds.length > 0
    ? await supabase.from('payment_notices').select('id, manually_edited, total_reward').in('id', noticeIds)
    : { data: [] }
  const snapshotById = new Map((noticeSnapshots ?? []).map(s => [s.id, s]))

  // 一覧の「内容」表示は、発行時点の固定文言ではなく、編集された場合も反映されるよう
  // 現在のスナップショットの金額から組み立て直す（古い形式の通知は元の文言のまま）
  const notices = parsedNotices.map(n => {
    const snapshot = n.noticeId ? snapshotById.get(n.noticeId) : undefined
    return {
      ...n,
      manuallyEdited: snapshot?.manually_edited ?? false,
      body: snapshot ? `${n.from}〜${n.to} の支払通知書: ¥${Number(snapshot.total_reward).toLocaleString()}` : n.body,
    }
  })

  const casts = (castRows ?? [])
    .map(c => ({ id: c.id, display_name: c.display_name }))
    .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? '', 'ja'))

  const { data: driveToken } = await supabase.from('store_google_drive_tokens')
    .select('store_id').eq('store_id', profile.store_id!).maybeSingle()

  const [{ data: itemTemplates }, { data: storeSettings }] = await Promise.all([
    supabase.from('notice_item_templates').select('id, label, unit')
      .eq('store_id', profile.store_id!).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('platform_settings, usd_jpy_auto_fetch, usd_jpy_adjustment, usd_jpy_rate, notice_item_config')
      .eq('store_id', profile.store_id!).single(),
  ])

  return (
    <div className="p-6">
      <IssuedNoticesList
        notices={notices} casts={casts} googleDriveConnected={!!driveToken}
        itemTemplates={itemTemplates ?? []} storeSettings={storeSettings}
      />
    </div>
  )
}
