'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Send, ChevronLeft, ChevronRight } from 'lucide-react'
import { sendPushNotification } from '@/lib/push'
import { PaymentNoticeButton } from '@/components/rewards/payment-notice-modal'

interface CastUser { id: string; display_name: string | null; reward_rate: number | string; is_active: boolean }
interface SaleRow {
  cast_id: string; amount: number | string
  is_daily_payment: boolean; reward_rate_override: number | string | null
  bonus: number | string; deduction: number | string
}

interface Props {
  casts: CastUser[]
  sales: SaleRow[]
  storeId: string
  from: string
  to: string
  /** cast_id -> この期間ですでに発行済みの通知の作成日時（ISO文字列） */
  issuedAt: Record<string, string>
}

export function RewardCalculator({ casts, sales, from, to, issuedAt: initialIssuedAt }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)
  const [issuedAt, setIssuedAt] = useState(initialIssuedAt)
  const supabase = createClient()
  const router = useRouter()

  const salesByCast = useMemo(() => {
    const map = new Map<string, SaleRow[]>()
    for (const s of sales) {
      const arr = map.get(s.cast_id) ?? []
      arr.push(s)
      map.set(s.cast_id, arr)
    }
    return map
  }, [sales])

  const rows = useMemo(() => casts.map(cast => {
    const rewardRate = Number(cast.reward_rate)
    const castSales = salesByCast.get(cast.id) ?? []
    const salesTotal = castSales.reduce((sum, s) => sum + Number(s.amount), 0)
    // 日払いで報酬率が上書きされている行はその行だけ別の率で計算する（それ以外は通常の報酬率）
    const baseReward = Math.floor(castSales.reduce((sum, s) => {
      const rate = s.is_daily_payment && s.reward_rate_override != null ? Number(s.reward_rate_override) : rewardRate
      return sum + Number(s.amount) * rate
    }, 0))
    const bonus = castSales.reduce((sum, s) => sum + Number(s.bonus), 0)
    const deduction = castSales.reduce((sum, s) => sum + Number(s.deduction), 0)
    const totalReward = baseReward + bonus - deduction
    return { cast, rewardRate, salesTotal, baseReward, bonus, deduction, totalReward }
  }), [casts, salesByCast])

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.cast.id))
  const unissuedRows = useMemo(() => rows.filter(r => !issuedAt[r.cast.id]), [rows, issuedAt])
  const unissuedAllSelected = unissuedRows.length > 0 && unissuedRows.every(r => selected.has(r.cast.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.cast.id)))
  }
  function toggleUnissuedAll() {
    setSelected(unissuedAllSelected ? new Set() : new Set(unissuedRows.map(r => r.cast.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function applyRange(nextFrom: string, nextTo: string) {
    if (nextFrom > nextTo) { toast.error('開始日は終了日より前にしてください'); return }
    router.push(`/admin/rewards?from=${nextFrom}&to=${nextTo}`)
  }

  function shiftMonth(dir: 'prev' | 'next') {
    const anchor = new Date(`${from}T00:00:00`)
    const shifted = dir === 'next' ? addMonths(anchor, 1) : subMonths(anchor, 1)
    applyRange(format(startOfMonth(shifted), 'yyyy-MM-dd'), format(endOfMonth(shifted), 'yyyy-MM-dd'))
  }

  const targets = useMemo(() => rows.filter(r => selected.has(r.cast.id)), [rows, selected])
  const targetsTotal = useMemo(() => targets.reduce((sum, t) => sum + t.totalReward, 0), [targets])

  async function handleIssue() {
    if (targets.length === 0) { toast.error('キャストを選択してください'); return }
    setSending(true)

    const title = '支払通知書が届きました'
    const periodLabel = `${format(new Date(`${from}T00:00:00`), 'M/d', { locale: ja })}〜${format(new Date(`${to}T00:00:00`), 'M/d', { locale: ja })}`
    const notifications = targets.map(t => ({
      user_id: t.cast.id, title,
      body: `${periodLabel} の支払通知書: ¥${t.totalReward.toLocaleString()}`,
      link: `/admin/rewards/notice?cast_id=${t.cast.id}&from=${from}&to=${to}`,
    }))
    const { error } = await supabase.from('notifications').insert(notifications)
    setSending(false)
    if (error) { toast.error('通知の送信に失敗しました'); return }

    for (const t of targets) {
      sendPushNotification(t.cast.id, title, `${periodLabel} の支払通知書: ¥${t.totalReward.toLocaleString()}`, `/admin/rewards/notice?cast_id=${t.cast.id}&from=${from}&to=${to}`)
      // メール通知は任意送信。失敗しても発行処理自体はすでに成功しているので握りつぶす
      fetch('/api/rewards/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cast_id: t.cast.id, from, to, total_reward: t.totalReward }),
      }).catch(() => {})
    }

    toast.success(`${targets.length}人に支払通知書を発行しました`)
    const now = new Date().toISOString()
    setIssuedAt(prev => {
      const next = { ...prev }
      for (const t of targets) next[t.cast.id] = now
      return next
    })
    setSelected(new Set())
    setConfirmOpen(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>支払通知書の発行</CardTitle>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => shiftMonth('prev')}>
              <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />前月
            </Button>
            <Button size="sm" variant="outline" onClick={() => shiftMonth('next')}>
              翌月<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-end gap-2 flex-wrap mt-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">開始日</label>
            <Input type="date" className="w-40" value={fromInput} onChange={e => setFromInput(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">終了日</label>
            <Input type="date" className="w-40" value={toInput} onChange={e => setToInput(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" onClick={() => applyRange(fromInput, toInput)}>この期間で表示</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              全員選択
            </label>
            <label className={`flex items-center gap-2 text-sm ${unissuedRows.length === 0 ? 'text-muted-foreground' : 'cursor-pointer'}`}>
              <Checkbox checked={unissuedAllSelected} onCheckedChange={toggleUnissuedAll} disabled={unissuedRows.length === 0} />
              未発行のみ選択
            </label>
          </div>
          <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={sending || selected.size === 0}>
            <Send className="h-3.5 w-3.5 mr-1" />選択した{selected.size}人に発行
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>キャスト</TableHead>
              <TableHead className="text-right">売上合計</TableHead>
              <TableHead className="text-right">報酬率</TableHead>
              <TableHead className="text-right">基本報酬</TableHead>
              <TableHead className="text-right">ボーナス</TableHead>
              <TableHead className="text-right">控除</TableHead>
              <TableHead className="text-right">支払合計</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">プレビュー</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">対象のキャストがいません</TableCell></TableRow>
            )}
            {rows.map(r => (
              <TableRow key={r.cast.id}>
                <TableCell>
                  <Checkbox checked={selected.has(r.cast.id)} onCheckedChange={() => toggleOne(r.cast.id)} />
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    {r.cast.display_name ?? '—'}
                    {!r.cast.is_active && <Badge variant="outline" className="text-[10px] font-normal">退店済み</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">¥{r.salesTotal.toLocaleString()}</TableCell>
                <TableCell className="text-right">{(r.rewardRate * 100).toFixed(1)}%</TableCell>
                <TableCell className="text-right">¥{r.baseReward.toLocaleString()}</TableCell>
                <TableCell className="text-right">{r.bonus > 0 ? `+¥${r.bonus.toLocaleString()}` : '—'}</TableCell>
                <TableCell className="text-right">{r.deduction > 0 ? `-¥${r.deduction.toLocaleString()}` : '—'}</TableCell>
                <TableCell className="text-right font-bold">¥{r.totalReward.toLocaleString()}</TableCell>
                <TableCell>
                  {issuedAt[r.cast.id] ? (
                    <Badge className="whitespace-nowrap">
                      発行済み（{format(new Date(issuedAt[r.cast.id]), 'M/d', { locale: ja })}）
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground font-normal">未発行</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <PaymentNoticeButton castId={r.cast.id} from={from} to={to} label="プレビュー" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>支払通知書を発行しますか？</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-sm text-muted-foreground">
              {format(new Date(`${from}T00:00:00`), 'M/d', { locale: ja })}〜{format(new Date(`${to}T00:00:00`), 'M/d', { locale: ja })} の内容で、以下{targets.length}人に通知を送ります。
            </p>
            <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
              {targets.map(t => (
                <div key={t.cast.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{t.cast.display_name ?? '—'}</span>
                  <span className="font-medium tabular-nums">¥{t.totalReward.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-1 text-sm font-bold">
              <span>合計</span>
              <span className="tabular-nums">¥{targetsTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>キャンセル</Button>
              <Button onClick={handleIssue} disabled={sending}>
                <Send className="h-3.5 w-3.5 mr-1" />{sending ? '送信中...' : '発行する'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
