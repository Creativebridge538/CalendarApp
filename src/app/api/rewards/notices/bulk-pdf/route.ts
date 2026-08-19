import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { fetchNoticeContent, noticeFileName } from '@/lib/payment-notice-data'
import { NoticeDocument } from '@/lib/payment-notice-pdf'

interface NoticeRequest { cast_id: string; from: string; to: string; issued_at: string }

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }
  const storeId = profile.store_id

  const { notices } = await request.json() as { notices: NoticeRequest[] }
  if (!notices?.length) return NextResponse.json({ error: '対象がありません' }, { status: 400 })

  // 通知ごとにDB取得→PDF描画を直列で待つと件数分だけ遅くなるため、並列に処理する
  const rendered = await Promise.all(notices.map(async n => {
    const content = await fetchNoticeContent(supabase, storeId, n.cast_id, n.from, n.to)
    if (!content) { console.error('[bulk-pdf] cast not found in store', { cast_id: n.cast_id }); return null }
    const buffer = await renderToBuffer(NoticeDocument({ content, issuedAt: n.issued_at }))
    const filename = noticeFileName(content)
    return { filename, buffer }
  }))

  const zip = new JSZip()
  for (const r of rendered) {
    if (!r) continue
    // 同じキャスト・同じ期間で複数回発行されている場合はファイル名が衝突し、zip内で上書きされる（意図的な挙動）
    zip.file(r.filename, r.buffer)
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="payment-notices.zip"',
    },
  })
}
