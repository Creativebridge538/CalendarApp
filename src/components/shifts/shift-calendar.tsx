'use client'

import { useRef, useState, type CSSProperties } from 'react'
import {
  startOfMonth, eachDayOfInterval, getDay,
  isSameDay, isSameMonth, addMonths, subMonths, subDays, addDays, format,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MonthYearPicker } from '@/components/shifts/month-year-picker'
import type { Database } from '@/lib/supabase/database.types'

type ShiftStatus = Database['public']['Enums']['shift_status']

interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  status: ShiftStatus
  is_period_day?: boolean
  cast?: { display_name: string | null } | null
  rooms?: { name: string } | null
}

// TimeTreeのような塗りつぶし色チップ（白文字で視認性を確保）。着せ替えで --status-* が上書きされる
const STATUS_VAR: Record<ShiftStatus, string> = {
  draft: 'var(--status-draft)',
  submitted: 'var(--status-submitted)',
  confirmed: 'var(--status-confirmed)',
  rejected: 'var(--status-rejected)',
  modification_requested: 'var(--status-modification-requested)',
}

function chipStyle(status: ShiftStatus): CSSProperties {
  return { backgroundColor: `color-mix(in srgb, ${STATUS_VAR[status]} 82%, transparent)`, color: '#fff' }
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済', confirmed: '確定', rejected: '差し戻し', modification_requested: '修正依頼中',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  shifts: Shift[]
  showCastName?: boolean
  onDayClick?: (date: Date) => void
  /** 指定すると月の状態は呼び出し元が管理し、内蔵のヘッダー（タイトル・前後ボタン）は表示しない */
  current?: Date
  direction?: 'next' | 'prev'
  /** current を指定している場合、スワイプで前後の月に移動できるようにするためのコールバック */
  onNavigate?: (direction: 'next' | 'prev') => void
  /** yyyy-MM-dd の集合。指定した日をまとめて追加モードの選択中として強調表示 */
  selectedDates?: Set<string>
  /** 'amount' の場合、各日をシフトチップの代わりに amountByDate の金額で表示する */
  mode?: 'time' | 'amount'
  amountByDate?: Record<string, number>
}

