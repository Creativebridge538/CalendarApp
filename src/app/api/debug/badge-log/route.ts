import { NextResponse } from 'next/server'

// バッジ設定の実機デバッグ用。Service Workerからの診断ログをVercelのログに出すだけの一時的なエンドポイント。
// 原因が分かったら削除する
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  console.log('[badge-debug]', JSON.stringify(body))
  return NextResponse.json({ ok: true })
}
