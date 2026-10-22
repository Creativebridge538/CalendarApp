import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchNoticeContent, createNoticeSnapshot } from '@/lib/payment-notice-data'

interface Target { cast_id: string }

// 発行はここでサーバー側から行う。発行のたびに、その時点の内容を新しい独立した
// スナップショットとして保存する。同じキャスト・同じ期間で複数回発行しても、
// 過去に発行済みの通知書の内容には一切影響しない
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const storeId = profile.store_id

  const { targets, from, to } = await request.json() as { targets: Target[]; from: string; to: string }
  if (!targets?.length || !from || !to) return NextResponse.json({ error: '対象がありません' }, { status: 400 })

  const admin = createAdminClient()
  const periodLabel = `${format(new Date(`${from}T00:00:00`), 'M/d', { locale: ja })}〜${format(new Date(`${to}T00:00:00`), 'M/d', { locale: ja })}`

  const results = await Promise.all(targets.map(async t => {
    const content = await fetchNoticeContent(admin, storeId, t.cast_id, from, to)
    if (!content) return { cast_id: t.cast_id, ok: false, error: '対象のキャストが見つかりません' }

    const { data: created, error: snapshotError } = await createNoticeSnapshot(admin, storeId, t.cast_id, user.id, content)
    if (snapshotError || !created) {
      console.error('[notices/issue] snapshot failed', t.cast_id, snapshotError)
      return { cast_id: t.cast_id, ok: false, error: 'スナップショットの保存に失敗しました' }
    }
    const noticeId = created.id as string

    const title = '支払通知書が届きました'
    const body = `${periodLabel} の支払通知書: ¥${content.totalReward.toLocaleString()}`
    const link = `/admin/rewards/notice?cast_id=${t.cast_id}&from=${from}&to=${to}&notice_id=${noticeId}`
    // 通知の作成者(created_by)・所属店舗(store_id)も記録する。Web Pushは /api/push/dispatch が「作成者が自分の未送信の通知」だけを送る
    const { error: notifyError } = await admin.from('notifications').insert({ user_id: t.cast_id, title, body, link, created_by: user.id, store_id: storeId })
    if (notifyError) {
      console.error('[notices/issue] notification failed', t.cast_id, notifyError)
      return { cast_id: t.cast_id, ok: false, error: '通知の送信に失敗しました' }
    }

    return { cast_id: t.cast_id, ok: true, noticeId, totalReward: content.totalReward }
  }))

  const issued = results.filter(r => r.ok).length
  return NextResponse.json({ issued, failed: results.length - issued, results })
}
