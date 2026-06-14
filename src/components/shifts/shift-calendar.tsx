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

// ダーク背景でも見えるよう彩度を保った色にする
const STATUS_COLOR: Record<ShiftStatus, string> = {
  draft:     'bg-muted text-muted-foreground',
  submitted: 'bg-blue-500/20 text-blue-400',
  confirmed: 'bg-emerald-500/20 text-emerald-400',
  rejected:  'bg-red-500/20 text-red-400',
}

// 凡例はやや濃いめ
const STATUS_LEGEND: Record<ShiftStatus, string> = {
  draft:     'bg-muted text-muted-foreground',
  submitted: 'bg-blue-500/25 text-blue-500',
  confirmed: 'bg-emerald-500/25 text-emerald-600',
  rejected:  'bg-red-500/25 text-red-500',
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済', confirmed: '確定', rejected: '差し戻し',
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  shifts: Shift[]
  showCastName?: boolean
}

export function ShiftCalendar({ shifts, showCastName = false }: Props) {
  const [current, setCurrent] = useState(() => new Date())

  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = getDay(monthStart)

  function shiftsOn(day: Date) {
    const key = format(day, 'yyyy-MM-dd')
    return shifts.filter(s => s.date === key)
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-2 px-1 md:px-0">
        <h2 className="text-base font-semibold">
          {format(current, 'yyyy年M月', { locale: ja })}
        </h2>
        <div className="flex gap-1">
          <Button size="icon" variant="outline" className="h-7 w-7"
            onClick={() => setCurrent(subMonths(current, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-7 w-7"
            onClick={() => setCurrent(addMonths(current, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground border-b border-border py-1">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={cn(i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>
            {d}
          </div>
        ))}
      </div>

      {/* カレンダーグリッド */}
      <div className="grid grid-cols-7 divide-x divide-y divide-border border border-border md:rounded-lg md:overflow-hidden md:gap-px md:bg-border md:divide-none">
        {Array.from({ length: startPad }).map((_, i) => (
          <div key={`pad-${i}`} className="bg-card md:bg-muted/30 min-h-[80px] md:min-h-[88px]" />
        ))}

        {days.map(day => {
          const dayShifts = shiftsOn(day)
          const isToday = isSameDay(day, new Date())
          const dow = getDay(day)

          return (
            <div
              key={day.toISOString()}
              className={cn(
                'bg-card min-h-[80px] md:min-h-[88px] p-0.5 md:p-1 flex flex-col gap-0.5',
                !isSameMonth(day, current) && 'bg-muted/20'
              )}
            >
              {/* 日付 */}
              <span className={cn(
                'text-xs font-medium w-5 h-5 mx-auto md:mx-0 flex items-center justify-center rounded-full',
                isToday && 'bg-foreground text-background',
                !isToday && dow === 0 && 'text-red-500',
                !isToday && dow === 6 && 'text-blue-500',
                !isToday && dow !== 0 && dow !== 6 && 'text-foreground',
              )}>
                {format(day, 'd')}
              </span>

              {/* シフト一覧 */}
              <div className="flex flex-col gap-px min-w-0">
                {dayShifts.slice(0, 3).map(s => (
                  <div
                    key={s.id}
                    className={cn(
                      'rounded-sm px-0.5 md:px-1 py-0.5 text-[9px] md:text-[10px] leading-tight truncate',
                      STATUS_COLOR[s.status]
                    )}
                    title={`${showCastName && s.cast ? s.cast.display_name + ' ' : ''}${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)} ${STATUS_LABEL[s.status]}`}
                  >
                    <span className="sm:hidden font-medium">
                      {showCastName && s.cast
                        ? s.cast.display_name
                        : s.start_time.slice(0, 5)}
                    </span>
                    <span className="hidden sm:inline">
                      {showCastName && s.cast && (
                        <span className="font-medium">{s.cast.display_name} </span>
                      )}
                      {s.start_time.slice(0, 5)}〜{s.end_time.slice(0, 5)}
                    </span>
                  </div>
                ))}
                {dayShifts.length > 3 && (
                  <span className="text-[9px] md:text-[10px] text-muted-foreground pl-0.5">
                    +{dayShifts.length - 3}件
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-2 text-xs mt-3 px-1 md:px-0">
        {(Object.entries(STATUS_LEGEND) as [ShiftStatus, string][]).map(([status, cls]) => (
          <span key={status} className={cn('px-2 py-0.5 rounded', cls)}>
            {STATUS_LABEL[status]}
          </span>
        ))}
      </div>
    </div>
  )
}
