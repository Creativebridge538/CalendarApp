import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveRewardRate, parsePlatformRewardRates, customItemsTotal, parseCustomItems, includedInSalesTotal } from './reward-rate'
import { parseNoticeItemConfig, type NoticeItemConfigEntry } from './notice-template'
import type { Json } from './supabase/database.types'

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

export interface CustomItem { label: string; amount: number }

export interface NoticeContent {
  /** 発行済みスナップショットのID。未発行のプレビュー等ではnull */
  id: string | null
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
  salesRows: { date: string; platformLabel: string; amount: number; reward: number; isDailyPayment: boolean; dailyPaymentAt: string | null; fxRate: number | null; usdAmount: number | null }[]
  salesTotal: number
  baseReward: number
  bonus: number
  deduction: number
  /** 日払いで既に精算済みの分の報酬額（合計お支払額には含まれるが、参考として内訳表示する） */
  dailySettledAmount: number
  /** 発行後に管理者が個別編集で手動追加した加算項目（baseRewardには含まれず、totalRewardに加算される） */
  customItems: CustomItem[]
  /** 売上入力時に登録された追加項目の集計（表示専用。金額は既にbaseRewardの各行reward計算に含まれている） */
  salesCustomItems: CustomItem[]
  totalReward: number
  itemConfig: NoticeItemConfigEntry[]
  headerText: string | null
  footerText: string | null
  /** 管理者が「編集」機能で内容を補正済みかどうか（一覧でのバッジ表示用） */
  manuallyEdited: boolean
}

// 現時点の売上・キャスト情報からその場で計算する（発行前のプレビューや、新規発行時に使う）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchNoticeContent(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const [{ data: store }, { data: settings }, { data: cast }, { data: sales }, { data: itemTemplates }] = await Promise.all([
    supabase.from('stores').select('name').eq('id', storeId).single(),
    supabase.from('store_settings').select('logo_url, notice_item_config, notice_header_text, notice_footer_text').eq('store_id', storeId).single(),
    supabase.from('users').select('display_name, real_name, reward_rate, platform_reward_rates, daily_payment_reward_rate, platform_daily_payment_reward_rates, bank_name, bank_branch, bank_account_number, bank_account_holder').eq('id', castId).eq('store_id', storeId).single(),
    supabase.from('sales').select('date, platform, amount, is_daily_payment, daily_payment_at, reward_rate_override, bonus, deduction, fx_rate_snapshot, usd_amount, custom_items')
      .eq('cast_id', castId).eq('store_id', storeId)
      .gte('date', from).lte('date', to)
      .order('date'),
    supabase.from('notice_item_templates').select('label').eq('store_id', storeId).eq('include_in_sales', true),
  ])

  if (!cast) return null

  const rewardRate = Number(cast.reward_rate)
  const platformRates = parsePlatformRewardRates(cast.platform_reward_rates)
  const platformDailyRates = parsePlatformRewardRates(cast.platform_daily_payment_reward_rates)
  const rawSalesRows = sales ?? []
  // 「売上に反映する」設定がオンのテンプレート項目は、その分も売上合計に加算する
  const includedInSalesLabels = new Set((itemTemplates ?? []).map(t => t.label))
  const salesTotal = rawSalesRows.reduce((sum, s) => sum + Number(s.amount) + includedInSalesTotal(s.custom_items, includedInSalesLabels), 0)
  // 日払いで報酬率が上書きされている行や、プラットフォーム別の報酬率が設定されている行は
  // その行だけ別の率で計算する（それ以外は通常の報酬率）。後で日払い精算済み分の内訳表示にも
  // 使えるよう、行ごとの報酬額も保持しておく
  // 基本報酬は売上×報酬率のみの純粋な金額とし、追加項目（ボーナス・控除・カスタム項目）は含めない
  const salesRows = rawSalesRows.map(s => {
    const rate = effectiveRewardRate(s, rewardRate, platformRates, cast.daily_payment_reward_rate, platformDailyRates)
    return {
      date: s.date, platformLabel: PLATFORM_LABEL[s.platform] ?? s.platform,
      amount: Number(s.amount), reward: Math.floor(Number(s.amount) * rate),
      isDailyPayment: s.is_daily_payment, dailyPaymentAt: s.daily_payment_at,
      fxRate: s.fx_rate_snapshot != null ? Number(s.fx_rate_snapshot) : null,
      usdAmount: s.usd_amount != null ? Number(s.usd_amount) : null,
    }
  })
  const baseReward = salesRows.reduce((sum, s) => sum + s.reward, 0)
  const dailySettledAmount = salesRows.filter(s => s.isDailyPayment).reduce((sum, s) => sum + s.reward, 0)
  const bonus = rawSalesRows.reduce((sum, s) => sum + Number(s.bonus), 0)
  const deduction = rawSalesRows.reduce((sum, s) => sum + Number(s.deduction), 0)
  // 発行前（プレビュー等）の時点では手動追加のカスタム項目はまだ存在しない。発行後に個別編集で追加する
  const customItems: CustomItem[] = []
  // 売上入力時に登録した追加項目は、同じラベルの行同士を合算し内訳表示専用の項目として保持する
  const salesCustomItemsMap = new Map<string, number>()
  for (const s of rawSalesRows) {
    for (const item of parseCustomItems(s.custom_items)) {
      salesCustomItemsMap.set(item.label, (salesCustomItemsMap.get(item.label) ?? 0) + item.amount)
    }
  }
  const salesCustomItems: CustomItem[] = Array.from(salesCustomItemsMap, ([label, amount]) => ({ label, amount }))
  const totalReward = baseReward + bonus - deduction + customItemsTotal(salesCustomItems)

  return {
    id: null,
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
    salesTotal, baseReward, bonus, deduction, dailySettledAmount, customItems, salesCustomItems, totalReward,
    itemConfig: parseNoticeItemConfig(settings?.notice_item_config),
    headerText: settings?.notice_header_text ?? null,
    footerText: settings?.notice_footer_text ?? null,
  }
}

