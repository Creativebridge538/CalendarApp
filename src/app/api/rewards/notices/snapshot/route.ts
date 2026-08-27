import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { getNoticeSnapshotById } from '@/lib/payment-notice-data'
import type { Json } from '@/lib/supabase/database.types'

// 発行済み支払通知書（スナップショット）の内容取得・編集。キャストへの表示内容そのものを
// 直接補正できるよう、管理者に限定して提供する。対象は通知書のIDで一意に特定する
export async function GET(request: Request) {
  const { user, profile } = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '未認証' }, { status: 401 })
  if (profile?.role !== 'admin' || !profile.store_id) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

  const supabase = await createClient()
  const content = await getNoticeSnapshotById(supabase, profile.store_id, id)
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
    id,
    cast_name, cast_real_name, bank_name, bank_branch, bank_account_number, bank_account_holder,
    reward_rate, sales_rows, bonus, deduction, custom_items, show_sales_total, show_reward_rate,
  } = body

  if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

  const supabase = await createClient()
  const existing = await getNoticeSnapshotById(supabase, profile.store_id, id)
  if (!existing) return NextResponse.json({ error: '発行済みの通知書が見つかりません' }, { status: 404 })

  const nextRewardRate = reward_rate != null ? Number(reward_rate) : existing.rewardRate
  const nextSalesRows = Array.isArray(sales_rows)
    ? sales_rows
        .filter((r: unknown) => r && typeof r === 'object' && typeof (r as { date?: unknown }).date === 'string')
        .map((r: { date: string; platformLabel?: unknown; amount: unknown; reward: unknown; isDailyPayment?: unknown; dailyPaymentAt?: unknown }) => ({
          date: r.date,
          platformLabel: typeof r.platformLabel === 'string' ? r.platformLabel : '',
          amount: Number(r.amount) || 0,
          reward: Number(r.reward) || 0,
          isDailyPayment: !!r.isDailyPayment,
          dailyPaymentAt: typeof r.dailyPaymentAt === 'string' ? r.dailyPaymentAt : null,
        }))
    : existing.salesRows
  const salesTotal = nextSalesRows.reduce((sum: number, r: { amount: number }) => sum + r.amount, 0)
  const baseReward = nextSalesRows.reduce((sum: number, r: { reward: number }) => sum + r.reward, 0)
  const nextBonus = bonus != null ? Number(bonus) : existing.bonus
  const nextDeduction = deduction != null ? Number(deduction) : existing.deduction
  const nextCustomItems = Array.isArray(custom_items)
    ? custom_items
        .filter((i: unknown) => i && typeof i === 'object' && typeof (i as { label?: unknown }).label === 'string')
        .map((i: { label: string; amount: unknown }) => ({ label: i.label, amount: Number(i.amount) || 0 }))
    : existing.customItems
  const customItemsTotal = nextCustomItems.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0)
  const totalReward = baseReward + nextBonus - nextDeduction + customItemsTotal

  const { error } = await supabase.from('payment_notices').update({
    cast_name: cast_name ?? existing.castName,
    cast_real_name: cast_real_name ?? existing.castRealName,
    bank_name: bank_name ?? existing.bankName,
    bank_branch: bank_branch ?? existing.bankBranch,
    bank_account_number: bank_account_number ?? existing.bankAccountNumber,
    bank_account_holder: bank_account_holder ?? existing.bankAccountHolder,
    reward_rate: nextRewardRate,
    sales_rows: nextSalesRows as unknown as Json, sales_total: salesTotal, base_reward: baseReward,
    bonus: nextBonus, deduction: nextDeduction,
    custom_items: nextCustomItems as unknown as Json, total_reward: totalReward,
    show_sales_total: show_sales_total ?? existing.showSalesTotal,
    show_reward_rate: show_reward_rate ?? existing.showRewardRate,
    manually_edited: true,
  }).eq('store_id', profile.store_id).eq('id', id)

  if (error) {
    console.error('[notices/snapshot] update failed', error)
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
