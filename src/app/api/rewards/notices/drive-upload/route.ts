import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchNoticeContent, noticeFileName } from '@/lib/payment-notice-data'
import { NoticeDocument } from '@/lib/payment-notice-pdf'
import { getAccessToken, ensureFolder, uploadFileToDrive } from '@/lib/google-drive'

// PDF生成+Google API呼び出しを件数分行うため、デフォルトのタイムアウトでは
// 選択件数が多いと打ち切られる可能性がある
export const maxDuration = 120

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

  const admin = createAdminClient()
  const { data: tokenRow } = await admin.from('store_google_drive_tokens').select('*').eq('store_id', storeId).single()
  if (!tokenRow) {
    return NextResponse.json({ error: 'Google Driveと連携されていません' }, { status: 400 })
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken(tokenRow.refresh_token)
  } catch (e) {
    console.error('[drive-upload] token refresh failed', e)
    return NextResponse.json({ error: 'Google Driveとの連携が切れています。再度連携してください' }, { status: 400 })
  }

  // フォルダ作成やDrive APIの呼び出しで想定外の例外が起きても、必ずJSONを返すようにする
  // （例外を握りつぶしたまま返すと、クライアント側がres.json()のパースに失敗し「保存中」表示のまま固まる）
  try {
    const { data: store } = await admin.from('stores').select('name').eq('id', storeId).single()

    let rootFolderId = tokenRow.root_folder_id
    if (!rootFolderId) {
      rootFolderId = await ensureFolder(accessToken, `CalendarApp 支払通知書${store?.name ? `（${store.name}）` : ''}`)
      await admin.from('store_google_drive_tokens').update({ root_folder_id: rootFolderId }).eq('store_id', storeId)
    }

    // 年月フォルダを事前にまとめて用意しておく（通知ごとに並列でensureFolderすると、
    // 同じ月のフォルダが未作成の状態で複数同時に呼ばれ、重複作成されるおそれがあるため）
    const yearMonths = [...new Set(notices.map(n => n.to.slice(0, 7)))]
    const folderEntries = await Promise.all(yearMonths.map(async ym => [ym, await ensureFolder(accessToken, ym, rootFolderId!)] as const))
    const folderCache = new Map(folderEntries)

    const results = await Promise.all(notices.map(async n => {
      try {
        // 管理画面からのDrive保存は常に最新の内容を反映する（発行時点のスナップショットは使わない）
        const content = await fetchNoticeContent(supabase, storeId, n.cast_id, n.from, n.to)
        if (!content) return { ok: false, error: '対象のキャストが見つかりません' }

        const folderId = folderCache.get(n.to.slice(0, 7))!
        const buffer = await renderToBuffer(NoticeDocument({ content, issuedAt: n.issued_at }))
        const filename = noticeFileName(content)
        await uploadFileToDrive(accessToken, folderId, filename, buffer)
        return { ok: true }
      } catch (e) {
        console.error('[drive-upload] failed for notice', n, e)
        return { ok: false, error: e instanceof Error ? e.message : '不明なエラー' }
      }
    }))

    const uploaded = results.filter(r => r.ok).length
    const failed = results.length - uploaded
    return NextResponse.json({ uploaded, failed })
  } catch (e) {
    console.error('[drive-upload] unexpected failure', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Google Driveへの保存中に不明なエラーが発生しました' }, { status: 500 })
  }
}
