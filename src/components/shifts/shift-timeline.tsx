'use client'

import { useMemo, useState } from 'react'
import { eachDayOfInterval, format, addDays, startOfWeek } from 'date-fns'
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
  /** 1日あたりの重なり表示の上限を超えた分がある日に呼ばれる（「+N」クリック時、その日の一覧を別途表示するため） */
  onDayClick?: (dateStr: string) => void
}

const HOUR_W = 72
const DATE_W = 76
const HEADER_H = 32
// 同じ時間帯に重なるシフトは、この段数までを横並びのレーンで表示し、それ以上は「+N」にまとめる
// （量が増えても行の高さを一定に保つため。月表示の「3件まで表示+あとは…」と同じ考え方）
const MAX_LANES = 3
const LANE_H = 22
const LANE_GAP = 2
const ROW_PAD = 4
const ROW_H = ROW_PAD * 2 + MAX_LANES * LANE_H + (MAX_LANES - 1) * LANE_GAP

// カレンダー表示と同じ配色（ステータスの意味を画面間で揃える）
const STATUS_COLOR: Record<ShiftStatus, string> = {
  draft: 'var(--status-draft)',
  submitted: 'var(--status-submitted)',
  confirmed: 'var(--status-confirmed)',
  rejected: 'var(--status-rejected)',
  modification_requested: 'var(--status-modification-requested)',
}
const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し', modification_requested: '修正依頼中',
}

function timeToHours(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

/** 開始時刻順に並べ、空いている最も早いレーンへ詰めていく（レーンが埋まっていればoverflowへ） */
function layoutLanes(dayShifts: TimelineShift[]) {
  const sorted = [...dayShifts].sort((a, b) => timeToHours(a.start_time) - timeToHours(b.start_time))
  const laneEndHours: number[] = []
  const placed: { shift: TimelineShift; lane: number }[] = []
  let overflowCount = 0
  for (const shift of sorted) {
    const sh = timeToHours(shift.start_time)
    let eh = timeToHours(shift.end_time)
    if (eh <= sh) eh += 24
    let lane = laneEndHours.findIndex(end => end <= sh)
    if (lane === -1) {
      if (laneEndHours.length >= MAX_LANES) { overflowCount++; continue }
      lane = laneEndHours.length
      laneEndHours.push(eh)
    } else {
      laneEndHours[lane] = eh
    }
    placed.push({ shift, lane })
  }
  return { placed, overflowCount }
}

export function ShiftTimeline({ shifts, areas, rooms, locationMode, areaLabel, roomLabel, onShiftClick, onDayClick }: Props) {
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

  const [startDate, setStartDate] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }))

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

  const totalWidth = DATE_W + hourCount * HOUR_W

  return (
    <div className="flex flex-col">
      {tabs.length > 0 && (
        <div className="flex border-b overflow-x-auto overflow-y-clip shrink-0 bg-card">
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
            const { placed, overflowCount } = layoutLanes(dayShifts)

            return (
              <div
                key={dateStr}
                className={cn('flex border-b', isWeekend ? 'bg-muted/40' : 'bg-card')}
                style={{ height: ROW_H }}
              >
                <div
                  className={cn(
                    'shrink-0 sticky left-0 z-10 border-r flex flex-col items-center justify-center gap-0.5',
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
                  {overflowCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onDayClick?.(dateStr)}
                      className="text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-muted-foreground/15 text-muted-foreground hover:bg-muted-foreground/25 transition-colors"
                    >
                      +{overflowCount}
                    </button>
                  )}
                </div>

                <div className="relative flex-1">
                  {hours.map(h => (
                    <div
                      key={h}
                      className="absolute top-0 bottom-0 border-r border-border"
                      style={{ left: (h - startHour) * HOUR_W, width: HOUR_W }}
                    />
                  ))}

                  {placed.map(({ shift, lane }) => {
                    const sh = timeToHours(shift.start_time)
                    let eh = timeToHours(shift.end_time)
                    if (eh <= sh) eh += 24

                    const left = Math.max(0, (sh - startHour) * HOUR_W)
                    const right = Math.min(hourCount * HOUR_W, (eh - startHour) * HOUR_W)
                    const width = right - left - 2
                    if (width <= 0) return null
                    const top = ROW_PAD + lane * (LANE_H + LANE_GAP)

                    return (
                      <button
                        key={shift.id}
                        type="button"
                        onClick={() => onShiftClick?.(shift.id)}
                        title={`${shift.cast?.display_name ?? '?'}  ${shift.start_time.slice(0, 5)}〜${shift.end_time.slice(0, 5)} ${STATUS_LABEL[shift.status]}`}
                        className={cn(
                          'absolute rounded text-white text-xs flex items-center px-1.5 overflow-hidden select-none text-left',
                          onShiftClick ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                        )}
                        style={{ left, width, top, height: LANE_H, backgroundColor: STATUS_COLOR[shift.status] }}
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
