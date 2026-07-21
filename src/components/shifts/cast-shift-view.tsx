'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format, isAfter } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, FileEdit, CalendarDays, List, Trash2, Copy, RefreshCw, Link2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { sendPushNotification } from '@/lib/push'
import { ShiftCalendar } from './shift-calendar'

type ShiftStatus = Database['public']['Enums']['shift_status']

type ChecklistAnswers = Record<string, boolean | string>

interface Shift {
  id: string; date: string; start_time: string; end_time: string
  status: ShiftStatus; notes: string | null
  checklist_answers: ChecklistAnswers
  room_id: string | null
  area_id: string | null
  rooms: { name: string } | null
  areas: { name: string } | null
}

interface Settings {
  deadline_type: string; deadline_day: number; require_approval_after_deadline: boolean
  location_mode: string; area_label: string; room_label: string
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し',
}
const STATUS_VARIANT: Record<ShiftStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline', submitted: 'secondary', confirmed: 'default', rejected: 'destructive',
}

interface Props {
  shifts: Shift[]
  rooms: { id: string; name: string; area_id: string | null }[]
  areas: { id: string; name: string }[]
  castId: string
  storeId: string
  settings: Settings | null
  userId: string
  checklistItems: { id: string; label: string; item_type: string; options: string[] }[]
  calendarToken: string | null
}

function isPastDeadline(settings: Settings | null): boolean {
  if (!settings || settings.deadline_type === 'none') return false
  const now = new Date()
  if (settings.deadline_type === 'monthly') {
    return now.getDate() > settings.deadline_day
  }
  // weekly: 月曜始まりで比較（日曜=7 に読み替え）
  const todayNum = now.getDay() === 0 ? 7 : now.getDay()
  const deadlineNum = settings.deadline_day === 0 ? 7 : settings.deadline_day
  return todayNum > deadlineNum
}

