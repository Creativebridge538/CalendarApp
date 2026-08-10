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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { calcPlatformAmount, parsePlatformSettings, type PlatformKey } from '@/lib/platform-earnings'

interface Sale {
  id: string; cast_id: string; date: string; amount: number | string; notes: string | null
  platform: string; raw_units: number | string | null
  is_daily_payment: boolean; rate_override: number | string | null; reward_rate_override: number | string | null
  shift_id: string | null
  cast: { display_name: string | null } | null
}

interface ShiftOption {
  id: string; cast_id: string; date: string; start_time: string; end_time: string
  rooms: { name: string } | null
}

interface Props {
  casts: { id: string; display_name: string | null; reward_rate: number | string }[]
  sales: Sale[]
  storeId: string
  userId: string
  storeSettings: { usd_jpy_rate: number | null; platform_settings: unknown } | null
  shifts: ShiftOption[]
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

export function SalesInput({ casts, sales: initialSales, storeId, userId, storeSettings, shifts, year, month }: Props) {
  const emptyForm = useMemo(() => ({
    cast_id: '', date: defaultDateFor(year, month),
    platform: 'manual' as 'manual' | PlatformKey,
    amount: '', raw_units: '',
    is_daily_payment: false, rate_override: '', reward_rate_override: '',
    notes: '', shift_id: '',
  }), [year, month])
  const [sales, setSales] = useState(initialSales)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Sale | null>(null)
  const supabase = createClient()

  const platformSettings = useMemo(() => parsePlatformSettings(storeSettings?.platform_settings), [storeSettings])
  const usdJpyRate = storeSettings?.usd_jpy_rate ?? null

  const castRewardRateById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of casts) map[c.id] = Number(c.reward_rate)
    return map
  }, [casts])

  const shiftById = useMemo(() => {
    const map: Record<string, ShiftOption> = {}
    for (const s of shifts) map[s.id] = s
    return map
  }, [shifts])

  const candidateShifts = useMemo(() => {
    if (!form.cast_id || !form.date) return []
    return shifts.filter(s => s.cast_id === form.cast_id && s.date === form.date)
  }, [shifts, form.cast_id, form.date])

  const monthlyTotal = useMemo(() => sales.reduce((sum, s) => sum + Number(s.amount), 0), [sales])
  const monthlyRewardTotal = useMemo(() => sales.reduce((sum, s) => {
    const rate = effectiveRewardRate(s, castRewardRateById[s.cast_id] ?? 0)
    return sum + Math.floor(Number(s.amount) * rate)
  }, 0), [sales, castRewardRateById])

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }

  const preview = useMemo(() => {
    if (form.platform === 'manual') return null
    const rawUnits = parseFloat(form.raw_units) || 0
    const override = form.is_daily_payment && form.rate_override ? parseFloat(form.rate_override) : null
    return calcPlatformAmount(form.platform, rawUnits, platformSettings[form.platform], usdJpyRate, override)
  }, [form.platform, form.raw_units, form.is_daily_payment, form.rate_override, platformSettings, usdJpyRate])

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
      reward_rate_override: form.is_daily_payment && form.reward_rate_override ? parseFloat(form.reward_rate_override) : null,
      notes: form.notes || null,
      shift_id: form.shift_id || null,
      store_id: storeId,
      created_by: userId,
    }

    if (editing) {
      const { error } = await supabase.from('sales').update(payload).eq('id', editing.id)
      if (error) { toast.error('更新に失敗しました'); return }
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
  }

  async function handleDelete(id: string) {
    if (!confirm('削除しますか？')) return
    const { error } = await supabase.from('sales').delete().eq('id', id)
    if (error) { toast.error('削除に失敗しました'); return }
    setSales(sales.filter(s => s.id !== id))
    toast.success('削除しました')
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
      reward_rate_override: sale.reward_rate_override != null ? String(sale.reward_rate_override) : '',
      notes: sale.notes ?? '',
      shift_id: sale.shift_id ?? '',
    })
  }

  function shiftLabel(s: ShiftOption): string {
    return `${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)}${s.rooms?.name ? ` ・ ${s.rooms.name}` : ''}`
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>売上入力 — {year}年{month}月</CardTitle>
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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>キャスト *</Label>
              <Select value={form.cast_id} onValueChange={v => { if (v) setForm({ ...form, cast_id: v, shift_id: '' }) }}>
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
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value, shift_id: '' })} />
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
            {candidateShifts.length > 0 && (
              <div className="space-y-1.5 col-span-2 md:col-span-4">
                <Label>紐づくシフト</Label>
                <Select value={form.shift_id || 'none'} onValueChange={v => { if (v) setForm({ ...form, shift_id: v === 'none' ? '' : v }) }}>
                  <SelectTrigger>
                    <SelectValue placeholder="紐付けなし">
                      {form.shift_id ? shiftLabel(shiftById[form.shift_id]) : '紐付けなし'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectItem value="none">紐付けなし</SelectItem>
                    {candidateShifts.map(s => <SelectItem key={s.id} value={s.id}>{shiftLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 col-span-2 md:col-span-4">
              <Label>備考</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          {form.platform !== 'manual' && preview && (
            <p className="text-sm text-muted-foreground mt-2">
              換算金額: <span className="font-medium text-foreground">¥{preview.jpy.toLocaleString()}</span>
              {preview.usd != null && ` （$${preview.usd.toFixed(2)}）`}
            </p>
          )}

          <div className="mt-4 pt-3 border-t space-y-3">
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
                  <Label className="text-xs text-muted-foreground font-normal">報酬率上書き（0〜1）</Label>
                  <Input type="number" min="0" max="1" step="0.01" value={form.reward_rate_override} onChange={e => setForm({ ...form, reward_rate_override: e.target.value })} placeholder="通常の報酬率を使う場合は空欄" />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-3">
            <Button onClick={handleSave}><Plus className="h-4 w-4 mr-1" />{editing ? '更新' : '登録'}</Button>
            {editing && <Button variant="outline" onClick={() => { setEditing(null); setForm(emptyForm) }}>キャンセル</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>売上一覧</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>キャスト</TableHead>
                <TableHead>シフト</TableHead>
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
                const linkedShift = sale.shift_id ? shiftById[sale.shift_id] : undefined
                const reward = Math.floor(Number(sale.amount) * effectiveRewardRate(sale, castRewardRateById[sale.cast_id] ?? 0))
                return (
                  <TableRow key={sale.id}>
                    <TableCell>{format(new Date(sale.date), 'M/d(E)', { locale: ja })}</TableCell>
                    <TableCell>{sale.cast?.display_name ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {linkedShift ? shiftLabel(linkedShift) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge variant="outline">{PLATFORM_LABEL[sale.platform] ?? sale.platform}</Badge>
                        {sale.is_daily_payment && <Badge variant="secondary">日払い</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">¥{Number(sale.amount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">¥{reward.toLocaleString()}</TableCell>
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
    </div>
  )
}
