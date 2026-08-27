import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const { login_id, store_id } = await request.json()
  if (!login_id || typeof login_id !== 'string') {
    return NextResponse.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, { status: 400 })
  }

  const admin = createAdminClient()
  let query = admin.from('users').select('email, store_id, stores(name)').eq('login_id', login_id)
  if (store_id && typeof store_id === 'string') query = query.eq('store_id', store_id)
  const { data } = await query

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, { status: 400 })
  }

  // ユーザーIDは店舗単位でのみ一意なため、店舗を指定せずに複数店舗にまたがって
  // 同じIDが使われている場合は、どのアカウントか一意に決まらない。店舗選択を促す
  if (data.length > 1) {
    return NextResponse.json({
      ambiguous: true,
      stores: data.map(d => ({ store_id: d.store_id, store_name: d.stores?.name ?? '(店舗なし)' })),
    })
  }

  return NextResponse.json({ email: data[0].email })
}
