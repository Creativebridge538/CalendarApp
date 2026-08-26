import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchNoticeContent, saveNoticeSnapshot } from '@/lib/payment-notice-data'

interface Target { cast_id: string }

// 発行はここでサーバー側から行う。発行の瞬間に内容をスナップショットとして保存し、
// 以後キャストの氏名・口座情報・報酬率が変わっても、この通知書の内容は変わらないようにするため
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

    const { error: snapshotError } = await saveNoticeSnapshot(admin, storeId, t.cast_id, user.id, content)
    if (snapshotError) {
      console.error('[notices/issue] snapshot failed', t.cast_id, snapshotError)
      return { cast_id: t.cast_id, ok: false, error: 'スナップショットの保存に失敗しました' }
    }

    const title = '支払通知書が届きました'
    const body = `${periodLabel} の支払通知書: ¥${content.totalReward.toLocaleString()}`
    const link = `/admin/rewards/notice?cast_id=${t.cast_id}&from=${from}&to=${to}`
    const { error: notifyError } = await admin.from('notifications').insert({ user_id: t.cast_id, title, body, link })
    if (notifyError) {
      console.error('[notices/issue] notification failed', t.cast_id, notifyError)
      return { cast_id: t.cast_id, ok: false, error: '通知の送信に失敗しました' }
    }

    return { cast_id: t.cast_id, ok: true, totalReward: content.totalReward }
  }))

  const issued = results.filter(r => r.ok).length
  return NextResponse.json({ issued, failed: results.length - issued, results })
}
