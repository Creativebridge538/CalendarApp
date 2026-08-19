import type { SupabaseClient } from '@supabase/supabase-js'

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

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
  salesRows: { date: string; platformLabel: string; amount: number; isDailyPayment: boolean; dailyPaymentAt: string | null }[]
  salesTotal: number
  baseReward: number
  bonus: number
  deduction: number
  totalReward: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchNoticeContent(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const [{ data: store }, { data: settings }, { data: cast }, { data: sales }] = await Promise.all([
    supabase.from('stores').select('name').eq('id', storeId).single(),
    supabase.from('store_settings').select('logo_url').eq('store_id', storeId).single(),
    supabase.from('users').select('display_name, real_name, reward_rate, bank_name, bank_branch, bank_account_number, bank_account_holder').eq('id', castId).eq('store_id', storeId).single(),
    supabase.from('sales').select('date, platform, amount, is_daily_payment, daily_payment_at, reward_rate_override, bonus, deduction')
      .eq('cast_id', castId).eq('store_id', storeId)
      .gte('date', from).lte('date', to)
      .order('date'),
  ])

  if (!cast) return null

  const rewardRate = Number(cast.reward_rate)
  const salesRows = sales ?? []
  const salesTotal = salesRows.reduce((sum, s) => sum + Number(s.amount), 0)
  // 日払いで報酬率が上書きされている行はその行だけ別の率で計算する（それ以外は通常の報酬率）
  const baseReward = Math.floor(
    salesRows.reduce((sum, s) => {
      const rate = s.is_daily_payment && s.reward_rate_override != null ? Number(s.reward_rate_override) : rewardRate
      return sum + Number(s.amount) * rate
    }, 0)
  )
  const bonus = salesRows.reduce((sum, s) => sum + Number(s.bonus), 0)
  const deduction = salesRows.reduce((sum, s) => sum + Number(s.deduction), 0)
  const totalReward = baseReward + bonus - deduction

  return {
    castName: cast.display_name ?? '',
    castRealName: cast.real_name ?? '',
    bankName: cast.bank_name ?? '',
    bankBranch: cast.bank_branch ?? '',
    bankAccountNumber: cast.bank_account_number ?? '',
    bankAccountHolder: cast.bank_account_holder ?? '',
    storeName: store?.name ?? '',
    logoUrl: settings?.logo_url ?? null,
    from, to, rewardRate,
    salesRows: salesRows.map(s => ({
      date: s.date, platformLabel: PLATFORM_LABEL[s.platform] ?? s.platform,
      amount: Number(s.amount), isDailyPayment: s.is_daily_payment, dailyPaymentAt: s.daily_payment_at,
    })),
    salesTotal, baseReward, bonus, deduction, totalReward,
  }
}

// 例: 20260801-20260815_55000_山田太郎_支払通知書.pdf（対象期間(開始日-終了日)_支払額_本名(または源氏名)）
export function noticeFileName(content: Pick<NoticeContent, 'from' | 'to' | 'totalReward' | 'castRealName' | 'castName'>): string {
  const period = `${content.from.replace(/-/g, '')}-${content.to.replace(/-/g, '')}`
  const name = (content.castRealName || content.castName || 'unknown').replace(/[/\\]/g, '-')
  return `${period}_${content.totalReward}_${name}_支払通知書.pdf`
}
