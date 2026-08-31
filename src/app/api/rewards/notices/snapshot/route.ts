import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/current-user'
import { getNoticeSnapshotById } from '@/lib/payment-notice-data'
import { parseNoticeItemConfig } from '@/lib/notice-template'
import { customItemsTotal } from '@/lib/reward-rate'
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
    reward_rate, sales_rows, bonus, deduction, custom_items, item_config, header_text, footer_text,
  } = body

  if (!id) return NextResponse.json({ error: 'id は必須です' }, { status: 400 })

  const supabase = await createClient()
  const existing = await getNoticeSnapshotById(supabase, profile.store_id, id)
  if (!existing) return NextResponse.json({ error: '発行済みの通知書が見つかりません' }, { status: 404 })

  const nextRewardRate = reward_rate != null ? Number(reward_rate) : existing.rewardRate
  // rowTotalはこの編集フォームでは個別に入力できない（行ごとのボーナス・控除・追加項目内訳を持たないため）。
  // 表示側のフォールバック（rowTotal ?? reward）と同じ扱いになるよう、reward自体をrowTotalとして明示的に保存する
  const nextSalesRows = Array.isArray(sales_rows)
    ? sales_rows
        .filter((r: unknown) => r && typeof r === 'object' && typeof (r as { date?: unknown }).date === 'string')
        .map((r: { date: string; platformLabel?: unknown; amount: unknown; reward: unknown; isDailyPayment?: unknown; dailyPaymentAt?: unknown }) => {
          const reward = Number(r.reward) || 0
          return {
            date: r.date,
            platformLabel: typeof r.platformLabel === 'string' ? r.platformLabel : '',
            amount: Number(r.amount) || 0,
            reward, rowTotal: reward,
            isDailyPayment: !!r.isDailyPayment,
            dailyPaymentAt: typeof r.dailyPaymentAt === 'string' ? r.dailyPaymentAt : null,
          }
        })
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
  const nextCustomItemsTotal = nextCustomItems.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0)
  // 売上入力時に登録された追加項目（sales_custom_items）はこの編集画面では変更できず、
  // baseRewardにも含まれていないため、既存のスナップショットの値をそのまま合計額に加算する
  // （ここを忘れると、通知書のどこかを編集するたびに追加項目分の女子給が支払合計から消えてしまう）
  const salesCustomItemsTotal = customItemsTotal(existing.salesCustomItems)
  const totalReward = baseReward + nextBonus - nextDeduction + nextCustomItemsTotal + salesCustomItemsTotal
  const nextItemConfig = Array.isArray(item_config) ? parseNoticeItemConfig(item_config) : existing.itemConfig
  const nextHeaderText = header_text !== undefined ? (header_text || null) : existing.headerText
  const nextFooterText = footer_text !== undefined ? (footer_text || null) : existing.footerText

  // payment_noticesへの書き込みはservice_role専用（RLSでadmin/castともにwriteポリシーがない）
  // ため、通常のセッションクライアントでupdateすると0件更新のまま成功扱いになってしまう
  const admin = createAdminClient()
  const { data: updated, error } = await admin.from('payment_notices').update({
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
    item_config: nextItemConfig as unknown as Json,
    header_text: nextHeaderText, footer_text: nextFooterText,
    manually_edited: true,
  }).eq('store_id', profile.store_id).eq('id', id).select('id')

  if (error || !updated || updated.length === 0) {
    console.error('[notices/snapshot] update failed', { error, matched: updated?.length ?? 0 })
    return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
