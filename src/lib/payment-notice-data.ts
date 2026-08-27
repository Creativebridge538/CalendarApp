import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveRewardRate, parsePlatformRewardRates } from './reward-rate'

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

export interface CustomItem { label: string; amount: number }

export interface NoticeContent {
  castName: string
  castRealName: string
  bankName: string
  bankBranch: string
  bankAccountNumber: string
  bankAccountHolder: string
  storeName: string
  logoUrl: string | null
  from: string
  to: string
  rewardRate: number
  salesRows: { date: string; platformLabel: string; amount: number; reward: number; isDailyPayment: boolean; dailyPaymentAt: string | null }[]
  salesTotal: number
  baseReward: number
  bonus: number
  deduction: number
  /** 日払いで既に精算済みの分の報酬額（合計お支払額には含まれるが、参考として内訳表示する） */
  dailySettledAmount: number
  customItems: CustomItem[]
  totalReward: number
  showSalesTotal: boolean
  showRewardRate: boolean
  /** 管理者が「編集」機能で内容を補正済みかどうか（trueの場合、再発行しても上書きしない） */
  manuallyEdited: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchNoticeContent(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const [{ data: store }, { data: settings }, { data: cast }, { data: sales }] = await Promise.all([
    supabase.from('stores').select('name').eq('id', storeId).single(),
    supabase.from('store_settings').select('logo_url, notice_show_sales_total, notice_show_reward_rate').eq('store_id', storeId).single(),
    supabase.from('users').select('display_name, real_name, reward_rate, platform_reward_rates, daily_payment_reward_rate, bank_name, bank_branch, bank_account_number, bank_account_holder').eq('id', castId).eq('store_id', storeId).single(),
    supabase.from('sales').select('date, platform, amount, is_daily_payment, daily_payment_at, reward_rate_override, bonus, deduction')
      .eq('cast_id', castId).eq('store_id', storeId)
      .gte('date', from).lte('date', to)
      .order('date'),
  ])

  if (!cast) return null

  const rewardRate = Number(cast.reward_rate)
  const platformRates = parsePlatformRewardRates(cast.platform_reward_rates)
  const rawSalesRows = sales ?? []
  const salesTotal = rawSalesRows.reduce((sum, s) => sum + Number(s.amount), 0)
  // 日払いで報酬率が上書きされている行や、プラットフォーム別の報酬率が設定されている行は
  // その行だけ別の率で計算する（それ以外は通常の報酬率）。後で日払い精算済み分の内訳表示にも
  // 使えるよう、行ごとの報酬額も保持しておく
  const salesRows = rawSalesRows.map(s => {
    const rate = effectiveRewardRate(s, rewardRate, platformRates, cast.daily_payment_reward_rate)
    return {
      date: s.date, platformLabel: PLATFORM_LABEL[s.platform] ?? s.platform,
      amount: Number(s.amount), reward: Math.floor(Number(s.amount) * rate),
      isDailyPayment: s.is_daily_payment, dailyPaymentAt: s.daily_payment_at,
    }
  })
  const baseReward = salesRows.reduce((sum, s) => sum + s.reward, 0)
  const dailySettledAmount = salesRows.filter(s => s.isDailyPayment).reduce((sum, s) => sum + s.reward, 0)
  const bonus = rawSalesRows.reduce((sum, s) => sum + Number(s.bonus), 0)
  const deduction = rawSalesRows.reduce((sum, s) => sum + Number(s.deduction), 0)
  // 発行前（プレビュー等）の時点ではカスタム項目はまだ存在しない。発行後に個別編集で追加する
  const customItems: CustomItem[] = []
  const totalReward = baseReward + bonus - deduction

  return {
    manuallyEdited: false,
    castName: cast.display_name ?? '',
    castRealName: cast.real_name ?? '',
    bankName: cast.bank_name ?? '',
    bankBranch: cast.bank_branch ?? '',
    bankAccountNumber: cast.bank_account_number ?? '',
    bankAccountHolder: cast.bank_account_holder ?? '',
    storeName: store?.name ?? '',
    logoUrl: settings?.logo_url ?? null,
    from, to, rewardRate,
    salesRows,
    salesTotal, baseReward, bonus, deduction, dailySettledAmount, customItems, totalReward,
    showSalesTotal: settings?.notice_show_sales_total ?? true,
    showRewardRate: settings?.notice_show_reward_rate ?? true,
  }
}

// 発行済みのスナップショットがあればそれを返す（発行後にキャストの氏名・口座等が
// 変更されても、過去に発行した通知書の内容は変わらないようにするため）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNoticeSnapshot(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const { data } = await supabase.from('payment_notices').select('*')
    .eq('store_id', storeId).eq('cast_id', castId).eq('period_from', from).eq('period_to', to)
    .maybeSingle()
  if (!data) return null
  const salesRows = data.sales_rows as NoticeContent['salesRows']
  return {
    manuallyEdited: data.manually_edited,
    castName: data.cast_name, castRealName: data.cast_real_name,
    bankName: data.bank_name, bankBranch: data.bank_branch,
    bankAccountNumber: data.bank_account_number, bankAccountHolder: data.bank_account_holder,
    storeName: data.store_name, logoUrl: data.logo_url,
    from: data.period_from, to: data.period_to,
    rewardRate: Number(data.reward_rate),
    salesRows,
    salesTotal: Number(data.sales_total), baseReward: Number(data.base_reward),
    bonus: Number(data.bonus), deduction: Number(data.deduction),
    dailySettledAmount: salesRows.filter(s => s.isDailyPayment).reduce((sum, s) => sum + (s.reward ?? 0), 0),
    customItems: (data.custom_items as CustomItem[] | null) ?? [],
    totalReward: Number(data.total_reward),
    showSalesTotal: data.show_sales_total, showRewardRate: data.show_reward_rate,
  }
}

