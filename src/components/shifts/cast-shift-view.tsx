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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, FileEdit, CalendarDays, List } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { ShiftCalendar } from './shift-calendar'

type ShiftStatus = Database['public']['Enums']['shift_status']

interface Shift {
  id: string; date: string; start_time: string; end_time: string
  status: ShiftStatus; notes: string | null
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
}

function isPastDeadline(settings: Settings | null): boolean {
  if (!settings) return false
  const now = new Date()
  if (settings.deadline_type === 'monthly') {
    return now.getDate() > settings.deadline_day
  }
  return now.getDay() === settings.deadline_day
}

export function CastShiftView({ shifts: initialShifts, rooms, areas, castId, storeId, settings, userId }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const [open, setOpen] = useState(false)
  const [modOpen, setModOpen] = useState(false)
  const [editing, setEditing] = useState<Shift | null>(null)
  const [modTarget, setModTarget] = useState<Shift | null>(null)
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '' })
  const [modForm, setModForm] = useState({ new_date: '', new_start_time: '', new_end_time: '', reason: '' })
  const supabase = createClient()
  const pastDeadline = isPastDeadline(settings)
  const locationMode = settings?.location_mode ?? 'room'
  const areaLabel = settings?.area_label ?? 'エリア'
  const roomLabel = settings?.room_label ?? 'ルーム'
  const filteredRooms = locationMode === 'area_and_room' && form.area_id
    ? rooms.filter(r => r.area_id === form.area_id)
    : rooms

  function openNew() {
    setEditing(null)
    setForm({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '' })
    setOpen(true)
  }

  function openEdit(shift: Shift) {
    setEditing(shift)
    setForm({ date: shift.date, start_time: shift.start_time.slice(0, 5), end_time: shift.end_time.slice(0, 5), area_id: '', room_id: '', notes: shift.notes ?? '' })
    setOpen(true)
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
      setShifts([data, ...shifts])
      toast.success('シフトを提出しました')
    }
    setOpen(false)
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
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          title: 'シフト修正申請が届きました',
          body: `${format(new Date(modTarget.date), 'M/d(E)', { locale: ja })} のシフトへの修正申請`,
          link: '/admin/modification-requests',
        }))
      )
    }
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-none border-x-0 md:rounded-lg md:border-x">
        <CardHeader className="px-4 md:px-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>シフト管理</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border overflow-hidden">
                <button
                  onClick={() => setView('calendar')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors ${view === 'calendar' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <CalendarDays className="h-3.5 w-3.5" /> カレンダー
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm transition-colors border-l ${view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <List className="h-3.5 w-3.5" /> リスト
                </button>
              </div>
              {!pastDeadline && (
                <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />シフト提出</Button>
              )}
            </div>
          </div>
        </CardHeader>
        {pastDeadline && (
          <div className="px-4 md:px-6 pb-2">
            <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">締切を過ぎています。変更は修正申請から行ってください。</p>
          </div>
        )}
        <CardContent className="px-0 md:px-6">
          {view === 'calendar' && (
            <ShiftCalendar shifts={shifts} />
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
                      {!pastDeadline && ['draft', 'submitted'].includes(shift.status) && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(shift)}><Pencil className="h-3.5 w-3.5" /></Button>
                      )}
                      {pastDeadline && shift.status === 'confirmed' && settings?.require_approval_after_deadline && (
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
            <div className="space-y-1.5"><Label>申請理由 *</Label><Textarea value={modForm.reason} onChange={e => setModForm({ ...modForm, reason: e.target.value })} rows={3} /></div>
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