export function ShiftCalendar({
  shifts, showCastName = false, onDayClick, current: controlledCurrent, direction: controlledDirection,
  onNavigate, selectedDates, mode = 'time', amountByDate,
}: Props) {
  const [internalCurrent, setInternalCurrent] = useState(() => new Date())
  const [internalDirection, setInternalDirection] = useState<'next' | 'prev'>('next')
  const isControlled = controlledCurrent !== undefined
  const current = isControlled ? controlledCurrent : internalCurrent
  const direction = isControlled ? (controlledDirection ?? 'next') : internalDirection

  const monthStart = startOfMonth(current)
  const startPad = getDay(monthStart)
  // 常に6週分（42マス）で統一し、月によってカレンダーの高さが変わらないようにする
  const gridStart = subDays(monthStart, startPad)
  const days = eachDayOfInterval({ start: gridStart, end: addDays(gridStart, 41) })

  function shiftsOn(day: Date) {
    const key = format(day, 'yyyy-MM-dd')
    return shifts.filter(s => s.date === key)
  }

  function goPrev() { setInternalDirection('prev'); setInternalCurrent(subMonths(internalCurrent, 1)) }
  function goNext() { setInternalDirection('next'); setInternalCurrent(addMonths(internalCurrent, 1)) }

  // 指差同士のスワイプで前後の月へ切り替える（縦スクロールと誤認しないよう横方向の移動が優位な場合のみ反応）
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const dir = dx < 0 ? 'next' : 'prev'
    if (isControlled) onNavigate?.(dir)
    else if (dir === 'next') goNext()
    else goPrev()
  }

  return (
    <div>
      <style>{`
        @keyframes cal-in-next { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cal-in-prev { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
        .cal-grid-next { animation: cal-in-next 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .cal-grid-prev { animation: cal-in-prev 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>

      {!isControlled && (
        <div className="flex items-center justify-between mb-3 px-1 md:px-0">
          <MonthYearPicker
            value={current}
            onChange={d => { setInternalDirection(d > internalCurrent ? 'next' : 'prev'); setInternalCurrent(d) }}
            className="text-xl font-extrabold tracking-tight"
          >
            {format(current, 'yyyy年M月', { locale: ja })}
          </MonthYearPicker>
          <div className="flex gap-1.5">
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={goPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={goNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div>
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground pb-2 border-b border-border">
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={cn(i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>
              {d}
            </div>
          ))}
        </div>

        {/* カレンダーグリッド */}
        <div
          key={monthStart.toISOString()}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={cn(
            'grid grid-cols-7 divide-y divide-border border-t border-border',
            direction === 'next' ? 'cal-grid-next' : 'cal-grid-prev'
          )}
        >
          {days.map(day => {
            const inMonth = isSameMonth(day, current)
            const dayShifts = inMonth ? shiftsOn(day) : []
            const isToday = inMonth && isSameDay(day, new Date())
            const dow = getDay(day)
            const dayKey = format(day, 'yyyy-MM-dd')
            const isSelected = inMonth && selectedDates?.has(dayKey)

            return (
              <div
                key={day.toISOString()}
                onClick={onDayClick && inMonth ? () => onDayClick(day) : undefined}
                className={cn(
                  'relative h-[84px] md:h-[112px] pt-2 pb-0 flex flex-col items-stretch gap-1 overflow-hidden',
                  !inMonth && 'opacity-40',
                  onDayClick && inMonth && 'cursor-pointer active:bg-muted/40 md:hover:bg-muted/20 transition-colors',
                  isSelected && 'bg-[color-mix(in_srgb,var(--brand-accent)_12%,transparent)] ring-1 ring-inset ring-[var(--brand-accent)]'
                )}
              >
                {isSelected && (
                  <span
                    className="absolute top-1 left-1.5 h-3.5 w-3.5 rounded-full flex items-center justify-center text-white text-[8px] font-bold"
                    style={{ backgroundColor: 'var(--brand-accent)' }}
                  >
                    ✓
                  </span>
                )}
                {/* 日付 */}
                <span className={cn(
                  'text-xs font-medium w-5 h-5 mx-auto flex items-center justify-center rounded-full transition-colors shrink-0 tabular-nums',
                  isToday && 'bg-[var(--brand-accent)] text-white font-semibold',
                  !isToday && dow === 0 && 'text-red-500',
                  !isToday && dow === 6 && 'text-blue-500',
                  !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
                )}>
                  {format(day, 'd')}
                </span>

                {/* 金額表示モード: シフトチップの代わりにその日の売上合計を表示 */}
                {mode === 'amount' && inMonth && (amountByDate?.[dayKey] ?? 0) > 0 && (
                  <div className="flex flex-col items-center px-0.5 min-w-0 w-full">
                    <span
                      className="w-full rounded-[4px] px-1 py-0.5 text-[10px] md:text-[11px] leading-tight tracking-tight text-center font-bold overflow-hidden whitespace-nowrap tabular-nums"
                      style={{ backgroundColor: 'color-mix(in srgb, var(--brand-accent) 15%, transparent)', color: 'var(--brand-accent)' }}
                    >
                      {amountByDate![dayKey].toLocaleString()}
                    </span>
                  </div>
                )}

                {/* シフト一覧: 色でステータス、テキストはルーム名（無ければ状態名）を表示。チップには軽い影をつけて浮かせる */}
                <div className={cn('flex-col gap-0.5 min-w-0 w-full px-0.5 md:hidden', mode === 'time' ? 'flex' : 'hidden')}>
                  {dayShifts.slice(0, 2).map(s => (
                    <div
                      key={s.id}
                      className="w-full rounded-[4px] px-1 py-0.5 text-[9px] leading-tight tracking-tight text-center font-semibold overflow-hidden whitespace-nowrap"
                      style={chipStyle(s.status)}
                      title={`${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)} ${STATUS_LABEL[s.status]}`}
                    >
                      {`${s.start_time.slice(0, 5)} `}
                      {s.rooms?.name ?? STATUS_LABEL[s.status]}
                    </div>
                  ))}
                  {dayShifts.length > 2 && (
                    <span className="text-[10px] text-muted-foreground text-center tracking-wider leading-none">•••</span>
                  )}
                </div>
                <div className={cn('md:flex-col gap-0.5 min-w-0 px-0.5 hidden', mode === 'time' && 'md:flex')}>
                  {dayShifts.slice(0, 3).map(s => (
                    <div
                      key={s.id}
                      className="w-full rounded-[4px] px-1 py-0.5 text-[10px] leading-tight tracking-tight overflow-hidden whitespace-nowrap font-semibold"
                      style={chipStyle(s.status)}
                      title={`${showCastName && s.cast ? s.cast.display_name + ' ' : ''}${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)} ${STATUS_LABEL[s.status]}`}
                    >
                      {showCastName && s.cast && (
                        <span className="font-bold">{s.cast.display_name} </span>
                      )}
                      {`${s.start_time.slice(0, 5)} `}
                      {s.rooms?.name ?? STATUS_LABEL[s.status]}
                    </div>
                  ))}
                  {dayShifts.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-0.5 tracking-wider leading-none">
                      •••
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