// 発行済みならスナップショットを、未発行（プレビュー等）ならその場で計算した最新内容を返す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNoticeContent(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const snapshot = await getNoticeSnapshot(supabase, storeId, castId, from, to)
  if (snapshot) return snapshot
  return fetchNoticeContent(supabase, storeId, castId, from, to)
}

// 発行時点の内容をスナップショットとして保存する。同じ期間に対して既に発行済みの場合は
// 上書きしない（発行済みの通知書の内容は不変とし、内容を直す場合は「発行済み支払通知書」の
// 編集機能を使う。新規の期間を発行する場合のみ、その時点の最新内容が保存される）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveNoticeSnapshot(supabase: SupabaseClient<any>, storeId: string, castId: string, issuedBy: string, content: NoticeContent) {
  const customItemsTotal = content.customItems.reduce((sum, i) => sum + i.amount, 0)
  const totalReward = content.baseReward + content.bonus - content.deduction + customItemsTotal

  return supabase.from('payment_notices').upsert({
    store_id: storeId, cast_id: castId, period_from: content.from, period_to: content.to,
    issued_by: issuedBy,
    cast_name: content.castName, cast_real_name: content.castRealName,
    bank_name: content.bankName, bank_branch: content.bankBranch,
    bank_account_number: content.bankAccountNumber, bank_account_holder: content.bankAccountHolder,
    store_name: content.storeName, logo_url: content.logoUrl,
    reward_rate: content.rewardRate, sales_rows: content.salesRows,
    sales_total: content.salesTotal, base_reward: content.baseReward,
    bonus: content.bonus, deduction: content.deduction,
    custom_items: content.customItems, total_reward: totalReward,
    show_sales_total: content.showSalesTotal, show_reward_rate: content.showRewardRate,
  }, { onConflict: 'store_id,cast_id,period_from,period_to', ignoreDuplicates: true })
}

// 例: 20260801-20260815_55000_山田太郎_支払通知書.pdf（対象期間(開始日-終了日)_支払額_本名(または源氏名)）
export function noticeFileName(content: Pick<NoticeContent, 'from' | 'to' | 'totalReward' | 'castRealName' | 'castName'>): string {
  const period = `${content.from.replace(/-/g, '')}-${content.to.replace(/-/g, '')}`
  const name = (content.castRealName || content.castName || 'unknown').replace(/[/\\]/g, '-')
  return `${period}_${content.totalReward}_${name}_支払通知書.pdf`
}
