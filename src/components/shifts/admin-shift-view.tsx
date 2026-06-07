'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, Check, X, CalendarDays, List, GanttChart } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'
import { ShiftCalendar } from './shift-calendar'
import { ShiftTimeline } from './shift-timeline'

type ShiftStatus = Database['public']['Enums']['shift_status']

interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  status: ShiftStatus
  notes: string | null
  cast_id: string
  area_id: string | null
  room_id: string | null
  cast: { display_name: string | null } | null
  rooms: { name: string } | null
}

interface Props {
  shifts: Shift[]
  casts: { id: string; display_name: string | null }[]
  rooms: { id: string; name: string; area_id: string | null }[]
  areas: { id: string; name: string }[]
  storeId: string
  locationMode: string
  areaLabel: string
  roomLabel: string
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し',
}
const STATUS_VARIANT: Record<ShiftStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline', submitted: 'secondary', confirmed: 'default', rejected: 'destructive',
}

export function AdminShiftView({ shifts: initialShifts, casts, rooms, areas, storeId, locationMode, areaLabel, roomLabel }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterCast, setFilterCast] = useState<string>('all')
  const [view, setView] = useState<'calendar' | 'timeline' | 'list'>('calendar')
  const supabase = createClient()

  const filtered = useMemo(() => shifts.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterCast !== 'all' && s.cast_id !== filterCast) return false
    return true
  }), [shifts, filterStatus, filterCast])

  const conflicts = useMemo(() => {
    const confirmed = shifts.filter(s => s.status === 'confirmed' && s.room_id)
    const ids = new Set<string>()
    for (let i = 0; i < confirmed.length; i++) {
      for (let j = i + 1; j < confirmed.length; j++) {
        const a = confirmed[i], b = confirmed[j]
        if (a.room_id !== b.room_id || a.date !== b.date) continue
        const overlap = a.start_time < b.end_time && b.start_time < a.end_time
        if (overlap) { ids.add(a.id); ids.add(b.id) }
      }
    }
    return ids
  }, [shifts])

  async function updateStatus(id: string, status: ShiftStatus) {
    const update: { status: ShiftStatus; confirmed_at?: string } = { status }
    if (status === 'confirmed') update.confirmed_at = new Date().toISOString()
    const { error } = await supabase.from('shifts').update(update).eq('id', id)
    if (error) { toast.error('更新に失敗しました'); return }
    const shift = shifts.find(s => s.id === id)
    setShifts(shifts.map(s => s.id === id ? { ...s, ...update } : s))
    toast.success(status === 'confirmed' ? 'シフトを確定しました' : '差し戻しました')
    if (shift) {
      const dateLabel = format(new Date(shift.date), 'M/d(E)', { locale: ja })
      await supabase.from('notifications').insert({
        user_id: shift.cast_id,
        title: status === 'confirmed' ? 'シフトが確定されました' : 'シフトが差し戻されました',
        body: `${dateLabel} ${shift.start_time.slice(0, 5)}〜${shift.end_time.slice(0, 5)} のシフト`,
        link: '/cast/shifts',
      })
    }
  }

  return (
    <Card className="rounded-none border-x-0 md:rounded-lg md:border-x">
      <CardHeader className="px-4 md:px-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>シフト管理</CardTitle>
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${view === 'calendar' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> カレンダー
            </button>
            <button
              onClick={() => setView('timeline')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'timeline' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <GanttChart className="h-3.5 w-3.5" /> タイムライン
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <List className="h-3.5 w-3.5" /> リスト
            </button>
          </div>
        </div>
        {view === 'list' && <div className="flex gap-2 mt-2 flex-wrap">
          <Select value={filterStatus} onValueChange={v => { if (v) setFilterStatus(v) }}>
            <SelectTrigger className="w-36">
              <SelectValue>
                {{ all: '全ステータス', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し', draft: '下書き' }[filterStatus] ?? filterStatus}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全ステータス</SelectItem>
              <SelectItem value="submitted">提出済み</SelectItem>
              <SelectItem value="confirmed">確定</SelectItem>
              <SelectItem value="rejected">差し戻し</SelectItem>
              <SelectItem value="draft">下書き</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCast} onValueChange={v => { if (v) setFilterCast(v) }}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {filterCast === 'all' ? '全キャスト' : (casts.find(c => c.id === filterCast)?.display_name ?? filterCast)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全キャスト</SelectItem>
              {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
            </SelectContent>
          </Select>
          {conflicts.size > 0 && (
            <div className="flex items-center gap-1 text-sm text-red-600 ml-2">
              <AlertCircle className="h-4 w-4" />
              ルーム被り {conflicts.size} 件
            </div>
          )}
        </div>}
      </CardHeader>
      <CardContent className="px-0 md:px-6">
        {view === 'calendar' && (
          <ShiftCalendar shifts={filtered} showCastName={true} />
        )}
        {view === 'timeline' && (
          <ShiftTimeline
            shifts={shifts}
            areas={areas}
            rooms={rooms}
            locationMode={locationMode}
            areaLabel={areaLabel}
            roomLabel={roomLabel}
          />
        )}
        {view === 'list' && (
          <>
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8">該当するシフトがありません</p>
            )}

            {/* モバイル: カードレイアウト */}
            <div className="md:hidden space-y-2">
              {filtered.map((shift) => (
                <div
                  key={shift.id}
                  className={cn(
                    'rounded-lg border p-3 space-y-2',
                    conflicts.has(shift.id) ? 'border-red-300 bg-red-50' : 'bg-white'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm">
                        {format(new Date(shift.date), 'M/d(E)', { locale: ja })}
                      </span>
                      <span className="font-medium text-sm truncate">{shift.cast?.display_name ?? '—'}</span>
                    </div>
                    <Badge variant={STATUS_VARIANT[shift.status]} className="shrink-0">
                      {STATUS_LABEL[shift.status]}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <span>{shift.start_time.slice(0, 5)}〜{shift.end_time.slice(0, 5)}</span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      {shift.rooms?.name ?? 'ルームなし'}
                      {conflicts.has(shift.id) && <AlertCircle className="h-3 w-3 text-red-500" />}
                    </span>
                  </div>
                  {shift.status === 'submitted' && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="flex-1 text-green-600 border-green-300"
                        onClick={() => updateStatus(shift.id, 'confirmed')}>
                        <Check className="h-3.5 w-3.5 mr-1" /> 確定
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-300"
                        onClick={() => updateStatus(shift.id, 'rejected')}>
                        <X className="h-3.5 w-3.5 mr-1" /> 差し戻し
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* デスクトップ: テーブル */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>キャスト</TableHead>
                  <TableHead>時間</TableHead>
                  <TableHead>ルーム</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((shift) => (
                  <TableRow key={shift.id} className={conflicts.has(shift.id) ? 'bg-red-50' : ''}>
                    <TableCell className="font-medium">
                      {format(new Date(shift.date), 'M/d(E)', { locale: ja })}
                    </TableCell>
                    <TableCell>{shift.cast?.display_name ?? '—'}</TableCell>
                    <TableCell>{shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}</TableCell>
                    <TableCell>
                      {shift.rooms?.name ?? '—'}
                      {conflicts.has(shift.id) && <AlertCircle className="h-3.5 w-3.5 text-red-500 inline ml-1" />}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[shift.status]}>{STATUS_LABEL[shift.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {shift.status === 'submitted' && (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600 border-green-300"
                            onClick={() => updateStatus(shift.id, 'confirmed')}>
                            <Check className="h-3.5 w-3.5 mr-1" /> 確定
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-300"
                            onClick={() => updateStatus(shift.id, 'rejected')}>
                            <X className="h-3.5 w-3.5 mr-1" /> 差し戻し
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
