'use client'

import { useState, useMemo } from 'react'
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
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, X, Table2, FileEdit } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { calcPlatformAmount, parsePlatformSettings, type PlatformKey } from '@/lib/platform-earnings'
import type { Database } from '@/lib/supabase/database.types'

type SaleInsert = Database['public']['Tables']['sales']['Insert']

interface Sale {
  id: string; cast_id: string; date: string; amount: number | string; notes: string | null
  platform: string; raw_units: number | string | null
  is_daily_payment: boolean; rate_override: number | string | null; reward_rate_override: number | string | null
  worked_hours: number | string | null
  bonus: number | string; deduction: number | string
  cast: { display_name: string | null } | null
}

interface Props {
  casts: { id: string; display_name: string | null; reward_rate: number | string }[]
  sales: Sale[]
  storeId: string
  userId: string
  storeSettings: { usd_jpy_rate: number | null; platform_settings: unknown } | null
  year: number
  month: number
}

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

function defaultDateFor(year: number, month: number): string {
  const now = new Date()
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month
  return isCurrentMonth ? format(now, 'yyyy-MM-dd') : `${year}-${String(month).padStart(2, '0')}-01`
}

function effectiveRewardRate(sale: Pick<Sale, 'is_daily_payment' | 'reward_rate_override'>, castRewardRate: number): number {
  return sale.is_daily_payment && sale.reward_rate_override != null ? Number(sale.reward_rate_override) : castRewardRate
}

// スプレッドシートからのコピペを想定した一括登録行。列の並びはBULK_COLUMNSと対応させる
// （プラットフォームは行ごとに個別設定するため、貼り付け列の対応には含めない）
interface BulkRow {
  id: string
  date: string
  castName: string
  platform: 'manual' | PlatformKey
  amount: string
  worked_hours: string
  bonus: string
  deduction: string
  notes: string
}
const BULK_COLUMNS = ['date', 'castName', 'amount', 'worked_hours', 'bonus', 'deduction', 'notes'] as const
type BulkColumn = typeof BULK_COLUMNS[number]