function mapNoticeRow(data: {
  id: string; cast_name: string; cast_real_name: string
  bank_name: string; bank_branch: string; bank_account_number: string; bank_account_holder: string
  store_name: string; logo_url: string | null
  period_from: string; period_to: string; reward_rate: number
  sales_rows: unknown
  sales_total: number; base_reward: number; bonus: number; deduction: number
  custom_items: unknown
  sales_custom_items: unknown
  total_reward: number
  item_config: unknown; header_text: string | null; footer_text: string | null
  manually_edited: boolean
}): NoticeContent {
  // 古い発行済み通知書には fxRate/usdAmount が保存されていないため、欠けている場合はnull扱いにする
  const salesRows = (data.sales_rows as NoticeContent['salesRows']).map(s => ({
    ...s, fxRate: s.fxRate ?? null, usdAmount: s.usdAmount ?? null,
  }))
  return {
    id: data.id,
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
    salesCustomItems: (data.sales_custom_items as CustomItem[] | null) ?? [],
    totalReward: Number(data.total_reward),
    itemConfig: parseNoticeItemConfig(data.item_config),
    headerText: data.header_text, footerText: data.footer_text,
  }
}

// 発行済み通知書を特定のID（＝発行1回分そのもの）で取得する。
// 同じキャスト・同じ期間で何度発行しても、それぞれ別のIDを持つ独立した記録になる
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getNoticeSnapshotById(supabase: SupabaseClient<any>, storeId: string, id: string): Promise<NoticeContent | null> {
  const { data } = await supabase.from('payment_notices').select('*')
    .eq('store_id', storeId).eq('id', id)
    .maybeSingle()
  if (!data) return null
  return mapNoticeRow(data)
}

// 通知IDが分からない古いリンク向けのフォールバック: その期間・キャストで最後に発行されたものを返す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLatestNoticeSnapshot(supabase: SupabaseClient<any>, storeId: string, castId: string, from: string, to: string): Promise<NoticeContent | null> {
  const { data } = await supabase.from('payment_notices').select('*')
    .eq('store_id', storeId).eq('cast_id', castId).eq('period_from', from).eq('period_to', to)
    .order('issued_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return mapNoticeRow(data)
}

