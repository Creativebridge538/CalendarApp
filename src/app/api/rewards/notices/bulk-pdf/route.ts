import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { fetchNoticeContent } from '@/lib/payment-notice-data'
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

  const zip = new JSZip()
  for (const n of notices) {
    const content = await fetchNoticeContent(supabase, storeId, n.cast_id, n.from, n.to)
    if (!content) continue
    const buffer = await renderToBuffer(NoticeDocument({ content, issuedAt: n.issued_at }))
    const filename = `${content.castName || 'unknown'}_${n.from}_${n.to}.pdf`.replace(/[/\\]/g, '-')
    zip.file(filename, buffer)
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="payment-notices.zip"',
    },
  })
}