export function SalesInput({ casts, sales: initialSales, storeId, userId, storeSettings, year, month }: Props) {
  const emptyForm = useMemo(() => ({
    cast_id: '', date: defaultDateFor(year, month),
    platform: 'manual' as 'manual' | PlatformKey,
    amount: '', raw_units: '',
    is_daily_payment: false, rate_override: '', reward_rate_override: '',
    notes: '', worked_hours: '', bonus: '', deduction: '',
  }), [year, month])
  const emptyBulkRow = (date?: string): BulkRow => ({
    id: crypto.randomUUID(), date: date ?? defaultDateFor(year, month),
    castName: '', platform: 'manual', amount: '', worked_hours: '', bonus: '', deduction: '', notes: '',
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
  const [editing, setEditing] = useState<Sale | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [bulkRows, setBulkRows] = useState<BulkRow[]>(() => daysInMonthRows())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkCastFill, setBulkCastFill] = useState('')
  const [bulkPlatformFill, setBulkPlatformFill] = useState<'manual' | PlatformKey>('manual')
  const supabase = createClient()

  const platformSettings = useMemo(() => parsePlatformSettings(storeSettings?.platform_settings), [storeSettings])
  const usdJpyRate = storeSettings?.usd_jpy_rate ?? null

  const castRewardRateById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of casts) map[c.id] = Number(c.reward_rate)
    return map
  }, [casts])

  const monthlyTotal = useMemo(() => sales.reduce((sum, s) => sum + Number(s.amount), 0), [sales])
  const monthlyRewardTotal = useMemo(() => sales.reduce((sum, s) => {
    const rate = effectiveRewardRate(s, castRewardRateById[s.cast_id] ?? 0)
    return sum + Math.floor(Number(s.amount) * rate) + Number(s.bonus) - Number(s.deduction)
  }, 0), [sales, castRewardRateById])

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }

  const preview = useMemo(() => {
    if (form.platform === 'manual') return null
    const rawUnits = parseFloat(form.raw_units) || 0
    const override = form.is_daily_payment && form.rate_override ? parseFloat(form.rate_override) : null
    return calcPlatformAmount(form.platform, rawUnits, platformSettings[form.platform], usdJpyRate, override)
  }, [form.platform, form.raw_units, form.is_daily_payment, form.rate_override, platformSettings, usdJpyRate])

  function openCreate() {
    setForm(emptyForm)
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
    setForm({
      cast_id: sale.cast_id,
      date: sale.date,
      platform: (sale.platform as 'manual' | PlatformKey) ?? 'manual',
      amount: String(sale.amount),
      raw_units: sale.raw_units != null ? String(sale.raw_units) : '',
      is_daily_payment: sale.is_daily_payment,
      rate_override: sale.rate_override != null ? String(sale.rate_override) : '',
      reward_rate_override: sale.reward_rate_override != null ? String(Number(sale.reward_rate_override) * 100) : '',
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
      notes: form.notes || null,
      worked_hours: form.worked_hours ? parseFloat(form.worked_hours) : null,
      bonus: form.bonus ? parseInt(form.bonus) : 0,
      deduction: form.deduction ? parseInt(form.deduction) : 0,
      store_id: storeId,
      created_by: userId,
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

  function updateBulkCell(rowId: string, col: BulkColumn | 'platform', value: string) {
    setBulkRows(rows => rows.map(r => r.id === rowId ? { ...r, [col]: value } : r))
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
        const row = { ...next[targetIndex] }
        cols.forEach((val, j) => {
          const col = BULK_COLUMNS[colIndex + j]
          if (col) row[col] = val.trim()
        })
        next[targetIndex] = row
      })
      return next
    })
  }

  async function handleBulkSubmit() {
    // dateは常にデフォルト値が入っているため空判定には使わない。キャスト名か金額のどちらかが入っている行だけを対象にする
    const nonEmptyRows = bulkRows.filter(r => r.castName.trim() || r.amount.trim())
    if (nonEmptyRows.length === 0) { toast.error('入力された行がありません'); return }

    const payloads: SaleInsert[] = []
    const errorRows: number[] = []

    nonEmptyRows.forEach((row, idx) => {
      const cast = casts.find(c => c.display_name?.trim() === row.castName.trim())
      const amountVal = parseFloat(row.amount)
      if (!cast || !row.date || row.amount === '' || Number.isNaN(amountVal)) { errorRows.push(idx + 1); return }
      const rowPlatform = row.platform
      const isPlatform = rowPlatform !== 'manual'
      const converted = rowPlatform !== 'manual' ? calcPlatformAmount(rowPlatform, amountVal, platformSettings[rowPlatform], usdJpyRate, null) : null
      payloads.push({
        cast_id: cast.id, date: row.date, platform: row.platform,
        amount: isPlatform ? (converted?.jpy ?? 0) : Math.round(amountVal),
        raw_units: isPlatform ? amountVal : null,
        usd_amount: isPlatform ? converted?.usd ?? null : null,
        fx_rate_snapshot: isPlatform ? usdJpyRate : null,
        is_daily_payment: false, rate_override: null, reward_rate_override: null,
        notes: row.notes || null,
        worked_hours: row.worked_hours ? parseFloat(row.worked_hours) : null,
        bonus: row.bonus ? parseInt(row.bonus) : 0,
        deduction: row.deduction ? parseInt(row.deduction) : 0,
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
                月合計: ¥{monthlyTotal.toLocaleString()}
                <span className="mx-1.5 text-border">・</span>
                女子給合計: ¥{monthlyRewardTotal.toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Link href={`/admin/sales?year=${prev.year}&month=${prev.month}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />前月
              </Link>
              <Link href={`/admin/sales?year=${next.year}&month=${next.month}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                翌月<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Link>
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />追加</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>キャスト</TableHead>
                <TableHead>稼働時間</TableHead>
                <TableHead>プラットフォーム</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">女子給</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">売上データがありません</TableCell></TableRow>
              )}
              {sales.map(sale => {
                const baseReward = Math.floor(Number(sale.amount) * effectiveRewardRate(sale, castRewardRateById[sale.cast_id] ?? 0))
                const reward = baseReward + Number(sale.bonus) - Number(sale.deduction)
                return (
                  <TableRow key={sale.id}>
                    <TableCell>{format(new Date(sale.date), 'M/d(E)', { locale: ja })}</TableCell>
                    <TableCell>{sale.cast?.display_name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {sale.worked_hours != null ? `${Number(sale.worked_hours)}h` : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge variant="outline">{PLATFORM_LABEL[sale.platform] ?? sale.platform}</Badge>
                        {sale.is_daily_payment && <Badge variant="secondary">日払い</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">¥{Number(sale.amount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      ¥{reward.toLocaleString()}
                      {(Number(sale.bonus) > 0 || Number(sale.deduction) > 0) && (
                        <span className="block text-[10px] text-muted-foreground">
                          {Number(sale.bonus) > 0 && `+¥${Number(sale.bonus).toLocaleString()}`}
                          {Number(sale.bonus) > 0 && Number(sale.deduction) > 0 && ' '}
                          {Number(sale.deduction) > 0 && `-¥${Number(sale.deduction).toLocaleString()}`}
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
                  <Label>キャスト *</Label>
                  <Select value={form.cast_id} onValueChange={v => { if (v) setForm({ ...form, cast_id: v }) }}>
                    <SelectTrigger>
                      <SelectValue placeholder="選択">
                        {form.cast_id ? (casts.find(c => c.id === form.cast_id)?.display_name ?? form.cast_id) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>日付 *</Label>
                  <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>プラットフォーム</Label>
                  <Select value={form.platform} onValueChange={v => { if (v) setForm({ ...form, platform: v as 'manual' | PlatformKey }) }}>
                    <SelectTrigger><SelectValue>{PLATFORM_LABEL[form.platform]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手入力</SelectItem>
                      <SelectItem value="stripchat">STRIPCHAT</SelectItem>
                      <SelectItem value="fc2">FC2</SelectItem>
                      <SelectItem value="dxlive">DXライブ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.platform === 'manual' ? (
                  <div className="space-y-1.5">
                    <Label>売上金額（円）*</Label>
                    <Input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>{form.platform === 'stripchat' ? 'TK数' : 'ポイント数'} *</Label>
                    <Input type="number" min="0" value={form.raw_units} onChange={e => setForm({ ...form, raw_units: e.target.value })} placeholder="0" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>稼働時間（時間）</Label>
                  <Input type="number" min="0" step="0.25" value={form.worked_hours} onChange={e => setForm({ ...form, worked_hours: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>ボーナス（円）</Label>
                  <Input type="number" min="0" value={form.bonus} onChange={e => setForm({ ...form, bonus: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>控除（円）</Label>
                  <Input type="number" min="0" value={form.deduction} onChange={e => setForm({ ...form, deduction: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>備考</Label>
                  <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              {form.platform !== 'manual' && preview && (
                <p className="text-sm text-muted-foreground">
                  換算金額: <span className="font-medium text-foreground">¥{preview.jpy.toLocaleString()}</span>
                  {preview.usd != null && ` （$${preview.usd.toFixed(2)}）`}
                </p>
              )}

              <div className="pt-3 border-t space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.is_daily_payment} onCheckedChange={c => setForm({ ...form, is_daily_payment: !!c })} />
                  日払い（この回だけ単価・報酬率を上書きする）
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
                外部サイトの表をコピーして、セルをクリックしてから貼り付けられます（複数行・複数列まとめてOK）。日付はその月の全日を用意しています。プラットフォームは行ごとに設定できます。
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

                <div className="space-y-1.5 w-44">
                  <Label className="text-xs">プラットフォームを一括設定</Label>
                  <Select value={bulkPlatformFill} onValueChange={v => { if (v) setBulkPlatformFill(v as 'manual' | PlatformKey) }}>
                    <SelectTrigger className="h-8"><SelectValue>{PLATFORM_LABEL[bulkPlatformFill]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">手入力</SelectItem>
                      <SelectItem value="stripchat">STRIPCHAT</SelectItem>
                      <SelectItem value="fc2">FC2</SelectItem>
                      <SelectItem value="dxlive">DXライブ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={applyPlatformToAllRows}>全行に適用</Button>
              </div>

              <datalist id="cast-name-options">
                {casts.map(c => <option key={c.id} value={c.display_name ?? ''} />)}
              </datalist>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left font-medium px-2 py-1.5 border-b w-32">日付</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-32">キャスト</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-28">プラットフォーム</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-24">金額/数量</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-20">時間</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-20">ボーナス</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b w-20">控除</th>
                      <th className="text-left font-medium px-2 py-1.5 border-b">備考</th>
                      <th className="w-8 border-b" />
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((row, rowIndex) => (
                      <tr key={row.id}>
                        <td className="p-0.5 border-b">
                          <input
                            type="date" value={row.date}
                            onChange={e => updateBulkCell(row.id, 'date', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 0)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            list="cast-name-options" value={row.castName} placeholder="キャスト名"
                            onChange={e => updateBulkCell(row.id, 'castName', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 1)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <select
                            value={row.platform}
                            onChange={e => updateBulkCell(row.id, 'platform', e.target.value)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="manual">手入力</option>
                            <option value="stripchat">STRIPCHAT</option>
                            <option value="fc2">FC2</option>
                            <option value="dxlive">DXライブ</option>
                          </select>
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            type="number" value={row.amount}
                            placeholder={row.platform === 'manual' ? '円' : row.platform === 'stripchat' ? 'TK数' : 'pt数'}
                            onChange={e => updateBulkCell(row.id, 'amount', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 2)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            type="number" step="0.25" value={row.worked_hours} placeholder="0"
                            onChange={e => updateBulkCell(row.id, 'worked_hours', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 3)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            type="number" value={row.bonus} placeholder="0"
                            onChange={e => updateBulkCell(row.id, 'bonus', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 4)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            type="number" value={row.deduction} placeholder="0"
                            onChange={e => updateBulkCell(row.id, 'deduction', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 5)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b">
                          <input
                            value={row.notes} placeholder="備考"
                            onChange={e => updateBulkCell(row.id, 'notes', e.target.value)}
                            onPaste={e => handleBulkPaste(e, rowIndex, 6)}
                            className="w-full h-8 px-1.5 rounded border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="p-0.5 border-b text-center">
                          <button type="button" onClick={() => removeBulkRow(row.id)} className="text-muted-foreground hover:text-destructive" aria-label="この行を削除">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
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
    </div>
  )
}
