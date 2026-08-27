import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { fetchNoticeContent, getNoticeSnapshotById, getLatestNoticeSnapshot, noticeFileName } from '@/lib/payment-notice-data'
import { NoticeDocument } from '@/lib/payment-notice-pdf'

// ブラウザの印刷機能(window.print)経由のPDF保存は、共有時にレイアウトが崩れることがあるため、
// サーバー側でreact-pdfから直接PDFバイト列を生成して返す（見た目が端末やブラウザに依存しない）
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const castId = searchParams.get('cast_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const noticeId = searchParams.get('notice_id')
  if (!castId || !from || !to) {
    return NextResponse.json({ error: 'cast_id, from, to は必須です' }, { status: 400 })
  }

  const isAdmin = profile?.role === 'admin'
  const isSelf = profile?.role === 'cast' && castId === user.id
  if (!isAdmin && !isSelf) return NextResponse.json({ error: '権限がありません' }, { status: 403 })

  const storeId = profile!.store_id!
  // notice_id指定時は、発行済みのその1件をそのままダウンロードする。
  // 指定がない場合、管理画面からは常に最新の内容にし、キャスト自身の分だけ
  // （古いリンク向けの後方互換）最後に発行された内容を優先する
  let content = noticeId ? await getNoticeSnapshotById(supabase, storeId, noticeId) : null
  if (!content) {
    content = isAdmin
      ? await fetchNoticeContent(supabase, storeId, castId, from, to)
      : (await getLatestNoticeSnapshot(supabase, storeId, castId, from, to)) ?? await fetchNoticeContent(supabase, storeId, castId, from, to)
  }
  if (!content) return NextResponse.json({ error: '対象のキャストが見つかりません' }, { status: 404 })

  const buffer = await renderToBuffer(NoticeDocument({ content, issuedAt: new Date().toISOString() }))
  const filename = noticeFileName(content)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // filenameは非ASCII文字を含みうるため、フォールバック用のASCII名とfilename*(RFC 5987)を併記する
      'Content-Disposition': `attachment; filename="notice.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
