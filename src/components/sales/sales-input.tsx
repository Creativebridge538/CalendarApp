'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X, Table2, FileEdit, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { calcPlatformAmount, parsePlatformSettings, type PlatformKey } from '@/lib/platform-earnings'
import { effectiveRewardRate, parsePlatformRewardRates, customItemsTotal, includedInSalesTotal } from '@/lib/reward-rate'
import { NOTICE_ITEM_UNIT_LABEL } from '@/components/settings/notice-item-templates'
import { parseNoticeItemConfig } from '@/lib/notice-template'
import { usePagination } from '@/hooks/use-pagination'
import type { Database } from '@/lib/supabase/database.types'

type SaleInsert = Database['public']['Tables']['sales']['Insert']

interface Sale {
  id: string; cast_id: string; date: string; amount: number | string; notes: string | null
  platform: string; raw_units: number | string | null
  is_daily_payment: boolean; rate_override: number | string | null; reward_rate_override: number | string | null
  daily_payment_at: string | null
  worked_hours: number | string | null
  bonus: number | string; deduction: number | string
  usd_amount: number | string | null; fx_rate_snapshot: number | string | null
  custom_items: unknown
  cast: { display_name: string | null } | null
}

// datetime-local inputは秒・タイムゾーンなしの "yyyy-MM-ddTHH:mm" 形式を要求する
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  casts: { id: string; display_name: string | null; reward_rate: number | string; platform_reward_rates: unknown; daily_payment_reward_rate: number | string | null; platform_daily_payment_reward_rates: unknown }[]
  sales: Sale[]
  storeId: string
  userId: string
  storeSettings: {
    usd_jpy_rate: number | null
    usd_jpy_auto_fetch: boolean
    usd_jpy_adjustment: number
    platform_settings: unknown
    enabled_platforms: string[]
    notice_item_config: unknown
  } | null
  year: number
  month: number
  stageNamesByCastId: Record<string, string[]>
  itemTemplates: { id: string; label: string; unit: string; include_in_sales: boolean }[]
}

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

function defaultDateFor(year: number, month: number): string {
  const now = new Date()
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month
  return isCurrentMonth ? format(now, 'yyyy-MM-dd') : `${year}-${String(month).padStart(2, '0')}-01`
}


