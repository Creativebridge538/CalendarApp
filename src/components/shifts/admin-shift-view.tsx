'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format, addDays } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { TimeSelect, normalizeTime } from '@/components/ui/time-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { AlertCircle, Check, X, CalendarDays, List, GanttChart, StickyNote } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'
import { sendPushNotification } from '@/lib/push'
import { shiftConflictMessage } from '@/lib/shift-conflict'
import { usePagination } from '@/hooks/use-pagination'
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
  is_period_day: boolean
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
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し', modification_requested: '修正依頼中',
}
const STATUS_VARIANT: Record<ShiftStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline', submitted: 'secondary', confirmed: 'default', rejected: 'destructive', modification_requested: 'secondary',
}

export function AdminShiftView({ shifts: initialShifts, casts, rooms, areas, storeId, locationMode, areaLabel, roomLabel, checklistItems }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterCast, setFilterCast] = useState<string>('all')
  const [periodMode, setPeriodMode] = useState<'all' | 'day' | 'week'>('all')
  const [periodDate, setPeriodDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [view, setView] = useState<'calendar' | 'timeline' | 'list'>('list')
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null)
  const [detailShift, setDetailShift] = useState<Shift | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [scheduleForm, setScheduleForm] = useState({ date: '', start_time: '', end_time: '' })
  const supabase = createClient()
  function checklistBadges(answers: Record<string, boolean | string>) {
    return Object.entries(answers).map(([id, value]) => {
      const item = checklistItems.find(c => c.id === id)
      if (!item || !value) return null
      return item.item_type === 'select' ? `${item.label}: ${value}` : item.label
    }).filter((v): v is string => !!v)
  }

  const periodRange = useMemo(() => {
    if (periodMode === 'all') return null
    if (periodMode === 'day') return { from: periodDate, to: periodDate }
    // 週の始まりは月曜固定ではなく、選んだ日をそのまま開始日として+6日
    const anchor = new Date(`${periodDate}T00:00:00`)
    const to = format(addDays(anchor, 6), 'yyyy-MM-dd')
    return { from: periodDate, to }
  }, [periodMode, periodDate])

  const filtered = useMemo(() => shifts.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterCast !== 'all' && s.cast_id !== filterCast) return false
    if (periodRange && (s.date < periodRange.from || s.date > periodRange.to)) return false
    return true
  }), [shifts, filterStatus, filterCast, periodRange])

  // リスト表示は件数が多いと際限なく縦に伸びてしまうため、ページ単位で区切る
  const { page: listPage, setPage: setListPage, pageSize: listPageSize, setPageSize: setListPageSize, totalPages: listTotalPages, paged, totalItems: listTotalItems } = usePagination(filtered)

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

  function openDetail(shift: Shift) {
    setDetailShift(shift)
    setNoteInput(shift.admin_note ?? '')
    setScheduleForm({ date: shift.date, start_time: shift.start_time.slice(0, 5), end_time: shift.end_time.slice(0, 5) })
  }

  async function saveSchedule() {
    if (!detailShift) return
    const start_time = normalizeTime(scheduleForm.start_time)
    const end_time = normalizeTime(scheduleForm.end_time)
    const oldStart = detailShift.start_time.slice(0, 5)
    const oldEnd = detailShift.end_time.slice(0, 5)
    if (scheduleForm.date === detailShift.date && start_time === oldStart && end_time === oldEnd) return

    const { error } = await supabase.from('shifts').update({ date: scheduleForm.date, start_time, end_time }).eq('id', detailShift.id)
    if (error) { toast.error(shiftConflictMessage(error, '時間の変更に失敗しました')); return }

    const oldLabel = `${format(new Date(detailShift.date), 'M/d(E)', { locale: ja })} ${oldStart}〜${oldEnd}`
    const newLabel = `${format(new Date(scheduleForm.date), 'M/d(E)', { locale: ja })} ${start_time}〜${end_time}`
    const updated = { ...detailShift, date: scheduleForm.date, start_time, end_time }
    setShifts(shifts.map(s => s.id === detailShift.id ? updated : s))
    setDetailShift(updated)
    toast.success('シフトの日時を変更しました')

    const title = 'シフトの日時が変更されました'
    const body = `${oldLabel} から ${newLabel} に変更されました`
    await supabase.from('notifications').insert({ user_id: detailShift.cast_id, title, body, link: '/cast/shifts' })
    sendPushNotification(detailShift.cast_id, title, body, '/cast/shifts')
  }

  async function changeStatus(shift: Shift, status: ShiftStatus, note: string) {
    const update: { status: ShiftStatus; confirmed_at?: string; admin_note: string | null } = { status, admin_note: note || null }
    if (status === 'confirmed') update.confirmed_at = new Date().toISOString()
    const { error } = await supabase.from('shifts').update(update).eq('id', shift.id)
    if (error) {
      toast.error(shiftConflictMessage(error, '更新に失敗しました'))
      return
    }
    setShifts(shifts.map(s => s.id === shift.id ? { ...s, ...update } : s))
    toast.success(status === 'confirmed' ? 'シフトを確定しました' : '差し戻しました')
    setDetailShift(null)

    if (status !== shift.status) {
      const dateLabel = format(new Date(shift.date), 'M/d(E)', { locale: ja })
      const title = status === 'confirmed' ? 'シフトが確定されました' : 'シフトが差し戻されました'
      const body = `${dateLabel} ${shift.start_time.slice(0, 5)}〜${shift.end_time.slice(0, 5)} のシフト`
      await supabase.from('notifications').insert({ user_id: shift.cast_id, title, body, link: '/cast/shifts' })
      sendPushNotification(shift.cast_id, title, body, '/cast/shifts')
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
          <Select value={filterStatus} onValueChange={v => { if (v) { setFilterStatus(v); setListPage(1) } }}>
            <SelectTrigger className="w-36">
              <SelectValue>
                {{ all: '全ステータス', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し', draft: '下書き', modification_requested: '修正依頼中' }[filterStatus] ?? filterStatus}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全ステータス</SelectItem>
              <SelectItem value="submitted">提出済み</SelectItem>
              <SelectItem value="confirmed">確定</SelectItem>
              <SelectItem value="modification_requested">修正依頼中</SelectItem>
              <SelectItem value="rejected">差し戻し</SelectItem>
              <SelectItem value="draft">下書き</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCast} onValueChange={v => { if (v) { setFilterCast(v); setListPage(1) } }}>
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
          <Select value={periodMode} onValueChange={v => { if (v) { setPeriodMode(v as 'all' | 'day' | 'week'); setListPage(1) } }}>
            <SelectTrigger className="w-28">
              <SelectValue>{{ all: '全期間', day: '日で絞る', week: '週で絞る' }[periodMode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全期間</SelectItem>
              <SelectItem value="day">日で絞る</SelectItem>
              <SelectItem value="week">週で絞る</SelectItem>
            </SelectContent>
          </Select>
          {periodMode !== 'all' && (
            <Input
              type="date" className="w-40" value={periodDate}
              onChange={e => { if (e.target.value) { setPeriodDate(e.target.value); setListPage(1) } }}
            />
          )}
          {periodMode === 'week' && periodRange && (
            <span className="flex items-center text-xs text-muted-foreground">
              {format(new Date(`${periodRange.from}T00:00:00`), 'M/d(E)', { locale: ja })}
              〜{format(new Date(`${periodRange.to}T00:00:00`), 'M/d(E)', { locale: ja })}
            </span>
          )}
          {conflicts.size > 0 && (
            <div className="flex items-center gap-1 text-sm text-destructive ml-2">
              <AlertCircle className="h-4 w-4" />
              ルーム被り {conflicts.size} 件
            </div>
          )}
        </div>}
      </CardHeader>
      <CardContent className="px-0 md:px-6">
        {view === 'calendar' && (
          <ShiftCalendar shifts={filtered} showCastName={true} onDayClick={d => setDayDetailDate(format(d, 'yyyy-MM-dd'))} />
        )}
        {view === 'timeline' && (
          <ShiftTimeline
            shifts={shifts}
            areas={areas}
            rooms={rooms}
            locationMode={locationMode}
            areaLabel={areaLabel}
            roomLabel={roomLabel}
            onShiftClick={id => { const s = shifts.find(x => x.id === id); if (s) openDetail(s) }}
            onDayClick={setDayDetailDate}
          />
        )}
        {view === 'list' && (
          <>
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8">該当するシフトがありません</p>
            )}

            {/* モバイル: カードレイアウト */}
            <div className="md:hidden space-y-2">
              {paged.map((shift) => (
                <div
                  key={shift.id}
                  onClick={() => openDetail(shift)}
                  className={cn(
                    'rounded-lg border p-3 space-y-2 cursor-pointer active:bg-muted/40',
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
                      {conflicts.has(shift.id) && <AlertCircle className="h-3 w-3 text-destructive" />}
                    </span>
                  </div>
                  {checklistBadges(shift.checklist_answers).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {checklistBadges(shift.checklist_answers).map(label => (
                        <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>
                      ))}
                    </div>
                  )}
                  {shift.notes && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
                      <span><span className="text-[10px] text-muted-foreground/70">キャストの備考: </span>{shift.notes}</span>
                    </p>
                  )}
                  {shift.admin_note && (
                    <p className="text-xs text-muted-foreground flex items-start gap-1">
                      <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />{shift.admin_note}
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1 text-positive border-positive/30" disabled={shift.status === 'confirmed'}
                      onClick={e => { e.stopPropagation(); changeStatus(shift, 'confirmed', shift.admin_note ?? '') }}>
                      <Check className="h-3.5 w-3.5 mr-1" /> 確定
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30" disabled={shift.status === 'rejected'}
                      onClick={e => { e.stopPropagation(); changeStatus(shift, 'rejected', shift.admin_note ?? '') }}>
                      <X className="h-3.5 w-3.5 mr-1" /> 差し戻し
                    </Button>
                  </div>
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
                  <TableHead>備考</TableHead>
                  <TableHead>確認項目</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((shift) => (
                  <TableRow key={shift.id} className={cn('cursor-pointer', conflicts.has(shift.id) ? 'bg-destructive/10' : '')} onClick={() => openDetail(shift)}>
                    <TableCell className="font-medium">
                      {format(new Date(shift.date), 'M/d(E)', { locale: ja })}
                    </TableCell>
                    <TableCell>{shift.cast?.display_name ?? '—'}</TableCell>
                    <TableCell>{shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}</TableCell>
                    <TableCell>
                      {shift.rooms?.name ?? '—'}
                      {conflicts.has(shift.id) && <AlertCircle className="h-3.5 w-3.5 text-destructive inline ml-1" />}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground" title={shift.notes ?? undefined}>
                      {shift.notes ?? '—'}
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
                      <Button size="sm" variant="outline" className="text-positive border-positive/30" disabled={shift.status === 'confirmed'}
                        onClick={e => { e.stopPropagation(); changeStatus(shift, 'confirmed', shift.admin_note ?? '') }}>
                        <Check className="h-3.5 w-3.5 mr-1" /> 確定
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/30" disabled={shift.status === 'rejected'}
                        onClick={e => { e.stopPropagation(); changeStatus(shift, 'rejected', shift.admin_note ?? '') }}>
                        <X className="h-3.5 w-3.5 mr-1" /> 差し戻し
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Pagination
              page={listPage} totalPages={listTotalPages} pageSize={listPageSize} totalItems={listTotalItems}
              onPageChange={setListPage} onPageSizeChange={setListPageSize}
            />
          </>
        )}
      </CardContent>

      {/* カレンダー/タイムラインからの日別シフト一覧 */}
      <Dialog open={!!dayDetailDate} onOpenChange={open => { if (!open) setDayDetailDate(null) }}>
        <DialogContent variant="sheet" onDismiss={() => setDayDetailDate(null)}>
          <DialogHeader>
            <DialogTitle>
              {dayDetailDate && format(new Date(`${dayDetailDate}T00:00:00`), 'M月d日(E)', { locale: ja })} のシフト
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 mt-2 max-h-[60dvh] overflow-y-auto">
            {(dayDetailDate ? filtered.filter(s => s.date === dayDetailDate) : []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">この日のシフトはありません</p>
            )}
            {(dayDetailDate ? filtered.filter(s => s.date === dayDetailDate) : []).map(shift => (
              <button
                key={shift.id}
                type="button"
                onClick={() => { setDayDetailDate(null); openDetail(shift) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/40 transition-colors text-left border-b last:border-b-0"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{shift.cast?.display_name ?? '—'}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {shift.start_time.slice(0, 5)}〜{shift.end_time.slice(0, 5)}
                    {shift.rooms?.name && ` ・ ${shift.rooms.name}`}
                  </span>
                </span>
                <Badge variant={STATUS_VARIANT[shift.status]} className="shrink-0">{STATUS_LABEL[shift.status]}</Badge>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 個別シフトの詳細・確定/差し戻し */}
      <Dialog open={!!detailShift} onOpenChange={open => { if (!open) setDetailShift(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>シフト詳細</DialogTitle>
          </DialogHeader>
          {detailShift && (
            <div className="space-y-4 mt-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{detailShift.cast?.display_name ?? '—'}</p>
                <Badge variant={STATUS_VARIANT[detailShift.status]}>{STATUS_LABEL[detailShift.status]}</Badge>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">日時（変更するとキャストに通知されます）</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="date" className="w-40" value={scheduleForm.date} onChange={e => setScheduleForm({ ...scheduleForm, date: e.target.value })} />
                  <TimeSelect value={scheduleForm.start_time} onChange={v => setScheduleForm({ ...scheduleForm, start_time: v })} />
                  <span className="text-muted-foreground text-sm">〜</span>
                  <TimeSelect value={scheduleForm.end_time} onChange={v => setScheduleForm({ ...scheduleForm, end_time: v })} />
                  {(scheduleForm.date !== detailShift.date
                    || normalizeTime(scheduleForm.start_time) !== detailShift.start_time.slice(0, 5)
                    || normalizeTime(scheduleForm.end_time) !== detailShift.end_time.slice(0, 5)) && (
                    <Button size="sm" onClick={saveSchedule}>変更を保存</Button>
                  )}
                </div>
              </div>
              {detailShift.rooms?.name && (
                <p className="text-sm text-muted-foreground">ルーム: {detailShift.rooms.name}</p>
              )}
              {checklistBadges(detailShift.checklist_answers).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {checklistBadges(detailShift.checklist_answers).map(label => (
                    <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>
                  ))}
                </div>
              )}
              {detailShift.notes && (
                <div className="rounded-lg border p-2.5 text-sm">
                  <p className="text-[10px] font-semibold text-muted-foreground">キャストの備考</p>
                  <p className="mt-0.5">{detailShift.notes}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">管理者メモ（任意・管理者のみ閲覧できます）</label>
                <Textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={3} placeholder="例: 遅刻連絡あり、来月から時給改定など" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="text-destructive border-destructive/30" disabled={detailShift.status === 'rejected'}
                  onClick={() => changeStatus(detailShift, 'rejected', noteInput)}>
                  <X className="h-3.5 w-3.5 mr-1" /> 差し戻す
                </Button>
                <Button className="text-white bg-positive hover:bg-positive/90" disabled={detailShift.status === 'confirmed'}
                  onClick={() => changeStatus(detailShift, 'confirmed', noteInput)}>
                  <Check className="h-3.5 w-3.5 mr-1" /> 確定する
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
