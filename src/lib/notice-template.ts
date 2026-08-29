export type NoticeItemKey =
  | 'sales_total' | 'reward_rate' | 'base_reward' | 'bonus' | 'deduction'
  | 'custom_items' | 'tax_breakdown' | 'daily_settled'

export interface NoticeItemConfigEntry {
  key: NoticeItemKey
  label: string
  visible: boolean
}

export const NOTICE_ITEM_DEFAULT_LABEL: Record<NoticeItemKey, string> = {
  sales_total: '売上合計',
  reward_rate: '報酬率',
  base_reward: '基本報酬',
  bonus: 'ボーナス',
  deduction: '控除',
  custom_items: '追加項目',
  tax_breakdown: 'うち消費税（10%内税）',
  daily_settled: '精算済み金額（参考）',
}

export const NOTICE_ITEM_KEYS = Object.keys(NOTICE_ITEM_DEFAULT_LABEL) as NoticeItemKey[]

export const DEFAULT_NOTICE_ITEM_CONFIG: NoticeItemConfigEntry[] = NOTICE_ITEM_KEYS.map(key => ({
  key, label: NOTICE_ITEM_DEFAULT_LABEL[key], visible: true,
}))

export const DEFAULT_NOTICE_FOOTER_TEXT =
  '※本明細に関するお問い合わせは店舗管理者までご連絡ください\n' +
  '※本支払通知書の受領後、1週間以内に記載内容に誤りがある旨のご連絡がない場合は、記載内容のとおりご確認いただいたものとみなします。'

// 保存されているキーのみ保存順を尊重し、未知のキーは無視、欠けているキーは既定値で末尾に補う
// （将来項目が追加された場合や、壊れた設定値が入っていた場合でも安全にフォールバックするため）
export function parseNoticeItemConfig(raw: unknown): NoticeItemConfigEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_NOTICE_ITEM_CONFIG
  const seen = new Set<string>()
  const result: NoticeItemConfigEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = (item as { key?: unknown }).key
    if (typeof key !== 'string' || !(NOTICE_ITEM_KEYS as string[]).includes(key) || seen.has(key)) continue
    seen.add(key)
    const label = (item as { label?: unknown }).label
    const visible = (item as { visible?: unknown }).visible
    result.push({
      key: key as NoticeItemKey,
      label: typeof label === 'string' && label.trim() !== '' ? label : NOTICE_ITEM_DEFAULT_LABEL[key as NoticeItemKey],
      visible: typeof visible === 'boolean' ? visible : true,
    })
  }
  for (const key of NOTICE_ITEM_KEYS) {
    if (!seen.has(key)) result.push({ key, label: NOTICE_ITEM_DEFAULT_LABEL[key], visible: true })
  }
  return result
}