// 日払いの報酬率上書き（%）は同じ値を繰り返し使うことが多いため、店舗ごとにブラウザへ保存し次回から選べるようにする
function rateTemplateKey(storeId: string): string {
  return `sales-reward-rate-override-templates:${storeId}`
}
function loadRateTemplates(storeId: string): number[] {
  try {
    const raw = localStorage.getItem(rateTemplateKey(storeId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
function saveRateTemplate(storeId: string, value: number): number[] {
  const next = [value, ...loadRateTemplates(storeId).filter(v => v !== value)].slice(0, 8)
  try {
    localStorage.setItem(rateTemplateKey(storeId), JSON.stringify(next))
  } catch {
    // localStorageが使えない環境ではテンプレ保存を諦める（機能自体への影響はない）
  }
  return next
}

// スプレッドシートからのコピペを想定した一括登録行。列の並びは可視の表の並び（pasteColumns）と対応させる
// （プラットフォームは行ごとに個別設定するため、貼り付け列の対応には含めない）
interface BulkRow {
  id: string
  date: string
  castName: string
  platform: 'manual' | PlatformKey
  amount: string
  // テンプレートID -> 入力値（円単位ならそのまま金額、プラットフォーム単位なら数量）
  customItems: Record<string, string>
  worked_hours: string
  bonus: string
  deduction: string
  notes: string
}
type BulkFixedColumn = 'date' | 'castName' | 'platform' | 'amount' | 'worked_hours' | 'bonus' | 'deduction' | 'notes'

export function SalesInput({ casts, sales: initialSales, storeId, userId, storeSettings, year, month, stageNamesByCastId, itemTemplates }: Props) {
  const emptyForm = useMemo(() => ({
    cast_id: '', date: defaultDateFor(year, month),
    platform: 'manual' as 'manual' | PlatformKey,
    amount: '', raw_units: '',
    is_daily_payment: false, rate_override: '', reward_rate_override: '', daily_payment_at: '',
    notes: '', worked_hours: '', bonus: '', deduction: '',
    custom_items: [] as { templateId: string; label: string; unit: string; rawUnits: string; amount: string }[],
  }), [year, month])
  const emptyBulkRow = (date?: string): BulkRow => ({
    id: crypto.randomUUID(), date: date ?? defaultDateFor(year, month),
    castName: '', platform: 'manual', amount: '',
    customItems: Object.fromEntries(itemTemplates.map(t => [t.id, ''])),
    worked_hours: '', bonus: '', deduction: '', notes: '',
  })
  // その月の全日分の行を用意する（まとめて登録は「1ヶ月分を一気に埋める」用途が中心のため）
  const daysInMonthRows = (): BulkRow[] => {
    const count = new Date(year, month, 0).getDate()
    return Array.from({ length: count }, (_, i) =>
      emptyBulkRow(`${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
    )
  }
  const [sales, setSales] = useState(initialSales)
  const [form, setForm] = useState(emptyForm)
  // キャストの主な源氏名（display_name）と追加の源氏名、どれを選んでも同じキャストとして登録できるようにする
  const castOptions = useMemo(() => casts.flatMap(c => [
    { key: c.id, castId: c.id, label: c.display_name ?? c.id },
    ...(stageNamesByCastId[c.id] ?? []).map((name, i) => ({ key: `${c.id}#${i}`, castId: c.id, label: name })),
  ]), [casts, stageNamesByCastId])
  const [castOptionKey, setCastOptionKey] = useState('')
  const enabledPlatforms = storeSettings?.enabled_platforms ?? ['stripchat', 'fc2', 'dxlive']
  const [editing, setEditing] = useState<Sale | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => daysInMonthRows())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkCastFill, setBulkCastFill] = useState('')
  const [bulkPlatformFill, setBulkPlatformFill] = useState<'manual' | PlatformKey>('manual')
  const [filterCast, setFilterCast] = useState('all')
  const [filterPlatform, setFilterPlatform] = useState('all')
  // 表示中の月をデフォルトの絞り込み期間にする
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = (() => {
    const lastDay = new Date(year, month, 0).getDate()
    return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  })()
  const [filterFrom, setFilterFrom] = useState(monthStart)
  const [filterTo, setFilterTo] = useState(monthEnd)
  const supabase = createClient()

  // サーバーからは表示中の月（monthStart〜monthEnd）分の売上しか渡ってきていないため、
  // 絞り込みの日付範囲がその月の外にはみ出た場合は、その範囲分をサーバーから改めて取得し直す
  // （そうしないと「開始日/終了日」で他の月を指定しても、まだ手元にないデータのため何も出てこない）
  const [salesLoading, setSalesLoading] = useState(false)
  const loadedRangeRef = useRef({ from: monthStart, to: monthEnd })
  useEffect(() => {
    const from = filterFrom || monthStart
    const to = filterTo || monthEnd
    if (from === loadedRangeRef.current.from && to === loadedRangeRef.current.to) return
    const timer = setTimeout(async () => {
      setSalesLoading(true)
      const { data, error } = await supabase.from('sales')
        .select('*, cast:users!sales_cast_id_fkey(display_name)')
        .eq('store_id', storeId).gte('date', from).lte('date', to)
        .order('date', { ascending: false })
      setSalesLoading(false)
      if (error) { toast.error('売上データの取得に失敗しました'); return }
      setSales(data ?? [])
      loadedRangeRef.current = { from, to }
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase/storeId/monthStart/monthEndは同一マウント中は不変のためdepsから除外
  }, [filterFrom, filterTo])

  const platformSettings = useMemo(() => parsePlatformSettings(storeSettings?.platform_settings), [storeSettings])
  // 支払通知書のテンプレート設定でボーナス・控除を非表示にしている店舗では、
  // 使わない項目として売上登録フォームからも欄を隠す。項目名を変更している場合はその名称を使う
  const noticeItemConfig = useMemo(() => parseNoticeItemConfig(storeSettings?.notice_item_config), [storeSettings])
  const bonusEntry = noticeItemConfig.find(e => e.key === 'bonus')
  const deductionEntry = noticeItemConfig.find(e => e.key === 'deduction')
  const bonusFieldVisible = bonusEntry?.visible ?? true
  const deductionFieldVisible = deductionEntry?.visible ?? true
  const bonusFieldLabel = bonusEntry?.label || 'ボーナス'
  const deductionFieldLabel = deductionEntry?.label || '控除'
  const autoFetchFx = storeSettings?.usd_jpy_auto_fetch ?? false
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null)

  useEffect(() => {
    if (!autoFetchFx) return
    fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => { if (typeof data?.rates?.JPY === 'number') setLiveFxRate(data.rates.JPY) })
      .catch(() => {})
  }, [autoFetchFx])

  // 自動取得がオンで取得に成功していればその場のレート＋調整額を使い、
  // 失敗時やオフの場合は店舗設定の手動レートにフォールバックする
  const usdJpyRate = autoFetchFx && liveFxRate != null
    ? liveFxRate + (storeSettings?.usd_jpy_adjustment ?? 0)
    : storeSettings?.usd_jpy_rate ?? null

  const castRewardRateById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of casts) map[c.id] = Number(c.reward_rate)
    return map
  }, [casts])
  const castPlatformRatesById = useMemo(() => {
    const map: Record<string, ReturnType<typeof parsePlatformRewardRates>> = {}
    for (const c of casts) map[c.id] = parsePlatformRewardRates(c.platform_reward_rates)
    return map
  }, [casts])
  const castDailyRateById = useMemo(() => {
    const map: Record<string, number | string | null> = {}
    for (const c of casts) map[c.id] = c.daily_payment_reward_rate
    return map
  }, [casts])
  const castPlatformDailyRatesById = useMemo(() => {
    const map: Record<string, ReturnType<typeof parsePlatformRewardRates>> = {}
    for (const c of casts) map[c.id] = parsePlatformRewardRates(c.platform_daily_payment_reward_rates)
    return map
  }, [casts])

  // プラットフォーム単位（トークン・ポイント）の追加項目を、店舗の粗売上ベース（報酬率を掛ける前）の
  // 金額に円換算する。円単位の項目はそのまま数値を返す
  function calcSalesAmount(unit: string, rawUnits: string): number {
    const units = parseFloat(rawUnits) || 0
    if (unit === 'jpy') return units
    return calcPlatformAmount(unit as PlatformKey, units, platformSettings[unit as PlatformKey], usdJpyRate, null).jpy
  }

  // プラットフォーム単位（トークン・ポイント）の追加項目は、換算後の売上額をそのまま使うのではなく、
  // このキャストの報酬率を掛けた女子給ベースの金額にする（通知書には売上ではなく女子給を載せるため）
  function calcItemAmount(unit: string, rawUnits: string): number {
    if (unit === 'jpy') return calcSalesAmount(unit, rawUnits)
    const rate = effectiveRewardRate(
      {
        platform: unit,
        is_daily_payment: form.is_daily_payment,
        reward_rate_override: form.is_daily_payment && form.reward_rate_override ? parseFloat(form.reward_rate_override) / 100 : null,
      },
      castRewardRateById[form.cast_id] ?? 0,
      castPlatformRatesById[form.cast_id],
      castDailyRateById[form.cast_id],
      castPlatformDailyRatesById[form.cast_id]
    )
    return Math.floor(calcSalesAmount(unit, rawUnits) * rate)
  }

  // まとめて登録用: 1件ずつ登録のcalcItemAmountと同じ計算だが、対象キャストをform.cast_idではなく引数で受け取る
  // （まとめて登録の日払い扱いは常にfalseのため、reward_rate_overrideも常にnull）
  function calcBulkItemAmount(cast: { id: string }, unit: string, rawUnits: string): number {
    if (unit === 'jpy') return calcSalesAmount(unit, rawUnits)
    const rate = effectiveRewardRate(
      { platform: unit, is_daily_payment: false, reward_rate_override: null },
      castRewardRateById[cast.id] ?? 0,
      castPlatformRatesById[cast.id],
      castDailyRateById[cast.id],
      castPlatformDailyRatesById[cast.id]
    )
    return Math.floor(calcSalesAmount(unit, rawUnits) * rate)
  }

  const filteredSales = useMemo(() => sales.filter(s =>
    (filterCast === 'all' || s.cast_id === filterCast)
    && (filterPlatform === 'all' || s.platform === filterPlatform)
    && (!filterFrom || s.date >= filterFrom)
    && (!filterTo || s.date <= filterTo)
  ), [sales, filterCast, filterPlatform, filterFrom, filterTo])
  const filtersActive = filterCast !== 'all' || filterPlatform !== 'all' || !!filterFrom || !!filterTo
  const { page, setPage, pageSize, setPageSize, totalPages, paged: pagedSales, totalItems } = usePagination(filteredSales)

  const [rateTemplates, setRateTemplates] = useState<number[]>([])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage はマウント後にしか読めないため
    setRateTemplates(loadRateTemplates(storeId))
  }, [storeId])
  function applyRateTemplate(value: number, target: 'form' | 'bulkDaily') {
    if (target === 'form') setForm(f => ({ ...f, reward_rate_override: String(value) }))
    else setBulkDailyRate(String(value))
  }
  function rememberRateTemplate(value: number) {
    setRateTemplates(saveRateTemplate(storeId, value))
  }

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dailyDialogOpen, setDailyDialogOpen] = useState(false)
  const [bulkDailyRate, setBulkDailyRate] = useState('')
  const [bulkDailyAt, setBulkDailyAt] = useState('')
  const [bulkDailySaving, setBulkDailySaving] = useState(false)

  function toggleAllSelected() {
    const allSelected = filteredSales.length > 0 && filteredSales.every(s => selected.has(s.id))
    setSelected(allSelected ? new Set() : new Set(filteredSales.map(s => s.id)))
  }
  function toggleOneSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDailyChange() {
    const targets = filteredSales.filter(s => selected.has(s.id))
    if (targets.length === 0) { toast.error('対象の売上を選択してください'); return }
    const pct = bulkDailyRate ? parseFloat(bulkDailyRate) : null
    const at = bulkDailyAt ? new Date(bulkDailyAt).toISOString() : new Date().toISOString()

    setBulkDailySaving(true)
    const results = await Promise.all(targets.map(async s => {
      const { data, error } = await supabase.from('sales')
        .update({
          is_daily_payment: true,
          daily_payment_at: at,
          reward_rate_override: pct != null && !Number.isNaN(pct) ? pct / 100 : null,
        })
        .eq('id', s.id)
        .select('id')
      const ok = !error && !!data && data.length > 0
      if (!ok) console.error('[bulk-daily-change] update failed', { id: s.id, error })
      return { id: s.id, ok }
    }))
    setBulkDailySaving(false)

    const succeeded = new Set(results.filter(r => r.ok).map(r => r.id))
    if (succeeded.size > 0) {
      setSales(prev => prev.map(s => succeeded.has(s.id)
        ? { ...s, is_daily_payment: true, daily_payment_at: at, reward_rate_override: pct != null && !Number.isNaN(pct) ? pct / 100 : null }
        : s
      ))
    }
    if (pct != null && !Number.isNaN(pct)) rememberRateTemplate(pct)

    const failedCount = targets.length - succeeded.size
    if (failedCount > 0) {
      toast.error(`${succeeded.size}件を日払いに変更しました（${failedCount}件は失敗）`)
    } else {
      toast.success(`${succeeded.size}件を日払いに変更しました`)
      setSelected(new Set())
      setDailyDialogOpen(false)
      setBulkDailyRate('')
      setBulkDailyAt('')
    }
  }

  const [fxDialogOpen, setFxDialogOpen] = useState(false)
  const [fxNewRate, setFxNewRate] = useState('')
  const [fxSaving, setFxSaving] = useState(false)

  // 為替レートが実際に金額計算へ影響する行だけを対象にする
  // （FC2は円建てのため対象外／固定単価モードのプラットフォームも対象外／日払いのレート上書き行はそちらが優先されるため対象外）
  function usesFxRate(platform: string): boolean {
    if (platform === 'manual' || platform === 'fc2') return false
    const config = platformSettings[platform as PlatformKey]
    return (config?.mode ?? 'formula') !== 'fixed'
  }
  const fxTargets = useMemo(
    () => filteredSales.filter(s => selected.has(s.id) && usesFxRate(s.platform) && s.raw_units != null && s.rate_override == null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredSales, selected, platformSettings]
  )

  async function handleFxBulkChange() {
    const newRate = parseFloat(fxNewRate)
    if (!newRate || newRate <= 0) { toast.error('為替レートを入力してください'); return }
    if (fxTargets.length === 0) { toast.error('対象の売上がありません'); return }

    setFxSaving(true)
    const results = await Promise.all(fxTargets.map(async s => {
      const platform = s.platform as PlatformKey
      const rawUnits = Number(s.raw_units)
      const before = Number(s.amount)
      const converted = calcPlatformAmount(platform, rawUnits, platformSettings[platform], newRate, null)
      // RLSの条件に一致しない場合、Supabaseはerrorを返さず0件更新のまま成功扱いになることがあるため、
      // 実際に更新された行をselectで確認する（他の保存処理と同じパターン）
      const { data, error } = await supabase.from('sales')
        .update({ amount: converted.jpy, usd_amount: converted.usd, fx_rate_snapshot: newRate })
        .eq('id', s.id)
        .select('id')
      const ok = !error && !!data && data.length > 0
      if (!ok) console.error('[fx-bulk-change] update failed', { id: s.id, error, matched: data?.length ?? 0 })
      return { id: s.id, ok, before, after: converted.jpy, errorMessage: error?.message ?? null }
    }))
    setFxSaving(false)

    const succeeded = results.filter(r => r.ok)
    const failed = results.filter(r => !r.ok)
    if (succeeded.length > 0) {
      const amountById = new Map(succeeded.map(r => [r.id, r.after]))
      setSales(prev => prev.map(s => amountById.has(s.id) ? { ...s, amount: amountById.get(s.id)! } : s))
    }
    if (failed.length > 0) {
      const reason = failed[0].errorMessage ?? '更新条件に一致しませんでした（権限設定をご確認ください）'
      toast.error(`${succeeded.length}件更新しました（${failed.length}件は失敗: ${reason}）`)
    } else {
      const changed = succeeded.filter(r => r.before !== r.after)
      if (changed.length === 0) {
        // 更新自体は成功しているが、再計算後の金額が元と一致していた場合（同じレートを入力した等）
        toast.success(`${succeeded.length}件を更新しましたが、金額は変わりませんでした（例: ¥${succeeded[0].before.toLocaleString()} → ¥${succeeded[0].after.toLocaleString()}）`)
      } else {
        const sample = changed[0]
        toast.success(`${succeeded.length}件の為替レートを更新しました（例: ¥${sample.before.toLocaleString()} → ¥${sample.after.toLocaleString()}）`)
      }
      setFxDialogOpen(false)
      setFxNewRate('')
    }
  }

  // 「売上に反映する」設定がオンのテンプレート項目は、その分も売上合計に加算する
  const includedInSalesLabels = useMemo(
    () => new Set(itemTemplates.filter(t => t.include_in_sales).map(t => t.label)),
    [itemTemplates]
  )
  const monthlyTotal = useMemo(() => filteredSales.reduce((sum, s) =>
    sum + Number(s.amount) + includedInSalesTotal(s.custom_items, includedInSalesLabels), 0
  ), [filteredSales, includedInSalesLabels])
  const monthlyRewardTotal = useMemo(() => filteredSales.reduce((sum, s) => {
    const rate = effectiveRewardRate(s, castRewardRateById[s.cast_id] ?? 0, castPlatformRatesById[s.cast_id], castDailyRateById[s.cast_id], castPlatformDailyRatesById[s.cast_id])
    return sum + Math.floor(Number(s.amount) * rate) + Number(s.bonus) - Number(s.deduction) + customItemsTotal(s.custom_items)
  }, 0), [filteredSales, castRewardRateById, castPlatformRatesById, castDailyRateById, castPlatformDailyRatesById])

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }

  const preview = useMemo(() => {
    if (form.platform === 'manual') return null
    const rawUnits = parseFloat(form.raw_units) || 0
    const override = form.is_daily_payment && form.rate_override ? parseFloat(form.rate_override) : null
    return calcPlatformAmount(form.platform, rawUnits, platformSettings[form.platform], usdJpyRate, override)
  }, [form.platform, form.raw_units, form.is_daily_payment, form.rate_override, platformSettings, usdJpyRate])

  // 「売上に反映する」設定がオンの追加項目は、プレビューの売上額にもその場で加算して見せる
  const formIncludedSalesTotal = useMemo(() => form.custom_items.reduce((sum, item) => {
    if (!includedInSalesLabels.has(item.label)) return sum
    return sum + (item.unit === 'jpy' ? (parseFloat(item.amount) || 0) : calcSalesAmount(item.unit, item.rawUnits))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calcSalesAmountはplatformSettings/usdJpyRateに依存する関数のため、それらをdepsに含める
  }, 0), [form.custom_items, includedInSalesLabels, platformSettings, usdJpyRate])

  // テンプレート登録済みの追加項目を、値未入力の状態でデフォルト項目としてあらかじめ並べておく
  function defaultCustomItemsFromTemplates() {
    return itemTemplates.map(t => ({ templateId: t.id, label: t.label, unit: t.unit, rawUnits: '', amount: '' }))
  }

  function openCreate() {
    setForm({ ...emptyForm, custom_items: defaultCustomItemsFromTemplates() })
    setCastOptionKey('')
    setEditing(null)
    setMode('single')
    setBulkRows(daysInMonthRows())
    setDialogOpen(true)
  }

  function applyCastToAllRows() {
    const cast = casts.find(c => c.id === bulkCastFill)
    if (!cast) return
    setBulkRows(rows => rows.map(r => ({ ...r, castName: cast.display_name ?? '' })))
  }

  function applyPlatformToAllRows() {
    setBulkRows(rows => rows.map(r => ({ ...r, platform: bulkPlatformFill })))
  }

  function startEdit(sale: Sale) {
    setEditing(sale)
    setCastOptionKey(sale.cast_id)
    // 既存の追加項目のうち、テンプレートと項目名が一致するものはそのテンプレートのデフォルト欄に値を復元し、
    // 一致しないもの（テンプレート削除後や自由入力分）はその他の項目として残す
    const existingItems = (Array.isArray(sale.custom_items) ? sale.custom_items as { label: string; amount: number; unit?: string; rawUnits?: string }[] : [])
    const usedLabels = new Set<string>()
    const templateItems = itemTemplates.map(t => {
      const match = existingItems.find(i => i.label === t.label)
      if (match) usedLabels.add(match.label)
      return { templateId: t.id, label: t.label, unit: t.unit, rawUnits: match?.rawUnits ?? '', amount: match ? String(match.amount) : '' }
    })
    const extraItems = existingItems.filter(i => !usedLabels.has(i.label))
      .map(i => ({ templateId: '', label: i.label, unit: i.unit ?? 'jpy', rawUnits: i.rawUnits ?? '', amount: String(i.amount) }))
    setForm({
      cast_id: sale.cast_id,
      date: sale.date,
      platform: (sale.platform as 'manual' | PlatformKey) ?? 'manual',
      amount: String(sale.amount),
      raw_units: sale.raw_units != null ? String(sale.raw_units) : '',
      custom_items: [...templateItems, ...extraItems],
      is_daily_payment: sale.is_daily_payment,
      rate_override: sale.rate_override != null ? String(sale.rate_override) : '',
      reward_rate_override: sale.reward_rate_override != null ? String(Number(sale.reward_rate_override) * 100) : '',
      daily_payment_at: sale.daily_payment_at ? toDatetimeLocal(sale.daily_payment_at) : '',
      notes: sale.notes ?? '',
      worked_hours: sale.worked_hours != null ? String(sale.worked_hours) : '',
      bonus: Number(sale.bonus) ? String(sale.bonus) : '',
      deduction: Number(sale.deduction) ? String(sale.deduction) : '',
    })
    setMode('single')
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.cast_id) { toast.error('キャストは必須です'); return }
    if (form.platform === 'manual' && !form.amount) { toast.error('金額は必須です'); return }
    if (form.platform !== 'manual' && !form.raw_units) { toast.error('数量は必須です'); return }

    const isPlatform = form.platform !== 'manual'
    const amount = isPlatform ? (preview?.jpy ?? 0) : parseInt(form.amount)

    const payload = {
      cast_id: form.cast_id,
      date: form.date,
      platform: form.platform,
      amount,
      raw_units: isPlatform ? parseFloat(form.raw_units) : null,
      usd_amount: isPlatform ? preview?.usd ?? null : null,
      fx_rate_snapshot: isPlatform ? usdJpyRate : null,
      is_daily_payment: form.is_daily_payment,
      rate_override: form.is_daily_payment && isPlatform && form.rate_override ? parseFloat(form.rate_override) : null,
      reward_rate_override: form.is_daily_payment && form.reward_rate_override ? parseFloat(form.reward_rate_override) / 100 : null,
      // 日時が未入力なら「不明」として null のままにする（チェック時に自動入力されるため、
      // 空欄になるのは移行前の既存行を編集した場合のみ。これを現在時刻で埋めてしまうと
      // チェックと無関係な編集のたびに日時が上書きされてしまう）
      daily_payment_at: form.is_daily_payment && form.daily_payment_at
        ? new Date(form.daily_payment_at).toISOString()
        : null,
      notes: form.notes || null,
      worked_hours: form.worked_hours ? parseFloat(form.worked_hours) : null,
      bonus: form.bonus ? parseInt(form.bonus) : 0,
      deduction: form.deduction ? parseInt(form.deduction) : 0,
      // unit/rawUnitsも保存しておくことで、編集時に円換算前の入力値をそのまま復元できるようにする。
      // salesAmountは報酬率を掛ける前の売上ベースの金額（「売上に反映する」設定の項目を売上合計に足す際に使う）
      custom_items: form.custom_items
        .filter(i => i.label.trim() !== '')
        .map(i => ({
          label: i.label.trim(), unit: i.unit, rawUnits: i.rawUnits,
          amount: i.unit === 'jpy' ? (parseFloat(i.amount) || 0) : calcItemAmount(i.unit, i.rawUnits),
          salesAmount: calcSalesAmount(i.unit, i.rawUnits),
        }))
        // デフォルト項目は未入力のまま保存しないよう、金額が0の行は除外する
        .filter(i => i.amount !== 0),
      store_id: storeId,
      created_by: userId,
    }

    if (form.is_daily_payment && form.reward_rate_override) {
      const pct = parseFloat(form.reward_rate_override)
      if (!Number.isNaN(pct)) rememberRateTemplate(pct)
    }

    if (editing) {
      const { data, error } = await supabase.from('sales').update(payload).eq('id', editing.id).select('id')
      if (error || !data || data.length === 0) { toast.error('更新に失敗しました'); return }
      const cast = casts.find(c => c.id === form.cast_id)
      setSales(sales.map(s => s.id === editing.id ? { ...s, ...payload, cast: cast ? { display_name: cast.display_name } : null } : s))
      setEditing(null)
      toast.success('売上を更新しました')
    } else {
      const { data, error } = await supabase.from('sales').insert(payload).select('*, cast:users!sales_cast_id_fkey(display_name)').single()
      if (error) { toast.error('登録に失敗しました'); return }
      setSales([data, ...sales])
      toast.success('売上を登録しました')
    }
    setForm(emptyForm)
    setDialogOpen(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('削除しますか？')) return
    const { error } = await supabase.from('sales').delete().eq('id', id)
    if (error) { toast.error('削除に失敗しました'); return }
    setSales(sales.filter(s => s.id !== id))
    toast.success('削除しました')
  }

  // 貼り付け・入力欄の列の並び（可視の表と同じ順序）。ボーナス・控除欄は店舗設定で非表示の場合は含めない
  const pasteColumns = useMemo(() => [
    'date', 'castName', 'amount',
    ...itemTemplates.map(t => `item:${t.id}`),
    'worked_hours',
    ...(bonusFieldVisible ? ['bonus'] : []),
    ...(deductionFieldVisible ? ['deduction'] : []),
    'notes',
  ], [itemTemplates, bonusFieldVisible, deductionFieldVisible])
  function pasteColIndex(key: string): number {
    return pasteColumns.indexOf(key)
  }

  function applyFieldValue(row: BulkRow, col: string, value: string): BulkRow {
    if (col.startsWith('item:')) {
      return { ...row, customItems: { ...row.customItems, [col.slice(5)]: value } }
    }
    switch (col as BulkFixedColumn) {
      case 'date': return { ...row, date: value }
      case 'castName': return { ...row, castName: value }
      case 'platform': return { ...row, platform: value as 'manual' | PlatformKey }
      case 'amount': return { ...row, amount: value }
      case 'worked_hours': return { ...row, worked_hours: value }
      case 'bonus': return { ...row, bonus: value }
      case 'deduction': return { ...row, deduction: value }
      case 'notes': return { ...row, notes: value }
      default: return row
    }
  }

  function updateBulkCell(rowId: string, col: BulkFixedColumn | `item:${string}`, value: string) {
    setBulkRows(rows => rows.map(r => r.id === rowId ? applyFieldValue(r, col, value) : r))
  }

  function addBulkRow() {
    setBulkRows(rows => [...rows, emptyBulkRow(rows.at(-1)?.date)])
  }

  function removeBulkRow(rowId: string) {
    setBulkRows(rows => rows.filter(r => r.id !== rowId))
  }

  // スプレッドシートからタブ区切り・改行区切りで貼り付けた内容を、貼り付け開始セルを起点にグリッドへ展開する
  function handleBulkPaste(e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\t') && !text.includes('\n')) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n')
    while (lines.length > 0 && lines.at(-1) === '') lines.pop()
    const grid = lines.map(line => line.split('\t'))

    setBulkRows(rows => {
      const next = [...rows]
      grid.forEach((cols, i) => {
        const targetIndex = rowIndex + i
        while (next.length <= targetIndex) next.push(emptyBulkRow())
        let row = next[targetIndex]
        cols.forEach((val, j) => {
          const col = pasteColumns[colIndex + j]
          if (col) row = applyFieldValue(row, col, val.trim())
        })
        next[targetIndex] = row
      })
      return next
    })
  }

  async function handleBulkSubmit() {
    // dateは常にデフォルト値が入っており、キャスト名も一括設定で全行に入りうるため、
    // 金額が実際に入力されている行だけを登録対象にする（キャストだけ入っていて金額が空の行はスルー）
    const nonEmptyRows = bulkRows.filter(r => r.amount.trim())
    if (nonEmptyRows.length === 0) { toast.error('入力された行がありません'); return }

    const payloads: SaleInsert[] = []
    const errorRows: number[] = []

    nonEmptyRows.forEach((row, idx) => {
      const cast = casts.find(c => castOptions.some(o => o.castId === c.id && o.label.trim() === row.castName.trim()))
      const amountVal = parseFloat(row.amount)
      if (!cast || !row.date || row.amount === '' || Number.isNaN(amountVal)) { errorRows.push(idx + 1); return }
      const rowPlatform = row.platform
      const isPlatform = rowPlatform !== 'manual'
      const converted = rowPlatform !== 'manual' ? calcPlatformAmount(rowPlatform, amountVal, platformSettings[rowPlatform], usdJpyRate, null) : null
      // 1件ずつ登録と同様、テンプレート項目に入力があれば追加項目として保存する
      // （unit/rawUnitsも保存し、編集時に円換算前の入力値をそのまま復元できるようにする。
      // salesAmountは報酬率を掛ける前の売上ベースの金額）
      const customItemsPayload = itemTemplates
        .map(t => {
          const rawUnits = row.customItems[t.id] ?? ''
          if (!rawUnits.trim()) return null
          const amount = t.unit === 'jpy' ? (parseFloat(rawUnits) || 0) : calcBulkItemAmount(cast, t.unit, rawUnits)
          return { label: t.label, unit: t.unit, rawUnits, amount, salesAmount: calcSalesAmount(t.unit, rawUnits) }
        })
        .filter((i): i is NonNullable<typeof i> => i !== null && i.amount !== 0)
      payloads.push({
        cast_id: cast.id, date: row.date, platform: row.platform,
        amount: isPlatform ? (converted?.jpy ?? 0) : Math.round(amountVal),
        raw_units: isPlatform ? amountVal : null,
        usd_amount: isPlatform ? converted?.usd ?? null : null,
        fx_rate_snapshot: isPlatform ? usdJpyRate : null,
        is_daily_payment: false, rate_override: null, reward_rate_override: null,
        notes: row.notes || null,
        worked_hours: row.worked_hours ? parseFloat(row.worked_hours) : null,
        bonus: bonusFieldVisible && row.bonus ? parseInt(row.bonus) : 0,
        deduction: deductionFieldVisible && row.deduction ? parseInt(row.deduction) : 0,
        custom_items: customItemsPayload,
        store_id: storeId, created_by: userId,
      })
    })

    if (errorRows.length > 0) {
      toast.error(`${errorRows.length}行に不備があります（${errorRows.join('、')}行目）。キャスト名・日付・金額を確認してください`)
      return
    }

    setBulkSaving(true)
    const { data, error } = await supabase.from('sales').insert(payloads).select('*, cast:users!sales_cast_id_fkey(display_name)')
    setBulkSaving(false)
    if (error) { toast.error('一括登録に失敗しました'); return }
    setSales([...(data ?? []), ...sales])
    toast.success(`${data?.length ?? 0}件の売上を登録しました`)
    setBulkRows(daysInMonthRows())
    setDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>売上一覧 — {year}年{month}月</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {filtersActive ? '絞り込み合計' : '月合計'}: ¥{monthlyTotal.toLocaleString()}
                <span className="mx-1.5 text-border">・</span>
                女子給合計: ¥{monthlyRewardTotal.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                現在の為替レート: {usdJpyRate != null ? `¥${usdJpyRate.toFixed(2)}/$` : '未設定'}
                {autoFetchFx && (
                  <span className="ml-1">
                    （{liveFxRate != null ? '自動取得' : '取得失敗のため手動設定にフォールバック'}）
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Link href={`/admin/sales?year=${prev.year}&month=${prev.month}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />前月
              </Link>
              <Link href={`/admin/sales?year=${next.year}&month=${next.month}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                翌月<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Link>
              <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setFxDialogOpen(true)}><RefreshCw className="h-3.5 w-3.5 mr-1" />為替を一括変更</Button>
              <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setDailyDialogOpen(true)}>
                選択した{selected.size}件を日払いに変更
              </Button>
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />追加</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 flex-wrap mb-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">開始日</Label>
              <Input type="date" className="w-40" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(1) }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">終了日</Label>
              <Input type="date" className="w-40" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(1) }} />
            </div>
            <Select value={filterCast} onValueChange={v => { if (v) { setFilterCast(v); setPage(1) } }}>
              <SelectTrigger className="w-40">
                <SelectValue>
                  {filterCast === 'all' ? '全キャスト' : (casts.find(c => c.id === filterCast)?.display_name ?? filterCast)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">全キャスト</SelectItem>
                {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={v => { if (v) { setFilterPlatform(v); setPage(1) } }}>
              <SelectTrigger className="w-36">
                <SelectValue>{filterPlatform === 'all' ? '全プラットフォーム' : PLATFORM_LABEL[filterPlatform]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全プラットフォーム</SelectItem>
                <SelectItem value="manual">手入力</SelectItem>
                <SelectItem value="stripchat">STRIPCHAT</SelectItem>
                <SelectItem value="fc2">FC2</SelectItem>
                <SelectItem value="dxlive">DXライブ</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button size="sm" variant="ghost" onClick={() => { setFilterCast('all'); setFilterPlatform('all'); setFilterFrom(''); setFilterTo(''); setPage(1) }}>
                <X className="h-3.5 w-3.5 mr-1" />絞り込みを解除
              </Button>
            )}
            {salesLoading && <span className="text-xs text-muted-foreground">読み込み中...</span>}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filteredSales.length > 0 && filteredSales.every(s => selected.has(s.id))}
                    onCheckedChange={toggleAllSelected}
                    disabled={filteredSales.length === 0}
                  />
                </TableHead>
                <TableHead>日付</TableHead>
                <TableHead>キャスト</TableHead>
                <TableHead>稼働時間</TableHead>
                <TableHead>プラットフォーム</TableHead>
                <TableHead className="text-right">為替</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">女子給</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSales.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  {filtersActive ? '絞り込み条件に一致する売上がありません' : '売上データがありません'}
                </TableCell></TableRow>
              )}
              {pagedSales.map(sale => {
                const baseReward = Math.floor(Number(sale.amount) * effectiveRewardRate(sale, castRewardRateById[sale.cast_id] ?? 0, castPlatformRatesById[sale.cast_id], castDailyRateById[sale.cast_id], castPlatformDailyRatesById[sale.cast_id]))
                const customTotal = customItemsTotal(sale.custom_items)
                const reward = baseReward + Number(sale.bonus) - Number(sale.deduction) + customTotal
                const salesAmount = Number(sale.amount) + includedInSalesTotal(sale.custom_items, includedInSalesLabels)
                return (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <Checkbox checked={selected.has(sale.id)} onCheckedChange={() => toggleOneSelected(sale.id)} />
                    </TableCell>
                    <TableCell>{format(new Date(sale.date), 'M/d(E)', { locale: ja })}</TableCell>
                    <TableCell>{sale.cast?.display_name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {sale.worked_hours != null ? `${Number(sale.worked_hours)}h` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge variant="outline">{PLATFORM_LABEL[sale.platform] ?? sale.platform}</Badge>
                        {sale.is_daily_payment && (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            日払い済み{sale.daily_payment_at && `（${format(new Date(sale.daily_payment_at), 'M/d HH:mm', { locale: ja })}）`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                      {sale.fx_rate_snapshot != null ? (
                        <>
                          ¥{Number(sale.fx_rate_snapshot).toFixed(2)}/$
                          {sale.usd_amount != null && (
                            <span className="block">(${Number(sale.usd_amount).toFixed(2)})</span>
                          )}
                        </>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">¥{salesAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      ¥{reward.toLocaleString()}
                      {(Number(sale.bonus) > 0 || Number(sale.deduction) > 0 || customTotal !== 0) && (
                        <span className="block text-[10px] text-muted-foreground">
                          {Number(sale.bonus) > 0 && `+¥${Number(sale.bonus).toLocaleString()}`}
                          {Number(sale.bonus) > 0 && Number(sale.deduction) > 0 && ' '}
                          {Number(sale.deduction) > 0 && `-¥${Number(sale.deduction).toLocaleString()}`}
                          {customTotal !== 0 && ` ${customTotal > 0 ? '+' : ''}¥${customTotal.toLocaleString()}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{sale.notes ?? '—'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(sale)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(sale.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            page={page} totalPages={totalPages} pageSize={pageSize} totalItems={totalItems}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={mode === 'bulk' ? 'sm:max-w-4xl' : 'sm:max-w-lg'}>
          <DialogHeader>
            <DialogTitle>{editing ? '売上を編集' : '売上を登録'}</DialogTitle>
          </DialogHeader>

          {!editing && (
            <div className="inline-flex rounded-md border p-0.5 w-fit">
              <button
                type="button" onClick={() => setMode('single')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors', mode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
              >
                <FileEdit className="h-3.5 w-3.5" />1件ずつ
              </button>
              <button
                type="button" onClick={() => setMode('bulk')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors', mode === 'bulk' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
              >
                <Table2 className="h-3.5 w-3.5" />まとめて登録
              </button>
            </div>
          )}

          {mode === 'single' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label required>キャスト</Label>
                  <Select
                    value={castOptionKey}
                    onValueChange={v => {
                      if (!v) return
                      const opt = castOptions.find(o => o.key === v)
                      if (!opt) return
                      setCastOptionKey(v)
                      setForm({ ...form, cast_id: opt.castId })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選択">
                        {castOptionKey ? castOptions.find(o => o.key === castOptionKey)?.label : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {castOptions.map(o => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label required>日付</Label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                {enabledPlatforms.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>プラットフォーム</Label>
                    <Select value={form.platform} onValueChange={v => { if (v) setForm({ ...form, platform: v as 'manual' | PlatformKey }) }}>
                      <SelectTrigger><SelectValue>{PLATFORM_LABEL[form.platform]}</SelectValue></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">手入力</SelectItem>
                        {enabledPlatforms.includes('stripchat') && <SelectItem value="stripchat">STRIPCHAT</SelectItem>}
                        {enabledPlatforms.includes('fc2') && <SelectItem value="fc2">FC2</SelectItem>}
                        {enabledPlatforms.includes('dxlive') && <SelectItem value="dxlive">DXライブ</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {form.platform === 'manual' ? (
                  <div className="space-y-1.5">
                    <Label required>売上金額（円）</Label>
                    <Input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label required>{form.platform === 'stripchat' ? 'TK数' : 'ポイント数'}</Label>
                    <Input type="number" min="0" value={form.raw_units} onChange={e => setForm({ ...form, raw_units: e.target.value })} placeholder="0" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>稼働時間（時間）</Label>
                  <Input type="number" min="0" step="0.25" value={form.worked_hours} onChange={e => setForm({ ...form, worked_hours: e.target.value })} placeholder="0" />
                </div>
                {bonusFieldVisible && (
                  <div className="space-y-1.5">
                    <Label>{bonusFieldLabel}（円）</Label>
                    <Input type="number" min="0" value={form.bonus} onChange={e => setForm({ ...form, bonus: e.target.value })} placeholder="0" />
                  </div>
                )}
                {deductionFieldVisible && (
                  <div className="space-y-1.5">
                    <Label>{deductionFieldLabel}（円）</Label>
                    <Input type="number" min="0" value={form.deduction} onChange={e => setForm({ ...form, deduction: e.target.value })} placeholder="0" />
                  </div>
                )}
                <div className="space-y-1.5 col-span-2">
                  <Label>備考</Label>
                  <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-xs text-muted-foreground font-normal">追加項目（指名料など・マイナス値で控除も可）</Label>
                {form.custom_items.some(it => it.templateId) && (
                  <div className="grid grid-cols-2 gap-3">
                    {form.custom_items.map((item, i) => item.templateId && (
                      <div key={item.templateId} className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-normal">
                          {item.label}（{NOTICE_ITEM_UNIT_LABEL[item.unit] ?? item.unit}）
                        </Label>
                        {item.unit === 'jpy' ? (
                          <Input
                            type="number" placeholder="0" value={item.amount}
                            onChange={e => setForm({ ...form, custom_items: form.custom_items.map((it, idx) => idx === i ? { ...it, amount: e.target.value } : it) })}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" placeholder={`数量（${NOTICE_ITEM_UNIT_LABEL[item.unit] ?? item.unit}）`}
                              value={item.rawUnits}
                              onChange={e => setForm({ ...form, custom_items: form.custom_items.map((it, idx) => idx === i ? { ...it, rawUnits: e.target.value } : it) })}
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              → ¥{calcItemAmount(item.unit, item.rawUnits).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {form.custom_items.some(it => !it.templateId) && (
                  <div className="space-y-2">
                    {form.custom_items.map((item, i) => !item.templateId && (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder="項目名（例: 指名料）" value={item.label}
                          onChange={e => setForm({ ...form, custom_items: form.custom_items.map((it, idx) => idx === i ? { ...it, label: e.target.value } : it) })}
                        />
                        <Input
                          type="number" className="w-28" placeholder="金額" value={item.amount}
                          onChange={e => setForm({ ...form, custom_items: form.custom_items.map((it, idx) => idx === i ? { ...it, amount: e.target.value } : it) })}
                        />
                        <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, custom_items: form.custom_items.filter((_, idx) => idx !== i) })}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={() => setForm({ ...form, custom_items: [...form.custom_items, { templateId: '', label: '', unit: 'jpy', rawUnits: '', amount: '' }] })}>
                  <Plus className="h-3.5 w-3.5 mr-1" />その他の項目を追加
                </Button>
              </div>

              {form.platform !== 'manual' && preview && (
                <p className="text-sm text-muted-foreground">
                  売上: <span className="font-medium text-foreground">¥{(preview.jpy + formIncludedSalesTotal).toLocaleString()}</span>
                  {preview.usd != null && ` （$${preview.usd.toFixed(2)}）`}
                  {preview.usd != null && usdJpyRate != null && ` ・ 為替レート: ¥${usdJpyRate.toFixed(2)}/$`}
                </p>
              )}

              <div className="pt-3 border-t space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.is_daily_payment}
                    onCheckedChange={c => setForm({
                      ...form,
                      is_daily_payment: !!c,
                      daily_payment_at: c ? (form.daily_payment_at || toDatetimeLocal(new Date().toISOString())) : '',
                    })}
                  />
                  日払い済み（この回だけ単価・報酬率を上書きする）
                </label>
                {form.is_daily_payment && (
                  <div className="grid grid-cols-2 gap-3 pl-1">
                    {form.platform !== 'manual' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-normal">単価上書き（1{form.platform === 'stripchat' ? 'TK' : 'pt'}＝◯円）</Label>
                        <Input type="number" min="0" step="0.01" value={form.rate_override} onChange={e => setForm({ ...form, rate_override: e.target.value })} placeholder="通常の計算式/固定単価を使う場合は空欄" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">報酬率上書き（%）</Label>
                      <div className="relative">
                        <Input type="number" min="0" max="100" step="1" className="pr-8" value={form.reward_rate_override} onChange={e => setForm({ ...form, reward_rate_override: e.target.value })} placeholder="通常の報酬率を使う場合は空欄" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                      </div>
                      {rateTemplates.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {rateTemplates.map(v => (
                            <button
                              key={v} type="button" onClick={() => applyRateTemplate(v, 'form')}
                              className="px-2 py-0.5 rounded-full border text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              {v}%
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs text-muted-foreground font-normal">日払い済み日時</Label>
                      <Input type="datetime-local" value={form.daily_payment_at} onChange={e => setForm({ ...form, daily_payment_at: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
                <Button onClick={handleSave}><Plus className="h-4 w-4 mr-1" />{editing ? '更新' : '登録'}</Button>
              </div>
            </div>
          )}

          {mode === 'bulk' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                外部サイトの表をコピーして、セルをクリックしてから貼り付けられます（複数行・複数列まとめてOK）。日付はその月の全日を用意しています。
                {enabledPlatforms.length > 0 && 'プラットフォームは行ごとに設定できます。'}
              </p>
              <p className="text-xs text-muted-foreground">
                現在の為替レート: {usdJpyRate != null ? `¥${usdJpyRate.toFixed(2)}/$` : '未設定'}
              </p>

              <div className="flex items-end gap-2 flex-wrap p-2.5 rounded-lg border bg-muted/30">
                <div className="space-y-1.5 w-44">
                  <Label className="text-xs">キャストを一括設定</Label>
                  <Select value={bulkCastFill} onValueChange={v => { if (v) setBulkCastFill(v) }}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="選択">
                        {bulkCastFill ? (casts.find(c => c.id === bulkCastFill)?.display_name ?? bulkCastFill) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={applyCastToAllRows} disabled={!bulkCastFill}>全行に適用</Button>

                {enabledPlatforms.length > 0 && (
                  <>
                    <div className="space-y-1.5 w-44">
                      <Label className="text-xs">プラットフォームを一括設定</Label>
                      <Select value={bulkPlatformFill} onValueChange={v => { if (v) setBulkPlatformFill(v as 'manual' | PlatformKey) }}>
                        <SelectTrigger className="h-8"><SelectValue>{PLATFORM_LABEL[bulkPlatformFill]}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">手入力</SelectItem>
                          {enabledPlatforms.includes('stripchat') && <SelectItem value="stripchat">STRIPCHAT</SelectItem>}
                          {enabledPlatforms.includes('fc2') && <SelectItem value="fc2">FC2</SelectItem>}
                          {enabledPlatforms.includes('dxlive') && <SelectItem value="dxlive">DXライブ</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button size="sm" variant="outline" onClick={applyPlatformToAllRows}>全行に適用</Button>
                  </>
                )}
              </div>

              <datalist id="cast-name-options">
                {castOptions.map(o => <option key={o.key} value={o.label} />)}
              </datalist>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left font-medium px-2 py-1.5 border-b w-32">日付</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-32">キャスト</th>
                      {enabledPlatforms.length > 0 && <th className="text-left font-medium px-2 py-1.5 border-b w-28">プラットフォーム</th>}
                      <th className="text-left font-medium px-2 py-1.5 border-b w-24">金額/数量</th>
                      {itemTemplates.map(t => (
                        <th key={t.id} className="text-left font-medium px-2 py-1.5 border-b w-24">
                          {t.label}（{NOTICE_ITEM_UNIT_LABEL[t.unit] ?? t.unit}）
                        </th>
                      ))}
                      <th className="text-left font-medium px-2 py-1.5 border-b w-24">売上</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-20">時間</th>
                      {bonusFieldVisible && <th className="text-left font-medium px-2 py-1.5 border-b w-20">{bonusFieldLabel}</th>}
                      {deductionFieldVisible && <th className="text-left font-medium px-2 py-1.5 border-b w-20">{deductionFieldLabel}</th>}
                      <th className="text-left font-medium px-2 py-1.5 border-b min-w-[12rem]">備考</th>
                      <th className="w-8 border-b" />
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((row, rowIndex) => {
                      const rowIncludedSalesTotal = itemTemplates.reduce((sum, t) => {
                        if (!includedInSalesLabels.has(t.label)) return sum
                        const rawUnits = row.customItems[t.id] ?? ''
                        if (!rawUnits.trim()) return sum
                        return sum + calcSalesAmount(t.unit, rawUnits)
                      }, 0)
                      const baseSalesAmount = row.platform !== 'manual' && row.amount.trim() && !Number.isNaN(parseFloat(row.amount))
                        ? calcPlatformAmount(row.platform, parseFloat(row.amount), platformSettings[row.platform], usdJpyRate, null).jpy
                        : (row.platform === 'manual' && row.amount.trim() && !Number.isNaN(parseFloat(row.amount)) ? parseFloat(row.amount) : null)
                      return (
                      <tr key={row.id}>
                        <td className="p-0.5 border-b">
                          <input
                            type="date" value={row.date}
                            onChange={e => updateBulkCell(row.id, 'date', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('date'))}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            list="cast-name-options" value={row.castName} placeholder="キャスト名"
                            onChange={e => updateBulkCell(row.id, 'castName', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('castName'))}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        {enabledPlatforms.length > 0 && (
                          <td className="p-0.5 border-b">
                            <select
                              value={row.platform}
                              onChange={e => updateBulkCell(row.id, 'platform', e.target.value)}
                              className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              <option value="manual">手入力</option>
                              {enabledPlatforms.includes('stripchat') && <option value="stripchat">STRIPCHAT</option>}
                              {enabledPlatforms.includes('fc2') && <option value="fc2">FC2</option>}
                              {enabledPlatforms.includes('dxlive') && <option value="dxlive">DXライブ</option>}
                            </select>
                          </td>
                        )}
                        <td className="p-0.5 border-b">
                          <input
                            type="number" value={row.amount}
                            placeholder={row.platform === 'manual' ? '円' : row.platform === 'stripchat' ? 'TK数' : 'pt数'}
                            onChange={e => updateBulkCell(row.id, 'amount', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('amount'))}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        {itemTemplates.map(t => (
                          <td key={t.id} className="p-0.5 border-b">
                            <input
                              type="number" value={row.customItems[t.id] ?? ''}
                              placeholder={t.unit === 'jpy' ? '円' : `数量(${NOTICE_ITEM_UNIT_LABEL[t.unit] ?? t.unit})`}
                              onChange={e => updateBulkCell(row.id, `item:${t.id}`, e.target.value)}
                              onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex(`item:${t.id}`))}
                              className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </td>
                        ))}
                        <td className="p-0.5 border-b">
                          <div className="w-full h-8 px-1.5 flex items-center text-xs text-muted-foreground whitespace-nowrap">
                            {baseSalesAmount != null ? `¥${(baseSalesAmount + rowIncludedSalesTotal).toLocaleString()}` : '—'}
                          </div>
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            type="number" step="0.25" value={row.worked_hours} placeholder="0"
                            onChange={e => updateBulkCell(row.id, 'worked_hours', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('worked_hours'))}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        {bonusFieldVisible && (
                          <td className="p-0.5 border-b">
                            <input
                              type="number" value={row.bonus} placeholder="0"
                              onChange={e => updateBulkCell(row.id, 'bonus', e.target.value)}
                              onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('bonus'))}
                              className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </td>
                        )}
                        {deductionFieldVisible && (
                          <td className="p-0.5 border-b">
                            <input
                              type="number" value={row.deduction} placeholder="0"
                              onChange={e => updateBulkCell(row.id, 'deduction', e.target.value)}
                              onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('deduction'))}
                              className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </td>
                        )}
                        <td className="p-0.5 border-b">
                          <input
                            value={row.notes} placeholder="備考"
                            onChange={e => updateBulkCell(row.id, 'notes', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, pasteColIndex('notes'))}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b text-center">
                          <button type="button" onClick={() => removeBulkRow(row.id)} className="text-muted-foreground hover:text-destructive" aria-label="この行を削除">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <Button size="sm" variant="outline" onClick={addBulkRow}><Plus className="h-3.5 w-3.5 mr-1" />行を追加</Button>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>キャンセル</Button>
                <Button onClick={handleBulkSubmit} disabled={bulkSaving}>
                  <Plus className="h-4 w-4 mr-1" />{bulkSaving ? '登録中...' : 'まとめて登録'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={fxDialogOpen} onOpenChange={o => { setFxDialogOpen(o); if (!o) setFxNewRate('') }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>為替レートを一括変更</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              選択した{selected.size}件のうち、為替レートを使用しているプラットフォーム売上の金額を、新しいレートで再計算します。
            </p>
            <div className="rounded-md border px-3 py-2 text-sm">
              対象件数: <span className="font-medium">{fxTargets.length}件</span>
              {fxTargets.length === 0 && <span className="text-muted-foreground">（対象となる売上を選択してください）</span>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">新しい為替レート（USD/JPY）</Label>
              <Input
                type="number" min="0" step="0.01" value={fxNewRate}
                onChange={e => setFxNewRate(e.target.value)}
                placeholder={usdJpyRate != null ? `現在の設定値: ${usdJpyRate}` : '例: 150.5'}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFxDialogOpen(false)}>キャンセル</Button>
              <Button onClick={handleFxBulkChange} disabled={fxSaving || fxTargets.length === 0}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />{fxSaving ? '更新中...' : `${fxTargets.length}件を更新`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dailyDialogOpen} onOpenChange={o => { setDailyDialogOpen(o); if (!o) { setBulkDailyRate(''); setBulkDailyAt('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>選択した売上を日払いに変更</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border px-3 py-2 text-sm">
              対象件数: <span className="font-medium">{selected.size}件</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-normal">報酬率上書き（%・空欄でキャストごとの日払い時の報酬率、未設定なら通常の報酬率）</Label>
              <div className="relative">
                <Input
                  type="number" min="0" max="100" step="1" className="pr-8" value={bulkDailyRate}
                  onChange={e => setBulkDailyRate(e.target.value)}
                  placeholder="個別に指定しない場合は空欄"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
              {rateTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {rateTemplates.map(v => (
                    <button
                      key={v} type="button" onClick={() => applyRateTemplate(v, 'bulkDaily')}
                      className="px-2 py-0.5 rounded-full border text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-normal">日払い済み日時（空欄で現在時刻）</Label>
              <Input type="datetime-local" value={bulkDailyAt} onChange={e => setBulkDailyAt(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDailyDialogOpen(false)}>キャンセル</Button>
              <Button onClick={handleBulkDailyChange} disabled={bulkDailySaving || selected.size === 0}>
                {bulkDailySaving ? '更新中...' : `${selected.size}件を日払いに変更`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