// 発行時点の内容を新しい独立したスナップショットとして保存する（常にINSERT。
// 同じキャスト・同じ期間の過去の発行記録には一切影響しない）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createNoticeSnapshot(supabase: SupabaseClient<any>, storeId: string, castId: string, issuedBy: string, content: NoticeContent) {
  // content.baseRewardには売上行のsalesCustomItemsが既に加算済みのため、content.totalRewardをそのまま使う
  // （salesCustomItemsは表示専用でtotalRewardの計算には含まれない。二重加算防止）
  return supabase.from('payment_notices').insert({
    store_id: storeId, cast_id: castId, period_from: content.from, period_to: content.to,
    issued_by: issuedBy,
    cast_name: content.castName, cast_real_name: content.castRealName,
    bank_name: content.bankName, bank_branch: content.bankBranch,
    bank_account_number: content.bankAccountNumber, bank_account_holder: content.bankAccountHolder,
    store_name: content.storeName, logo_url: content.logoUrl,
    reward_rate: content.rewardRate, sales_rows: content.salesRows,
    sales_total: content.salesTotal, base_reward: content.baseReward,
    bonus: content.bonus, deduction: content.deduction,
    custom_items: content.customItems, sales_custom_items: content.salesCustomItems, total_reward: content.totalReward,
    item_config: content.itemConfig as unknown as Json, header_text: content.headerText, footer_text: content.footerText,
  }).select('id').single()
}

export interface NoticeSummaryRow { label: string; text: string }
export interface NoticeSummaryGroups {
  /** 報酬明細ブロック（基本報酬・ボーナス・控除・追加項目など、加算対象の項目一覧） */
  itemRows: NoticeSummaryRow[]
  /** 明細を集計した行（小計・うち消費税）。「今回お支払額」の直前に、明細一覧とは別枠で表示する */
  subtotalRows: NoticeSummaryRow[]
  /** 精算情報ブロック（今回お支払額には影響しない参考情報） */
  settlementRows: NoticeSummaryRow[]
}

// 支払通知書の内訳を、店舗のitemConfig設定（並び順・表示ON/OFF・ラベル）に基づいて
// 「報酬明細」「小計・消費税」「精算情報」の3ブロックに分けて組み立てる。PDF/HTML両方の表示で共通利用する。
// 内税運用が前提のため、小計は常に今回お支払額（totalReward）と同額になる
export function buildNoticeSummaryRows(content: NoticeContent): NoticeSummaryGroups {
  const { itemConfig, salesTotal, rewardRate, baseReward, bonus, deduction, customItems, salesCustomItems, dailySettledAmount, totalReward } = content
  const taxExcluded = Math.floor(totalReward / 1.1)
  const taxAmount = totalReward - taxExcluded
  const itemRows: NoticeSummaryRow[] = []
  const subtotalRows: NoticeSummaryRow[] = []
  const settlementRows: NoticeSummaryRow[] = []
  for (const entry of itemConfig) {
    if (!entry.visible) continue
    switch (entry.key) {
      case 'sales_total':
        itemRows.push({ label: entry.label, text: `¥${salesTotal.toLocaleString()}` })
        break
      case 'reward_rate':
        itemRows.push({ label: entry.label, text: `${(rewardRate * 100).toFixed(1)}%` })
        break
      case 'base_reward':
        itemRows.push({ label: entry.label, text: `¥${baseReward.toLocaleString()}` })
        break
      case 'bonus':
        if (bonus !== 0) itemRows.push({ label: entry.label, text: `+¥${bonus.toLocaleString()}` })
        break
      case 'deduction':
        if (deduction !== 0) itemRows.push({ label: entry.label, text: `-¥${deduction.toLocaleString()}` })
        break
      case 'custom_items':
        for (const item of [...salesCustomItems, ...customItems]) {
          itemRows.push({ label: item.label, text: `${item.amount >= 0 ? '+' : ''}¥${item.amount.toLocaleString()}` })
        }
        break
      case 'tax_breakdown':
        // 内税運用のため、小計は今回お支払額と同額（消費税は加算せず、内訳として表示するのみ）
        subtotalRows.push({ label: '小計', text: `¥${totalReward.toLocaleString()}` })
        subtotalRows.push({ label: entry.label, text: `¥${taxAmount.toLocaleString()}` })
        break
      case 'daily_settled':
        if (dailySettledAmount > 0) settlementRows.push({ label: entry.label, text: `¥${dailySettledAmount.toLocaleString()}` })
        break
    }
  }
  return { itemRows, subtotalRows, settlementRows }
}

// 例: 20260801-20260815_55000_山田太郎_支払通知書.pdf（対象期間(開始日-終了日)_支払額_本名(または源氏名)）
export function noticeFileName(content: Pick<NoticeContent, 'from' | 'to' | 'totalReward' | 'castRealName' | 'castName'>): string {
  const period = `${content.from.replace(/-/g, '')}-${content.to.replace(/-/g, '')}`
  const name = (content.castRealName || content.castName || 'unknown').replace(/[/\\]/g, '-')
  return `${period}_${content.totalReward}_${name}_支払通知書.pdf`
}
