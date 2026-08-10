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
  TrendingUp, TrendingDown, Minus, Pencil, StickyNote, Lock,
  CircleDollarSign, CalendarDays, CalendarRange, BarChart3,
} from 'lucide-react'
import { PaymentNoticeButton } from '@/components/rewards/payment-notice-modal'
import { GoalRing } from '@/components/rewards/goal-ring'
import { cn } from '@/lib/utils'

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
  year: number
  month: number
  thisMonthTotal: number
  prevMonthToDateTotal: number
  monthlyGoal: number | null
  calendarDays: { date: string | null; day: number | null; amount: number; hours: number; isToday: boolean }[]
  avgPerWorkedDay: number
  attendanceDaysThisMonth: number
  shiftCountThisMonth: number
  totalHoursThisMonth: number
  platformBreakdown: { platform: string; amount: number }[]
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
  userId, monthLabel, year, month, thisMonthTotal, prevMonthToDateTotal, monthlyGoal: initialGoal,
  calendarDays, avgPerWorkedDay,
  attendanceDaysThisMonth, shiftCountThisMonth, totalHoursThisMonth, platformBreakdown,
  trend, weekday, dayDetails, usdJpyRate, finalizedReward,
}: Props) {
  const [activeTab, setActiveTab] = useState<'calendar' | 'report'>('calendar')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [monthlyGoal, setMonthlyGoal] = useState(initialGoal)
  const [goalOpen, setGoalOpen] = useState(false)
  const [goalInput, setGoalInput] = useState(initialGoal != null ? String(initialGoal) : '')
  const [savingGoal, setSavingGoal] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const supabase = createClient()

  const animatedTotal = useCountUp(thisMonthTotal, 1100)
  const prevMonthDelta = prevMonthToDateTotal > 0 ? ((thisMonthTotal - prevMonthToDateTotal) / prevMonthToDateTotal) * 100 : null
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="shrink-0">
          <h1 className="text-xl font-bold whitespace-nowrap">収益ダッシュボード</h1>
          <p className="text-sm text-muted-foreground">{monthLabel}</p>
        </div>
        <div className="flex rounded-full bg-muted p-0.5 shrink-0 shadow-[inset_0_1px_3px_oklch(0_0_0_/_10%)]">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 ${
              activeTab === 'calendar'
                ? 'bg-[var(--brand-accent)] text-white shadow-[0_2px_6px_oklch(0_0_0_/_15%)]'
                : 'text-muted-foreground'
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" />カレンダー
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 ${
              activeTab === 'report'
                ? 'bg-[var(--brand-accent)] text-white shadow-[0_2px_6px_oklch(0_0_0_/_15%)]'
                : 'text-muted-foreground'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />レポート
          </button>
        </div>
      </div>

      <Card elevated>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{month}月ここまで</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="text-3xl font-extrabold tabular-nums">¥{animatedTotal.toLocaleString()}</p>
                <button
                  type="button"
                  onClick={() => setBreakdownOpen(true)}
                  className="text-xs font-medium rounded-full border px-2.5 py-1 shrink-0 hover:bg-muted transition-colors"
                >
                  内訳
                </button>
              </div>
              {prevMonthDelta != null && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {prevMonthDelta > 0.5 ? <TrendingUp className="h-3 w-3 text-positive" /> : prevMonthDelta < -0.5 ? <TrendingDown className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3" />}
                  先月の同じ日まで {prevMonthDelta > 0 ? '+' : ''}{prevMonthDelta.toFixed(1)}%
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setGoalInput(monthlyGoal != null ? String(monthlyGoal) : ''); setGoalOpen(true) }}
              className="flex flex-col items-center shrink-0"
            >
              <GoalRing percent={goalProgress ?? 0} size={56} stroke={5} textClassName="text-xs font-bold" />
              <div className="text-[10px] text-muted-foreground text-center mt-1 space-y-0">
                <p className="tabular-nums">出勤{attendanceDaysThisMonth}日・{shiftCountThisMonth}件・{totalHoursThisMonth.toFixed(1)}h</p>
                <p className="flex items-center justify-center gap-0.5">
                  {monthlyGoal ? `目標 ¥${monthlyGoal.toLocaleString()}` : '目標未設定'}
                  <Pencil className="h-2.5 w-2.5" style={{ color: 'var(--brand-accent)' }} />
                </p>
              </div>
            </button>
          </div>

          {finalizedReward != null && (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3" />確定報酬: <span className="font-medium text-foreground">¥{finalizedReward.toLocaleString()}</span>
              </p>
              <PaymentNoticeButton castId={userId} year={year} month={month} label="支払通知書" variant="tonal" />
            </div>
          )}
        </CardContent>
      </Card>

      {activeTab === 'calendar' && (
        <>
          <Card elevated>
            <CardContent className="pt-4 pb-3 px-3">
              <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground pb-2">
                {WEEKDAY_HEADS.map((d, i) => (
                  <div key={d} className={cn(i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 divide-y divide-border border-t border-border">
                {calendarDays.map((c, i) => (
                  c.date == null ? <div key={i} /> : (
                    <button
                      key={c.date}
                      type="button"
                      onClick={() => setSelectedDate(selectedDate === c.date ? null : c.date)}
                      className={cn(
                        'flex flex-col items-start gap-0.5 min-h-[64px] px-1.5 py-2 text-left transition-colors',
                        selectedDate === c.date ? 'bg-muted' : c.isToday ? 'bg-[color-mix(in_oklch,var(--brand-accent)_10%,transparent)]' : 'hover:bg-muted/50'
                      )}
                    >
                      <span className="text-xs font-medium tabular-nums">{c.day}</span>
                      {c.isToday ? (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--brand-accent)' }}>本日出勤</span>
                      ) : (
                        <>
                          {c.amount > 0 && <span className="text-[12px] font-bold tabular-nums leading-tight">{c.amount.toLocaleString()}</span>}
                          {c.hours > 0 && <span className="text-[10px] text-muted-foreground tabular-nums">{c.hours.toFixed(1)}h</span>}
                        </>
                      )}
                    </button>
                  )
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground text-center mt-2.5">
                数字=売上（円）・下段=勤務時間。タップで明細
              </p>
            </CardContent>
          </Card>

          {detail && selectedDate && (
            <Card elevated>
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
                  <div className="flex gap-2 bg-note/10 border border-note/30 rounded-lg p-2.5">
                    <StickyNote className="h-3.5 w-3.5 text-note shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold text-note">スタッフより</p>
                      <p className="text-xs text-foreground mt-0.5">{detail.shift.admin_note}</p>
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
            <Card elevated>
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

      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{month}月の内訳</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            {platformBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">まだ売上データがありません</p>
            ) : (
              <div className="space-y-1.5">
                {platformBreakdown.map(row => (
                  <div key={row.platform} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{PLATFORM_LABEL[row.platform] ?? row.platform}</span>
                    <span className="tabular-nums font-medium">¥{row.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-sm pt-2 border-t">
              <span className="text-muted-foreground">1日の平均</span>
              <span className="tabular-nums font-medium">¥{avgPerWorkedDay.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t">
              <span>合計</span>
              <span className="tabular-nums">¥{thisMonthTotal.toLocaleString()}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              <Button variant="elevated" onClick={saveGoal} disabled={savingGoal}>保存</Button>
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
    <Card elevated>
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
              <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#cast-trend-fill)" stroke="none" />
          <path d={linePath} fill="none" stroke="var(--brand-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {hovered && (
            <>
              <line x1={hovered.x} x2={hovered.x} y1={padTop} y2={height - padBottom} stroke="var(--border)" strokeWidth={1} />
              <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--brand-accent)" stroke="var(--card)" strokeWidth={2} />
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
    <Card elevated>
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
                <div className="w-full rounded-t-sm" style={{ height: h, backgroundColor: 'color-mix(in oklch, var(--brand-accent) 60%, transparent)' }} />
                <span className="text-[10px] text-muted-foreground mt-1.5">{d.label}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
