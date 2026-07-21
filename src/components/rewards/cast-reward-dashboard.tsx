'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  TrendingUp, TrendingDown, Minus, Target, Pencil, StickyNote, Lock,
  CircleDollarSign, CalendarDays, CalendarRange, BarChart3,
} from 'lucide-react'

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

interface DayDetail {
  total: number
  rows: { platform: string; amount: number; is_daily_payment: boolean }[]
  shift: { start_time: string; end_time: string; admin_note: string | null; checklistLabels: string[] } | null
}

interface Props {
  userId: string
  displayName: string | null
  monthLabel: string
  thisMonthTotal: number
  prevMonthTotal: number
  monthlyGoal: number | null
  calendarDays: { date: string | null; day: number | null; amount: number; isToday: boolean }[]
  workedDaysThisMonth: number
  avgPerWorkedDay: number
  trend: { date: string; amount: number }[]
  weekday: { label: string; amount: number }[]
  dayDetails: Record<string, DayDetail>
  usdJpyRate: number | null
  finalizedReward: number | null
}

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf: number
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return value
}

const WEEKDAY_HEADS = ['日', '月', '火', '水', '木', '金', '土']

export function CastRewardDashboard({
  userId, monthLabel, thisMonthTotal, prevMonthTotal, monthlyGoal: initialGoal,
  calendarDays, workedDaysThisMonth, avgPerWorkedDay, trend, weekday, dayDetails,
  usdJpyRate, finalizedReward,
}: Props) {
  const [activeTab, setActiveTab] = useState<'calendar' | 'report'>('calendar')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [monthlyGoal, setMonthlyGoal] = useState(initialGoal)
  const [goalOpen, setGoalOpen] = useState(false)
  const [goalInput, setGoalInput] = useState(initialGoal != null ? String(initialGoal) : '')
  const [savingGoal, setSavingGoal] = useState(false)
  const supabase = createClient()

  const animatedTotal = useCountUp(thisMonthTotal, 1100)
  const delta = prevMonthTotal > 0 ? ((thisMonthTotal - prevMonthTotal) / prevMonthTotal) * 100 : null
  const goalProgress = monthlyGoal && monthlyGoal > 0 ? Math.min(100, (thisMonthTotal / monthlyGoal) * 100) : null

  async function saveGoal() {
    const value = goalInput ? parseFloat(goalInput) : null
    setSavingGoal(true)
    const { error } = await supabase.from('users').update({ monthly_goal: value }).eq('id', userId)
    setSavingGoal(false)
    if (error) { toast.error('目標の保存に失敗しました'); return }
    setMonthlyGoal(value)
    setGoalOpen(false)
    toast.success('目標を更新しました')
  }

  const detail = selectedDate ? dayDetails[selectedDate] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">収益ダッシュボード</h1>
          <p className="text-sm text-muted-foreground">{monthLabel}</p>
        </div>
        <div className="flex rounded-lg border overflow-hidden shrink-0">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${activeTab === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            <CalendarRange className="h-3.5 w-3.5" />カレンダー
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors border-l ${activeTab === 'report' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
          >
            <BarChart3 className="h-3.5 w-3.5" />レポート
          </button>
        </div>
      </div>

      <Card className="overflow-hidden border-primary/20">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs text-muted-foreground">今月の売上合計</p>
              <p className="text-3xl font-extrabold tabular-nums mt-0.5">¥{animatedTotal.toLocaleString()}</p>
            </div>
            {delta != null && (
              <span
                className={
                  'inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ' +
                  (delta > 0.5 ? 'text-green-700 bg-green-100' : delta < -0.5 ? 'text-red-700 bg-red-100' : 'text-muted-foreground bg-muted')
                }
              >
                {delta > 0.5 ? <TrendingUp className="h-3 w-3" /> : delta < -0.5 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                先月比 {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            )}
          </div>

          {finalizedReward != null && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />確定報酬: <span className="font-medium text-foreground">¥{finalizedReward.toLocaleString()}</span>
            </p>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" />
                {monthlyGoal ? `目標 ¥${monthlyGoal.toLocaleString()} まで ${goalProgress!.toFixed(0)}%` : '目標が設定されていません'}
              </span>
              <button
                type="button"
                onClick={() => { setGoalInput(monthlyGoal != null ? String(monthlyGoal) : ''); setGoalOpen(true) }}
                className="text-xs text-primary flex items-center gap-0.5 hover:underline"
              >
                <Pencil className="h-3 w-3" />{monthlyGoal ? '編集' : '設定する'}
              </button>
            </div>
            {monthlyGoal != null && (
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${goalProgress}%` }} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {activeTab === 'calendar' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-muted-foreground">稼働日数</p><p className="text-lg font-bold mt-0.5">{workedDaysThisMonth}日</p></CardContent></Card>
            <Card><CardContent className="pt-4 pb-4"><p className="text-xs text-muted-foreground">1日の平均</p><p className="text-lg font-bold mt-0.5">¥{avgPerWorkedDay.toLocaleString()}</p></CardContent></Card>
          </div>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1.5">
                {WEEKDAY_HEADS.map(d => <div key={d} className="text-muted-foreground font-medium py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((c, i) => (
                  c.date == null ? <div key={i} /> : (
                    <button
                      key={c.date}
                      onClick={() => setSelectedDate(selectedDate === c.date ? null : c.date)}
                      className={
                        'rounded-lg py-1.5 text-center transition-colors ' +
                        (selectedDate === c.date ? 'bg-primary text-primary-foreground' : c.amount > 0 ? 'bg-primary/10 hover:bg-primary/20' : 'hover:bg-muted')
                      }
                      style={c.isToday && selectedDate !== c.date ? { boxShadow: 'inset 0 0 0 1.5px var(--primary)' } : undefined}
                    >
                      <div className="text-xs font-semibold">{c.day}</div>
                      {c.amount > 0 && (
                        <div className={'text-[9px] mt-0.5 tabular-nums ' + (selectedDate === c.date ? '' : 'text-primary')}>
                          {Math.round(c.amount / 1000)}k
                        </div>
                      )}
                    </button>
                  )
                ))}
              </div>
            </CardContent>
          </Card>

          {detail && selectedDate && (
            <Card className="border-primary/30">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    {format(new Date(`${selectedDate}T00:00:00`), 'M月d日(E)', { locale: ja })}
                  </p>
                  <p className="text-lg font-bold tabular-nums">¥{detail.total.toLocaleString()}</p>
                </div>
                {detail.shift && (
                  <p className="text-xs text-muted-foreground">
                    シフト時間: {detail.shift.start_time.slice(0, 5)} 〜 {detail.shift.end_time.slice(0, 5)}
                  </p>
                )}
                {detail.rows.length > 0 && (
                  <div className="space-y-1">
                    {detail.rows.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {PLATFORM_LABEL[r.platform] ?? r.platform}
                          {r.is_daily_payment && <Badge variant="outline" className="text-[10px]">日払い</Badge>}
                        </span>
                        <span className="tabular-nums">¥{r.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
                {detail.shift && detail.shift.checklistLabels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {detail.shift.checklistLabels.map(label => (
                      <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>
                    ))}
                  </div>
                )}
                {detail.shift?.admin_note && (
                  <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <StickyNote className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold text-amber-700">スタッフより</p>
                      <p className="text-xs text-amber-800 mt-0.5">{detail.shift.admin_note}</p>
                    </div>
                  </div>
                )}
                {detail.total === 0 && detail.rows.length === 0 && !detail.shift && (
                  <p className="text-xs text-muted-foreground text-center py-2">この日のデータはありません</p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {activeTab === 'report' && (
        <>
          <TrendChart data={trend} />
          <WeekdayChart data={weekday} />

          {usdJpyRate != null && (
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CircleDollarSign className="h-3.5 w-3.5" />USD → JPY（本日のレート）
                  </span>
                  <span className="font-bold tabular-nums">¥{Number(usdJpyRate).toFixed(2)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  STRIPCHAT・DXライブの売上はこのレートで換算表示されます（お支払いは確定時のレートで計算されます）
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>今月の目標を設定</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>目標金額（円）</Label>
              <Input type="number" min="0" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="例: 500000" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setGoalOpen(false)}>キャンセル</Button>
              <Button onClick={saveGoal} disabled={savingGoal}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TrendChart({ data }: { data: { date: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const width = 320
  const height = 130
  const padTop = 10
  const padBottom = 18
  const max = Math.max(1, ...data.map(d => d.amount))

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width
    const y = padTop + (1 - d.amount / max) * (height - padTop - padBottom)
    return { x, y, ...d }
  })
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - padBottom} L${points[0].x.toFixed(1)},${height - padBottom} Z`

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * width
    let nearest = 0
    let best = Infinity
    points.forEach((p, i) => { const dist = Math.abs(p.x - relX); if (dist < best) { best = dist; nearest = i } })
    setHover(nearest)
  }
  const hovered = hover != null ? points[hover] : null

  return (
    <Card>
      <CardContent className="pt-4 pb-4" style={{ position: 'relative' }}>
        <p className="text-sm font-semibold mb-0.5">売上推移</p>
        <p className="text-xs text-muted-foreground mb-2">直近30日</p>
        <svg
          ref={svgRef} viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', cursor: 'crosshair' }}
          onMouseMove={handleMove} onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="cast-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#cast-trend-fill)" stroke="none" />
          <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {hovered && (
            <>
              <line x1={hovered.x} x2={hovered.x} y1={padTop} y2={height - padBottom} stroke="var(--border)" strokeWidth={1} />
              <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
        </svg>
        {hovered && (
          <div
            className="absolute pointer-events-none bg-popover border rounded-md px-2 py-1 text-xs shadow-md -translate-x-1/2 -translate-y-full"
            style={{ left: `${(hovered.x / width) * 100}%`, top: `${(hovered.y / height) * 100}%` }}
          >
            <div className="text-muted-foreground">{format(new Date(`${hovered.date}T00:00:00`), 'M/d(E)', { locale: ja })}</div>
            <div className="font-semibold tabular-nums">¥{hovered.amount.toLocaleString()}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WeekdayChart({ data }: { data: { label: string; amount: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.amount))
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-sm font-semibold mb-0.5">曜日別 平均売上</p>
        <p className="text-xs text-muted-foreground mb-3">直近60日の平均</p>
        <div className="flex items-end gap-2" style={{ height: 90 }}>
          {data.map(d => {
            const h = Math.max(3, (d.amount / max) * 66)
            return (
              <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[9px] text-muted-foreground mb-1 tabular-nums">
                  {d.amount > 0 ? Math.round(d.amount / 1000) + 'k' : ''}
                </span>
                <div className="w-full rounded-t-sm bg-primary/60" style={{ height: h }} />
                <span className="text-[10px] text-muted-foreground mt-1.5">{d.label}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
