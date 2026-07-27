'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle, Check, X, CalendarDays, List, GanttChart, StickyNote } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'
import { sendPushNotification } from '@/lib/push'
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
  admin_note: string | null
  cast_id: string
  area_id: string | null
  room_id: string | null
  checklist_answers: Record<string, boolean | string>
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
  checklistItems: { id: string; label: string; item_type: string }[]
  periodDates?: Set<string>
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し',
}
const STATUS_VARIANT: Record<ShiftStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline', submitted: 'secondary', confirmed: 'default', rejected: 'destructive',
}

export function AdminShiftView({ shifts: initialShifts, casts, rooms, areas, storeId, locationMode, areaLabel, roomLabel, checklistItems, periodDates }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterCast, setFilterCast] = useState<string>('all')
  const [view, setView] = useState<'calendar' | 'timeline' | 'list'>('calendar')
  const [statusDialog, setStatusDialog] = useState<{ shift: Shift; status: ShiftStatus } | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const supabase = createClient()
  function checklistBadges(answers: Record<string, boolean | string>) {
    return Object.entries(answers).map(([id, value]) => {
      const item = checklistItems.find(c => c.id === id)
      if (!item || !value) return null
      return item.item_type === 'select' ? `${item.label}: ${value}` : item.label
    }).filter((v): v is string => !!v)
  }

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

  function openStatusDialog(shift: Shift, status: ShiftStatus) {
    setStatusDialog({ shift, status })
    setNoteInput(shift.admin_note ?? '')
  }

  async function confirmStatusChange() {
    if (!statusDialog) return
    const { shift, status } = statusDialog
    const update: { status: ShiftStatus; confirmed_at?: string; admin_note: string | null } = { status, admin_note: noteInput || null }
    if (status === 'confirmed') update.confirmed_at = new Date().toISOString()
    const { error } = await supabase.from('shifts').update(update).eq('id', shift.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...update } : s))
    toast.success(status === 'confirmed' ? 'シフトを確定しました' : '差し戻しました')
    setStatusDialog(null)

    const dateLabel = format(new Date(shift.date), 'M/d(E)', { locale: ja })
    const title = status === 'confirmed' ? 'シフトが確定されました' : 'シフトが差し戻されました'
    const body = `${dateLabel} ${shift.start_time.slice(0, 5)}〜${shift.end_time.slice(0, 5)} のシフト`
    await supabase.from('notifications').insert({ user_id: shift.cast_id, title, body, link: '/cast/shifts' })
    sendPushNotification(shift.cast_id, title, body, '/cast/shifts')
  }

  return (
    <Card className="rounded-none border-x-0 md:rounded-lg md:border-x">
      <CardHeader className="px-4 md:px-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>シフト管理</CardTitle>
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${view === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> カレンダー
            </button>
            <button
              onClick={() => setView('timeline')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'timeline' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <GanttChart className="h-3.5 w-3.5" /> タイムライン
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
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
          <ShiftCalendar shifts={filtered} showCastName={true} periodDates={periodDates} />
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
                    conflicts.has(shift.id) ? 'border-destructive/40 bg-destructive/10' : 'bg-card'
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
                  {checklistBadges(shift.checklist_answers).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {checklistBadges(shift.checklist_answers).map(label => (
                        <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>
                      ))}
                    </div>
                  )}
                  {shift.admin_note && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />{shift.admin_note}
                    </p>
                  )}
                  {shift.status === 'submitted' && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="flex-1 text-green-600 border-green-300"
                        onClick={() => openStatusDialog(shift, 'confirmed')}>
                        <Check className="h-3.5 w-3.5 mr-1" /> 確定
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 text-red-600 border-red-300"
                        onClick={() => openStatusDialog(shift, 'rejected')}>
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
                  <TableHead>確認項目</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((shift) => (
                  <TableRow key={shift.id} className={conflicts.has(shift.id) ? 'bg-destructive/10' : ''}>
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
                      <div className="flex flex-wrap gap-1">
                        {checklistBadges(shift.checklist_answers).map(label => (
                          <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant={STATUS_VARIANT[shift.status]}>{STATUS_LABEL[shift.status]}</Badge>
                        {shift.admin_note && (
                          <span title={shift.admin_note}>
                            <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {shift.status === 'submitted' && (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600 border-green-300"
                            onClick={() => openStatusDialog(shift, 'confirmed')}>
                            <Check className="h-3.5 w-3.5 mr-1" /> 確定
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-300"
                            onClick={() => openStatusDialog(shift, 'rejected')}>
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

      <Dialog open={!!statusDialog} onOpenChange={open => { if (!open) setStatusDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{statusDialog?.status === 'confirmed' ? 'シフトを確定' : 'シフトを差し戻し'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {statusDialog && (
              <p className="text-sm text-muted-foreground">
                {statusDialog.shift.cast?.display_name ?? '—'} ／ {format(new Date(statusDialog.shift.date), 'M/d(E)', { locale: ja })} {statusDialog.shift.start_time.slice(0, 5)}〜{statusDialog.shift.end_time.slice(0, 5)}
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">メモ（任意・管理者のみ閲覧できます）</label>
              <Textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={3} placeholder="例: 遅刻連絡あり、来月から時給改定など" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStatusDialog(null)}>キャンセル</Button>
              <Button onClick={confirmStatusChange}>
                {statusDialog?.status === 'confirmed' ? '確定する' : '差し戻す'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
