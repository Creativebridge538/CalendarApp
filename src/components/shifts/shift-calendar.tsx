'use client'

import { useState } from 'react'
import {
  startOfMonth, eachDayOfInterval, getDay,
  isSameDay, isSameMonth, addMonths, subMonths, subDays, addDays, format,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

type ShiftStatus = Database['public']['Enums']['shift_status']

interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  status: ShiftStatus
  cast?: { display_name: string | null } | null
  rooms?: { name: string } | null
}

// TimeTreeのような塗りつぶし色チップ（白文字で視認性を確保）
const STATUS_CHIP: Record<ShiftStatus, string> = {
  draft:     'bg-slate-400 text-white',
  submitted: 'bg-blue-500 text-white',
  confirmed: 'bg-emerald-500 text-white',
  rejected:  'bg-red-500 text-white',
}

const STATUS_LEGEND: Record<ShiftStatus, string> = {
  draft:     'bg-muted text-muted-foreground',
  submitted: 'bg-blue-500/15 text-blue-600',
  confirmed: 'bg-emerald-500/15 text-emerald-600',
  rejected:  'bg-red-500/15 text-red-600',
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済', confirmed: '確定', rejected: '差し戻し',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  shifts: Shift[]
  showCastName?: boolean
  onDayClick?: (date: Date) => void
  /** 指定すると月の状態は呼び出し元が管理し、内蔵のヘッダー（タイトル・前後ボタン）は表示しない */
  current?: Date
  direction?: 'next' | 'prev'
  /** yyyy-MM-dd の集合。整理日の控えめなドット表示に使用 */
  periodDates?: Set<string>
}

export function ShiftCalendar({ shifts, showCastName = false, onDayClick, current: controlledCurrent, direction: controlledDirection, periodDates }: Props) {
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
          <h2 className="text-lg font-bold tracking-tight">
            {format(current, 'yyyy年M月', { locale: ja })}
          </h2>
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
        <div
          className="grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground pb-2 border-b-2"
          style={{ borderColor: 'var(--brand-accent)' }}
        >
          {WEEKDAYS.map((d, i) => (
            <div key={d} className={cn(i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>
              {d}
            </div>
          ))}
        </div>

        {/* カレンダーグリッド */}
        <div
          key={monthStart.toISOString()}
          className={cn(
            'grid grid-cols-7 divide-x divide-y divide-border/40',
            direction === 'next' ? 'cal-grid-next' : 'cal-grid-prev'
          )}
        >
          {days.map(day => {
            const inMonth = isSameMonth(day, current)
            const dayShifts = inMonth ? shiftsOn(day) : []
            const isToday = inMonth && isSameDay(day, new Date())
            const dow = getDay(day)
            const isPeriod = inMonth && periodDates?.has(format(day, 'yyyy-MM-dd'))

            return (
              <div
                key={day.toISOString()}
                onClick={onDayClick && inMonth ? () => onDayClick(day) : undefined}
                className={cn(
                  'relative h-[84px] md:h-[112px] pt-1 px-1.5 pb-1.5 flex flex-col items-stretch gap-0.5 overflow-hidden',
                  !inMonth && 'opacity-40',
                  onDayClick && inMonth && 'cursor-pointer active:bg-muted/40 md:hover:bg-muted/20 transition-colors'
                )}
              >
                {isPeriod && (
                  <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-pink-400" title="整理日" />
                )}
                {/* 日付 */}
                <span className={cn(
                  'text-[10px] font-semibold w-4 h-4 mx-auto flex items-center justify-center rounded-full transition-colors shrink-0',
                  isToday && 'bg-[var(--brand-accent)] text-white',
                  !isToday && dow === 0 && 'text-red-500',
                  !isToday && dow === 6 && 'text-blue-500',
                  !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
                )}>
                  {format(day, 'd')}
                </span>

                {/* シフト一覧: モバイルは開始時刻だけの簡易チップ、デスクトップは時間まで表示 */}
                <div className="flex flex-col gap-0.5 min-w-0 w-full md:hidden">
                  {dayShifts.slice(0, 2).map(s => (
                    <div
                      key={s.id}
                      className={cn('rounded-[3px] px-1 py-0.5 text-[9px] leading-tight text-center font-medium', STATUS_CHIP[s.status])}
                    >
                      {s.start_time.slice(0, 5)}
                    </div>
                  ))}
                  {dayShifts.length > 2 && (
                    <span className="text-[10px] text-muted-foreground text-center tracking-wider leading-none">•••</span>
                  )}
                </div>
                <div className="hidden md:flex flex-col gap-0.5 min-w-0">
                  {dayShifts.slice(0, 3).map(s => (
                    <div
                      key={s.id}
                      className={cn(
                        'rounded-[3px] px-1 py-0.5 text-[10px] leading-tight truncate font-medium',
                        STATUS_CHIP[s.status]
                      )}
                      title={`${showCastName && s.cast ? s.cast.display_name + ' ' : ''}${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)} ${STATUS_LABEL[s.status]}`}
                    >
                      {showCastName && s.cast && (
                        <span className="font-semibold">{s.cast.display_name} </span>
                      )}
                      {s.start_time.slice(0, 5)}〜{s.end_time.slice(0, 5)}
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

      {/* 凡例 */}
      <div className="flex flex-wrap gap-2 text-xs mt-3 px-1 md:px-0">
        {(Object.entries(STATUS_LEGEND) as [ShiftStatus, string][]).map(([status, cls]) => (
          <span key={status} className={cn('px-2 py-0.5 rounded-full font-medium', cls)}>
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  )
}
