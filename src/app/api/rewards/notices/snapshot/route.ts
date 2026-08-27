import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { getNoticeSnapshot } from '@/lib/payment-notice-data'

// 発行済み支払通知書（スナップショット）の内容取得・編集。キャストへの表示内容そのものを
// 直接補正できるよう、管理者に限定して提供する
export async function GET(request: Request) {
  const { user, profile } = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })
  if (profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const castId = searchParams.get('cast_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!castId || !from || !to) {
    return NextResponse.json({ error: 'cast_id, from, to は必須です' }, { status: 400 })
  }

  const supabase = await createClient()
  const content = await getNoticeSnapshot(supabase, profile.store_id, castId, from, to)
  if (!content) return NextResponse.json({ error: '発行済みの通知書が見つかりません' }, { status: 404 })

  return NextResponse.json({ content })
}

export async function PATCH(request: Request) {
  const { user, profile } = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })
  if (profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const body = await request.json()
  const {
    cast_id, from, to,
    cast_name, cast_real_name, bank_name, bank_branch, bank_account_number, bank_account_holder,
    bonus, deduction,
  } = body

  if (!cast_id || !from || !to) {
    return NextResponse.json({ error: 'cast_id, from, to は必須です' }, { status: 400 })
  }

  const supabase = await createClient()
  const existing = await getNoticeSnapshot(supabase, profile.store_id, cast_id, from, to)
  if (!existing) return NextResponse.json({ error: '発行済みの通知書が見つかりません' }, { status: 404 })

  const nextBonus = bonus != null ? Number(bonus) : existing.bonus
  const nextDeduction = deduction != null ? Number(deduction) : existing.deduction
  const totalReward = existing.baseReward + nextBonus - nextDeduction

  const { error } = await supabase.from('payment_notices').update({
    cast_name: cast_name ?? existing.castName,
    cast_real_name: cast_real_name ?? existing.castRealName,
    bank_name: bank_name ?? existing.bankName,
    bank_branch: bank_branch ?? existing.bankBranch,
    bank_account_number: bank_account_number ?? existing.bankAccountNumber,
    bank_account_holder: bank_account_holder ?? existing.bankAccountHolder,
    bonus: nextBonus, deduction: nextDeduction, total_reward: totalReward,
  }).eq('store_id', profile.store_id).eq('cast_id', cast_id).eq('period_from', from).eq('period_to', to)

  if (error) {
    console.error('[notices/snapshot] update failed', error)
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