export function CastShiftView({ shifts: initialShifts, rooms, areas, castId, storeId, settings, userId, checklistItems, calendarToken: initialCalendarToken }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [calendarToken, setCalendarToken] = useState(initialCalendarToken)
  const [issuingToken, setIssuingToken] = useState(false)
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const [open, setOpen] = useState(false)
  const [modOpen, setModOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [modTarget, setModTarget] = useState<Shift | null>(null)
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', checklist_answers: {} as ChecklistAnswers })
  const [modForm, setModForm] = useState({ new_date: '', new_start_time: '', new_end_time: '', reason: '' })
  const supabase = createClient()
  const pastDeadline = isPastDeadline(settings)
  const locationMode = settings?.location_mode ?? 'room'
  const areaLabel = settings?.area_label ?? 'エリア'
  const roomLabel = settings?.room_label ?? 'ルーム'
  const filteredRooms = locationMode === 'area_and_room' && form.area_id
    ? rooms.filter(r => r.area_id === form.area_id)
    : rooms

  // 確定済みシフトは常に修正申請が必要。それ以外は締切前、または「締切後の承認必須」がOFFなら直接編集・取消可能
  function canEditDirectly(shift: Shift): boolean {
    if (shift.status === 'confirmed') return false
    if (!pastDeadline) return true
    return !settings?.require_approval_after_deadline
  }

  function canRequestModification(shift: Shift): boolean {
    if (canEditDirectly(shift)) return false
    if (shift.status === 'confirmed') return true
    return pastDeadline && !!settings?.require_approval_after_deadline
  }

  function openNew(date?: string) {
    setEditing(null)
    setForm({ date: date ?? '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', checklist_answers: {} })
    setOpen(true)
  }

  function openEdit(shift: Shift) {
    setEditing(shift)
    setForm({
      date: shift.date, start_time: shift.start_time.slice(0, 5), end_time: shift.end_time.slice(0, 5),
      area_id: shift.area_id ?? '', room_id: shift.room_id ?? '',
      notes: shift.notes ?? '', checklist_answers: shift.checklist_answers,
    })
    setOpen(true)
  }

  function handleDayClick(date: Date) {
    const key = format(date, 'yyyy-MM-dd')
    const dayShifts = shifts.filter(s => s.date === key)
    if (dayShifts.length === 0) {
      if (pastDeadline) { toast.error('締切を過ぎているため新規提出できません。修正申請をご利用ください'); return }
      openNew(key)
    } else if (dayShifts.length === 1) {
      const shift = dayShifts[0]
      if (canEditDirectly(shift)) openEdit(shift)
      else openModification(shift)
    } else {
      setView('list')
    }
  }

  function toggleChecklistItem(id: string) {
    setForm(f => {
      const next = { ...f.checklist_answers }
      if (next[id]) delete next[id]
      else next[id] = true
      return { ...f, checklist_answers: next }
    })
  }

  function setChecklistSelect(id: string, value: string) {
    setForm(f => {
      const next = { ...f.checklist_answers }
      if (value) next[id] = value
      else delete next[id]
      return { ...f, checklist_answers: next }
    })
  }

  function openModification(shift: Shift) {
    setModTarget(shift)
    setModForm({ new_date: shift.date, new_start_time: shift.start_time.slice(0, 5), new_end_time: shift.end_time.slice(0, 5), reason: '' })
    setModOpen(true)
  }

  async function handleSave() {
    const payload = {
      cast_id: castId,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      area_id: (locationMode === 'area_only' || locationMode === 'area_and_room') ? form.area_id || null : null,
      room_id: (locationMode === 'room' || locationMode === 'area_and_room') ? form.room_id || null : null,
      notes: form.notes || null,
      checklist_answers: form.checklist_answers,
      status: 'submitted' as ShiftStatus,
    }
    if (editing) {
      const { error } = await supabase.from('shifts').update(payload).eq('id', editing.id)
      if (error) { toast.error('更新に失敗しました'); return }
      setShifts(shifts.map(s => s.id === editing.id ? {
        ...s, ...payload,
        rooms: rooms.find(r => r.id === form.room_id) ?? null,
        areas: areas.find(a => a.id === form.area_id) ?? null,
      } : s))
      toast.success('シフトを更新しました')
    } else {
      const { data, error } = await supabase.from('shifts').insert({ ...payload, store_id: storeId }).select('*, rooms(name), areas(name)').single()
      if (error) { toast.error('提出に失敗しました'); return }
      setShifts([{ ...data, checklist_answers: (data.checklist_answers ?? {}) as ChecklistAnswers }, ...shifts])
      toast.success('シフトを提出しました')
    }
    setOpen(false)
  }

  async function handleCancel(shift: Shift) {
    if (!confirm(`${format(new Date(shift.date), 'M/d(E)', { locale: ja })} のシフトを取り消しますか？`)) return
    const { error } = await supabase.from('shifts').delete().eq('id', shift.id)
    if (error) { toast.error('取消に失敗しました'); return }
    setShifts(shifts.filter(s => s.id !== shift.id))
    toast.success('シフトを取り消しました')
  }

  async function handleModification() {
    if (!modTarget || !modForm.reason) { toast.error('理由を入力してください'); return }
    const { error } = await supabase.from('shift_modification_requests').insert({
      shift_id: modTarget.id, requested_by: userId,
      new_date: modForm.new_date || null, new_start_time: modForm.new_start_time || null, new_end_time: modForm.new_end_time || null,
      reason: modForm.reason,
    })
    if (error) { toast.error('申請に失敗しました'); return }
    toast.success('修正申請を送信しました')
    setModOpen(false)
    const { data: admins } = await supabase.from('users').select('id').eq('store_id', storeId).eq('role', 'admin')
    if (admins?.length) {
      const title = 'シフト修正申請が届きました'
      const body = `${format(new Date(modTarget.date), 'M/d(E)', { locale: ja })} のシフトへの修正申請`
      await supabase.from('notifications').insert(
        admins.map(a => ({ user_id: a.id, title, body, link: '/admin/modification-requests' }))
      )
      admins.forEach(a => sendPushNotification(a.id, title, body, '/admin/modification-requests'))
    }
  }

  async function issueCalendarToken() {
    setIssuingToken(true)
    try {
      const token = crypto.randomUUID()
      const { error } = await supabase.from('users').update({ calendar_token: token }).eq('id', userId)
      if (error) { toast.error('URLの発行に失敗しました'); return }
      setCalendarToken(token)
      toast.success('カレンダー連携URLを発行しました')
    } finally {
      setIssuingToken(false)
    }
  }

  async function copyCalendarUrl() {
    if (!calendarToken) return
    const url = `${window.location.origin}/api/calendar/${calendarToken}`
    await navigator.clipboard.writeText(url)
    toast.success('URLをコピーしました')
  }

  return (
    <div className="space-y-3">
      <Card size="sm" className="rounded-none border-x-0 md:rounded-lg md:border-x">
        <CardHeader className="px-4 md:px-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>シフト管理</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setView('calendar')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${view === 'calendar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <CalendarDays className="h-3.5 w-3.5" /> カレンダー
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  <List className="h-3.5 w-3.5" /> リスト
                </button>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}><Link2 className="h-3.5 w-3.5 mr-1" />連携</Button>
              {!pastDeadline && (
                <Button size="sm" onClick={() => openNew()}><Plus className="h-4 w-4 mr-1" />シフト提出</Button>
              )}
            </div>
          </div>
        </CardHeader>
        {pastDeadline && settings?.require_approval_after_deadline && (
          <div className="px-4 md:px-6 pb-2">
            <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">締切を過ぎています。変更・取消は修正申請から行ってください。</p>
          </div>
        )}
        <CardContent className="px-0 md:px-6">
          {view === 'calendar' && (
            <>
              <ShiftCalendar shifts={shifts} onDayClick={handleDayClick} />
              <p className="text-xs text-muted-foreground text-center mt-2 px-4 md:px-0">日付をタップしてシフトを提出・編集できます</p>
            </>
          )}
          {view === 'list' && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日付</TableHead>
                  <TableHead>時間</TableHead>
                  {locationMode !== 'none' && <TableHead>場所</TableHead>}
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.length === 0 && (
                  <TableRow><TableCell colSpan={locationMode !== 'none' ? 5 : 4} className="text-center text-muted-foreground py-8">シフトがありません</TableCell></TableRow>
                )}
                {shifts.map(shift => (
                  <TableRow key={shift.id}>
                    <TableCell>{format(new Date(shift.date), 'M/d(E)', { locale: ja })}</TableCell>
                    <TableCell>{shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}</TableCell>
                    {locationMode !== 'none' && (
                      <TableCell>
                        {locationMode === 'area_only' && (shift.areas?.name ?? '—')}
                        {locationMode === 'room' && (shift.rooms?.name ?? '—')}
                        {locationMode === 'area_and_room' && [shift.areas?.name, shift.rooms?.name].filter(Boolean).join(' / ') || '—'}
                      </TableCell>
                    )}
                    <TableCell><Badge variant={STATUS_VARIANT[shift.status]}>{STATUS_LABEL[shift.status]}</Badge></TableCell>
                    <TableCell className="text-right space-x-1">
                      {canEditDirectly(shift) && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(shift)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => handleCancel(shift)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      )}
                      {canRequestModification(shift) && (
                        <Button size="sm" variant="outline" onClick={() => openModification(shift)}>
                          <FileEdit className="h-3.5 w-3.5 mr-1" />修正申請
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>カレンダー連携</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <p className="text-xs text-muted-foreground">
              専用URLを発行すると、GoogleカレンダーやTimeTreeの「外部カレンダーを購読」機能でシフトを自動的に取り込めます（提出済み・確定済みのシフトが対象）。
            </p>
            {calendarToken ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar/${calendarToken}`} className="text-xs" />
                  <Button size="icon" variant="outline" onClick={copyCalendarUrl}><Copy className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>Googleカレンダー: 「他のカレンダー」→「URLで追加」</span>
                  <span>／</span>
                  <span>TimeTree: 「カレンダーを読み込む」からこのURLを登録</span>
                </div>
                <Button size="sm" variant="outline" onClick={issueCalendarToken} disabled={issuingToken}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />URLを再発行（旧URLは無効になります）
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={issueCalendarToken} disabled={issuingToken}>
                {issuingToken ? '発行中...' : 'URLを発行'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'シフト編集' : 'シフト提出'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>日付 *</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>開始時間</Label><Input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>終了時間</Label><Input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></div>
            </div>
            {(locationMode === 'area_only' || locationMode === 'area_and_room') && areas.length > 0 && (
              <div className="space-y-1.5">
                <Label>{areaLabel}</Label>
                <Select value={form.area_id || 'none'} onValueChange={v => setForm({ ...form, area_id: v === 'none' ? '' : (v ?? ''), room_id: '' })}>
                  <SelectTrigger>
                    <SelectValue placeholder={`${areaLabel}を選択`}>
                      {form.area_id ? (areas.find(a => a.id === form.area_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(locationMode === 'room' || (locationMode === 'area_and_room' && form.area_id)) && filteredRooms.length > 0 && (
              <div className="space-y-1.5">
                <Label>{roomLabel}</Label>
                <Select value={form.room_id || 'none'} onValueChange={v => setForm({ ...form, room_id: v === 'none' ? '' : (v ?? '') })}>
                  <SelectTrigger>
                    <SelectValue placeholder={`${roomLabel}を選択（任意）`}>
                      {form.room_id ? (filteredRooms.find(r => r.id === form.room_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {filteredRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5"><Label>備考</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
            {checklistItems.length > 0 && (
              <div className="space-y-3">
                <Label>確認項目</Label>
                {checklistItems.map(item => (
                  item.item_type === 'select' ? (
                    <div key={item.id} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">{item.label}</Label>
                      <Select
                        value={(form.checklist_answers[item.id] as string) || 'none'}
                        onValueChange={v => setChecklistSelect(item.id, v === 'none' ? '' : (v ?? ''))}
                      >
                        <SelectTrigger>
                          <SelectValue>{(form.checklist_answers[item.id] as string) || '未選択'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未選択</SelectItem>
                          {item.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={!!form.checklist_answers[item.id]}
                        onCheckedChange={() => toggleChecklistItem(item.id)}
                      />
                      {item.label}
                    </label>
                  )
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button onClick={handleSave} disabled={!form.date}>提出</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modOpen} onOpenChange={setModOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修正申請</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>変更後の日付</Label><Input type="date" value={modForm.new_date} onChange={e => setModForm({ ...modForm, new_date: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>開始時間</Label><Input type="time" value={modForm.new_start_time} onChange={e => setModForm({ ...modForm, new_start_time: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>終了時間</Label><Input type="time" value={modForm.new_end_time} onChange={e => setModForm({ ...modForm, new_end_time: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>申請理由 *</Label>
              <Textarea
                value={modForm.reason}
                onChange={e => setModForm({ ...modForm, reason: e.target.value })}
                rows={3}
                placeholder="例: 体調不良のため出勤をキャンセルしたいです／開始時間を19時に変更したいです"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModOpen(false)}>キャンセル</Button>
              <Button onClick={handleModification} disabled={!modForm.reason}>申請する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
