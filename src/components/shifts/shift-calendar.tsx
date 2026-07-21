'use client'

import { useState } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  isSameDay, isSameMonth, addMonths, subMonths, format,
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

// モバイルの縮小セルでは時間まで表示するスペースがないため、ステータス色のドットだけで示す
const STATUS_DOT: Record<ShiftStatus, string> = {
  draft: 'bg-slate-400', submitted: 'bg-blue-500', confirmed: 'bg-emerald-500', rejected: 'bg-red-500',
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済', confirmed: '確定', rejected: '差し戻し',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  shifts: Shift[]
  showCastName?: boolean
  onDayClick?: (date: Date) => void
}

export function ShiftCalendar({ shifts, showCastName = false, onDayClick }: Props) {
  const [current, setCurrent] = useState(() => new Date())
  const [direction, setDirection] = useState<'next' | 'prev'>('next')

  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = getDay(monthStart)

  function shiftsOn(day: Date) {
    const key = format(day, 'yyyy-MM-dd')
    return shifts.filter(s => s.date === key)
  }

  function goPrev() { setDirection('prev'); setCurrent(subMonths(current, 1)) }
  function goNext() { setDirection('next'); setCurrent(addMonths(current, 1)) }

  return (
    <div>
      <style>{`
        @keyframes cal-in-next { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cal-in-prev { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        .cal-grid-next { animation: cal-in-next 0.28s cubic-bezier(0.16,1,0.3,1) both; }
        .cal-grid-prev { animation: cal-in-prev 0.28s cubic-bezier(0.16,1,0.3,1) both; }
      `}</style>

      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-2 px-1 md:px-0">
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

      <div className="mx-1 md:mx-0 rounded-2xl border border-border shadow-sm overflow-hidden bg-card">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted-foreground border-b border-border py-2 bg-muted/30">
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
            'grid grid-cols-7 divide-x divide-y divide-border gap-px bg-border',
            direction === 'next' ? 'cal-grid-next' : 'cal-grid-prev'
          )}
        >
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} className="bg-muted/20 min-h-[44px] md:min-h-[92px]" />
          ))}

          {days.map(day => {
            const dayShifts = shiftsOn(day)
            const isToday = isSameDay(day, new Date())
            const dow = getDay(day)

            return (
              <div
                key={day.toISOString()}
                onClick={onDayClick ? () => onDayClick(day) : undefined}
                className={cn(
                  'bg-card min-h-[44px] md:min-h-[92px] p-1 flex flex-col items-center md:items-stretch gap-0.5 md:gap-1',
                  !isSameMonth(day, current) && 'bg-muted/10',
                  onDayClick && 'cursor-pointer active:bg-muted/50 md:hover:bg-muted/30 transition-colors'
                )}
              >
                {/* 日付 */}
                <span className={cn(
                  'text-xs font-semibold w-6 h-6 mx-auto md:mx-0 flex items-center justify-center rounded-full transition-colors shrink-0',
                  isToday && 'bg-primary text-primary-foreground shadow-sm',
                  !isToday && dow === 0 && 'text-red-500',
                  !isToday && dow === 6 && 'text-blue-500',
                  !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
                )}>
                  {format(day, 'd')}
                </span>

                {/* シフト一覧: モバイルはドットのみ、デスクトップは時間まで表示 */}
                {dayShifts.length > 0 && (
                  <div className="flex gap-0.5 md:hidden">
                    {dayShifts.slice(0, 3).map(s => (
                      <span key={s.id} className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT[s.status])} />
                    ))}
                  </div>
                )}
                <div className="hidden md:flex flex-col gap-0.5 min-w-0">
                  {dayShifts.slice(0, 3).map(s => (
                    <div
                      key={s.id}
                      className={cn(
                        'rounded px-1 py-0.5 text-[10px] leading-tight truncate font-medium shadow-sm',
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
                    <span className="text-[10px] text-muted-foreground pl-0.5">
                      +{dayShifts.length - 3}件
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 凡例（モバイルはドットで色の意味が伝わるため省略） */}
      <div className="hidden md:flex flex-wrap gap-2 text-xs mt-3 px-1 md:px-0">
        {(Object.entries(STATUS_LEGEND) as [ShiftStatus, string][]).map(([status, cls]) => (
          <span key={status} className={cn('px-2 py-0.5 rounded-full font-medium', cls)}>
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  )
}
