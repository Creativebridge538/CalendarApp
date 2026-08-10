'use client'

import { useMemo, useState } from 'react'
import { eachDayOfInterval, parseISO, format, addDays, startOfWeek } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

type ShiftStatus = Database['public']['Enums']['shift_status']

export interface TimelineShift {
  id: string
  date: string
  start_time: string
  end_time: string
  status: ShiftStatus
  cast_id: string
  area_id: string | null
  room_id: string | null
  cast: { display_name: string | null } | null
}

interface Props {
  shifts: TimelineShift[]
  areas: { id: string; name: string }[]
  rooms: { id: string; name: string; area_id: string | null }[]
  locationMode: string
  areaLabel: string
  roomLabel: string
  onShiftClick?: (shiftId: string) => void
}

const HOUR_W = 72
const DATE_W = 76
const ROW_H = 44
const HEADER_H = 32

const CAST_COLORS = [
  '#60a5fa', '#a78bfa', '#f472b6', '#34d399',
  '#fbbf24', '#22d3ee', '#fb923c', '#818cf8',
  '#4ade80', '#f87171', '#c084fc', '#38bdf8',
]

function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export function ShiftTimeline({ shifts, areas, rooms, locationMode, areaLabel, roomLabel, onShiftClick }: Props) {
  const tabs = useMemo(() => {
    if (locationMode === 'area_only' || locationMode === 'area_and_room') {
      return [{ id: 'all', name: 'すべて' }, ...areas.map(a => ({ id: a.id, name: a.name }))]
    }
    if (locationMode === 'room') {
      return [{ id: 'all', name: 'すべて' }, ...rooms.map(r => ({ id: r.id, name: r.name }))]
    }
    return [] as { id: string; name: string }[]
  }, [locationMode, areas, rooms])

  const [activeTab, setActiveTab] = useState('all')

  const [startDate, setStartDate] = useState<Date>(() => {
    if (shifts.length > 0) {
      const earliest = [...shifts].map(s => s.date).sort()[0]
      return startOfWeek(parseISO(earliest), { weekStartsOn: 1 })
    }
    return startOfWeek(new Date(), { weekStartsOn: 1 })
  })

  const filteredShifts = useMemo(() => {
    if (activeTab === 'all') return shifts
    if (locationMode === 'area_only' || locationMode === 'area_and_room') {
      return shifts.filter(s => s.area_id === activeTab)
    }
    if (locationMode === 'room') {
      return shifts.filter(s => s.room_id === activeTab)
    }
    return shifts
  }, [shifts, activeTab, locationMode])

  const startHour = 0
  const endHour = 24
  const hourCount = endHour - startHour
  const hours = Array.from({ length: hourCount }, (_, i) => startHour + i)

  const days = useMemo(
    () => eachDayOfInterval({ start: startDate, end: addDays(startDate, 6) }),
    [startDate]
  )

  const castIds = useMemo(() => [...new Set(shifts.map(s => s.cast_id))], [shifts])

  const totalWidth = DATE_W + hourCount * HOUR_W

  return (
    <div className="flex flex-col">
      {tabs.length > 0 && (
        <div className="flex border-b overflow-x-auto shrink-0 bg-card">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-foreground text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2 border-b bg-card shrink-0">
        <button
          onClick={() => setStartDate(d => addDays(d, -7))}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          前の週
        </button>
        <span className="text-xs text-muted-foreground">
          {format(days[0], 'M/d', { locale: ja })} 〜 {format(days[6], 'M/d', { locale: ja })}
        </span>
        <button
          onClick={() => setStartDate(d => addDays(d, 7))}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          次の週
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-auto">
        <div style={{ width: totalWidth }}>
          {/* Time header */}
          <div className="flex sticky top-0 z-20 bg-card border-b" style={{ height: HEADER_H }}>
            <div className="shrink-0 sticky left-0 z-30 bg-card border-r" style={{ width: DATE_W }} />
            {hours.map(h => (
              <div
                key={h}
                className="shrink-0 border-r text-[11px] text-muted-foreground flex items-end pb-0.5 pl-1 font-mono"
                style={{ width: HOUR_W }}
              >
                {String(h % 24).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Date rows */}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd')
            const dayShifts = filteredShifts.filter(s => s.date === dateStr)
            const dow = day.getDay()
            const isWeekend = dow === 0 || dow === 6

            return (
              <div
                key={dateStr}
                className={cn('flex border-b', isWeekend ? 'bg-muted/40' : 'bg-card')}
                style={{ height: ROW_H }}
              >
                <div
                  className={cn(
                    'shrink-0 sticky left-0 z-10 border-r flex items-center justify-center',
                    isWeekend ? 'bg-muted/40' : 'bg-card'
                  )}
                  style={{ width: DATE_W }}
                >
                  <span className={cn(
                    'text-xs font-medium text-center leading-tight',
                    dow === 0 && 'text-red-500',
                    dow === 6 && 'text-blue-500',
                  )}>
                    {format(day, 'M/d', { locale: ja })}<br />
                    <span className="text-[10px]">{format(day, '(E)', { locale: ja })}</span>
                  </span>
                </div>

                <div className="relative flex-1">
                  {hours.map(h => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-r border-border"
                      style={{ left: (h - startHour) * HOUR_W, width: HOUR_W }}
                    />
                  ))}

                  {dayShifts.map(shift => {
                    const sh = timeToHours(shift.start_time)
                    let eh = timeToHours(shift.end_time)
                    if (eh <= sh) eh += 24

                    const left = Math.max(0, (sh - startHour) * HOUR_W)
                    const right = Math.min(hourCount * HOUR_W, (eh - startHour) * HOUR_W)
                    const width = right - left - 2
                    if (width <= 0) return null

                    const colorIdx = castIds.indexOf(shift.cast_id)
                    const color = CAST_COLORS[colorIdx >= 0 ? colorIdx % CAST_COLORS.length : 0]

                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => onShiftClick?.(shift.id)}
                        title={`${shift.cast?.display_name ?? '?'}  ${shift.start_time.slice(0, 5)}〜${shift.end_time.slice(0, 5)}`}
                        className={cn(
                          'absolute top-1.5 bottom-1.5 rounded text-white text-xs flex items-center px-1.5 overflow-hidden select-none text-left',
                          onShiftClick ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                          shift.status !== 'confirmed' && 'opacity-60',
                        )}
                        style={{ left, width, backgroundColor: color }}
                      >
                        <span className="truncate font-medium">{shift.cast?.display_name ?? '?'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {days.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">シフトがありません</div>
          )}
        </div>
      </div>
    </div>
  )
}
