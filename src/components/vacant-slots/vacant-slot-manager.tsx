'use client'

import { Fragment, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { addDays, format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { Switch } from '@/components/ui/switch'
import { TimeSelect } from '@/components/ui/time-select'
import { ShiftCalendar } from '@/components/shifts/shift-calendar'
import { Plus, Check, X, ChevronDown, Trash2 } from 'lucide-react'
import { sendPushNotification } from '@/lib/push'
import { shiftConflictMessage } from '@/lib/shift-conflict'
import { usePagination } from '@/hooks/use-pagination'

interface Application { id: string; status: string; cast_id: string; shift_id: string | null; cast: { display_name: string | null } | null }
interface Slot {
  id: string; date: string; start_time: string; end_time: string; notes: string | null; is_published: boolean
  room_id: string | null; capacity: number
  rooms: { name: string } | null
  vacant_slot_applications: Application[]
}

interface Props {
  slots: Slot[]
  rooms: { id: string; name: string }[]
  storeId: string
  userId: string
}

export function VacantSlotManager({ slots: initialSlots, rooms, storeId, userId }: Props) {
  const [slots, setSlots] = useState(initialSlots)
  const [open, setOpen] = useState(false)
  const [dateCalendarOpen, setDateCalendarOpen] = useState(false)
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', room_id: '', notes: '', capacity: '1' })
  const supabase = createClient()
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(slots)

  async function handleCreate() {
    const capacity = Math.max(1, parseInt(form.capacity) || 1)
    const { data, error } = await supabase.from('vacant_slots').insert({
      store_id: storeId, created_by: userId,
      date: form.date, start_time: form.start_time, end_time: form.end_time,
      room_id: form.room_id || null, notes: form.notes || null, is_published: true, capacity,
    }).select('*, rooms(name), vacant_slot_applications(id, status, cast_id, shift_id, cast:users!vacant_slot_applications_cast_id_fkey(display_name))').single()
    if (error) { toast.error('登録に失敗しました'); return }
    setSlots([data, ...slots])
    toast.success('空き枠を登録しました')
    setOpen(false)
    setForm({ date: '', start_time: '18:00', end_time: '23:00', room_id: '', notes: '', capacity: '1' })
  }

  async function updateCapacity(slot: Slot, capacity: number) {
    if (capacity === slot.capacity || capacity < 1) return
    const { error } = await supabase.from('vacant_slots').update({ capacity }).eq('id', slot.id)
    if (error) { toast.error('募集人数の更新に失敗しました'); return }
    setSlots(slots.map(s => s.id === slot.id ? { ...s, capacity } : s))
  }

  async function togglePublish(slot: Slot) {
    const nextPublished = !slot.is_published
    const { error } = await supabase.from('vacant_slots').update({ is_published: nextPublished }).eq('id', slot.id)
    if (error) { toast.error('更新に失敗しました'); return }

    let apps = slot.vacant_slot_applications
    if (!nextPublished) {
      // 非公開にする: 保留中・承認済みの申請に紐づく仮予定シフトを一時的に消す（申請自体は残す）
      const activeShiftIds = apps.filter(a => (a.status === 'pending' || a.status === 'approved') && a.shift_id).map(a => a.shift_id!)
      if (activeShiftIds.length > 0) {
        await supabase.from('shifts').delete().in('id', activeShiftIds)
      }
      apps = apps.map(a => (a.status === 'pending' || a.status === 'approved') ? { ...a, shift_id: null } : a)
    } else {
      // 公開に戻す: 非公開時に消えた仮予定シフトを、同じ内容で作り直す
      const appsNeedingShift = apps.filter(a => (a.status === 'pending' || a.status === 'approved') && !a.shift_id)
      const restoredShiftIds: Record<string, string> = {}
      let restoreFailed = false
      for (const a of appsNeedingShift) {
        const { data: newShift, error: shiftErr } = await supabase.from('shifts').insert({
          cast_id: a.cast_id, store_id: storeId, room_id: slot.room_id ?? null,
          date: slot.date, start_time: slot.start_time, end_time: slot.end_time,
          status: a.status === 'approved' ? 'confirmed' : 'submitted',
        }).select('id').single()
        if (shiftErr || !newShift) { restoreFailed = true; continue }
        restoredShiftIds[a.id] = newShift.id
        await supabase.from('vacant_slot_applications').update({ shift_id: newShift.id }).eq('id', a.id)
      }
      if (restoreFailed) toast.error('一部の仮予定は時間帯が重複しているため復元できませんでした')
      apps = apps.map(a => restoredShiftIds[a.id] ? { ...a, shift_id: restoredShiftIds[a.id] } : a)
    }

    setSlots(slots.map(s => s.id === slot.id ? { ...s, is_published: nextPublished, vacant_slot_applications: apps } : s))
    toast.success(nextPublished ? '公開しました' : '非公開にしました')
  }

  async function deleteSlot(slot: Slot) {
    if (!confirm('この空き枠を削除しますか？申請中の仮予定もあわせて削除されます。')) return
    // 承認待ちの申請に紐づく仮予定（提出済みシフト）は空き枠と一緒に消す
    const pendingShiftIds = slot.vacant_slot_applications
      .filter(a => a.status === 'pending' && a.shift_id)
      .map(a => a.shift_id!)
    if (pendingShiftIds.length > 0) {
      await supabase.from('shifts').delete().in('id', pendingShiftIds)
    }
    const { error } = await supabase.from('vacant_slots').delete().eq('id', slot.id)
    if (error) { toast.error('削除に失敗しました'); return }
    setSlots(slots.filter(s => s.id !== slot.id))
    toast.success('空き枠を削除しました')
  }

  // 店舗設定でシフトの直接確定は同じルームの重複を許可できるようにしたが、
  // 空き枠の承認だけは設定に関わらず常に重複を禁止したいため、アプリ側で個別にチェックする
  async function hasRoomConflict(roomId: string, date: string, startTime: string, endTime: string, excludeShiftId?: string) {
    const prevDay = format(addDays(new Date(`${date}T00:00:00`), -1), 'yyyy-MM-dd')
    const nextDay = format(addDays(new Date(`${date}T00:00:00`), 1), 'yyyy-MM-dd')
    let query = supabase.from('shifts').select('id, date, start_time, end_time')
      .eq('store_id', storeId).eq('room_id', roomId).eq('status', 'confirmed')
      .gte('date', prevDay).lte('date', nextDay)
    if (excludeShiftId) query = query.neq('id', excludeShiftId)
    const { data } = await query
    if (!data) return false

    const toRange = (d: string, s: string, e: string) => {
      const start = new Date(`${d}T${s}`)
      let end = new Date(`${d}T${e}`)
      if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
      return [start.getTime(), end.getTime()] as const
    }
    const [newStart, newEnd] = toRange(date, startTime, endTime)
    return data.some(s => {
      const [start, end] = toRange(s.date, s.start_time.slice(0, 5), s.end_time.slice(0, 5))
      return newStart < end && start < newEnd
    })
  }

  async function handleApplication(appId: string, slotId: string, castId: string, nextStatus: 'approved' | 'rejected' | 'pending') {
    const slot = slots.find(s => s.id === slotId)
    const app = slot?.vacant_slot_applications.find(a => a.id === appId)

    if (nextStatus === 'approved' && slot) {
      const approvedCount = slot.vacant_slot_applications.filter(a => a.status === 'approved').length
      if (approvedCount >= slot.capacity) { toast.error(`募集人数（${slot.capacity}人）に達しています`); return }
      if (slot.room_id) {
        const conflict = await hasRoomConflict(slot.room_id, slot.date, slot.start_time, slot.end_time, app?.shift_id ?? undefined)
        if (conflict) { toast.error('この時間帯は同じルームに既に確定シフトがあります'); return }
      }
    }

    const updates: { status: 'approved' | 'rejected' | 'pending'; reviewed_at: string | null } =
      { status: nextStatus, reviewed_at: nextStatus === 'pending' ? null : new Date().toISOString() }
    const { error: e1 } = await supabase.from('vacant_slot_applications').update(updates).eq('id', appId)
    if (e1) { toast.error('処理に失敗しました'); return }

    if (nextStatus === 'approved') {
      const { error: e2 } = app?.shift_id
        // 申請時に作成済みの仮予定（提出済み）を確定に切り替える
        ? await supabase.from('shifts').update({ status: 'confirmed' }).eq('id', app.shift_id)
        : slot
        ? await supabase.from('shifts').insert({
            cast_id: castId, store_id: storeId, room_id: slot.room_id ?? null,
            date: slot.date, start_time: slot.start_time, end_time: slot.end_time, status: 'confirmed',
          })
        : { error: null }
      if (e2) {
        toast.error(shiftConflictMessage(e2, '承認に失敗しました'))
        return
      }
    } else if (nextStatus === 'rejected' && app?.shift_id) {
      await supabase.from('shifts').delete().eq('id', app.shift_id)
    } else if (nextStatus === 'pending' && app?.shift_id) {
      // 承認取消: 確定済みの仮予定を、キャストが再提出したのと同じ「提出済み」の状態に戻す
      await supabase.from('shifts').update({ status: 'submitted' }).eq('id', app.shift_id)
    }
    setSlots(slots.map(s => s.id === slotId ? {
      ...s,
      vacant_slot_applications: s.vacant_slot_applications.map(a => a.id === appId ? { ...a, status: nextStatus } : a),
    } : s))
    toast.success(nextStatus === 'approved' ? '承認しました' : nextStatus === 'rejected' ? '却下しました' : '承認を取り消しました')

    if (slot && nextStatus !== 'pending') {
      const title = nextStatus === 'approved' ? '空き枠申請が承認されました' : '空き枠申請が却下されました'
      const body = `${format(new Date(slot.date), 'M/d(E)', { locale: ja })} ${slot.start_time.slice(0, 5)}〜${slot.end_time.slice(0, 5)} の空き枠`
      await supabase.from('notifications').insert({ user_id: castId, title, body, link: '/cast/vacant-slots' })
      sendPushNotification(castId, title, body, '/cast/vacant-slots')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>空き枠管理</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />空き枠追加</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>時間</TableHead>
              <TableHead>ルーム</TableHead>
              <TableHead>定員</TableHead>
              <TableHead>公開</TableHead>
              <TableHead>申請</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">空き枠がありません</TableCell></TableRow>
            )}
            {paged.map(slot => {
              const approvedCount = slot.vacant_slot_applications.filter(a => a.status === 'approved').length
              const isFull = approvedCount >= slot.capacity
              return (
              <Fragment key={slot.id}>
                <TableRow>
                  <TableCell>{format(new Date(slot.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</TableCell>
                  <TableCell>{slot.rooms?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Input
                      key={slot.capacity} type="number" min="1" defaultValue={slot.capacity}
                      className="w-16 h-8"
                      onBlur={e => updateCapacity(slot, Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={slot.is_published} onCheckedChange={() => togglePublish(slot)} />
                  </TableCell>
                  <TableCell className="space-x-1">
                    <Badge variant={isFull ? 'default' : 'outline'}>承認 {approvedCount}/{slot.capacity}</Badge>
                    {slot.vacant_slot_applications.filter(a => a.status === 'pending').length > 0 && (
                      <Badge variant="outline">{slot.vacant_slot_applications.filter(a => a.status === 'pending').length} 件待ち</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => deleteSlot(slot)} aria-label="削除">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
                {slot.vacant_slot_applications.map(app => (
                  <TableRow key={app.id} className={app.status === 'pending' ? 'bg-primary/10' : ''}>
                    <TableCell colSpan={3} className="pl-8 text-sm">
                      申請: {app.cast?.display_name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={app.status === 'approved' ? 'default' : app.status === 'rejected' ? 'destructive' : 'outline'}>
                        {app.status === 'approved' ? '承認済み' : app.status === 'rejected' ? '却下' : '保留中'}
                      </Badge>
                    </TableCell>
                    <TableCell colSpan={2} className="text-right space-x-1">
                      {app.status !== 'approved' && (
                        <Button size="sm" variant="outline" className="text-positive h-7" disabled={app.status === 'pending' && isFull}
                          onClick={() => handleApplication(app.id, slot.id, app.cast_id, 'approved')}>
                          <Check className="h-3 w-3 mr-1" />承認
                        </Button>
                      )}
                      {app.status === 'approved' && (
                        <Button size="sm" variant="outline" className="h-7"
                          onClick={() => handleApplication(app.id, slot.id, app.cast_id, 'pending')}>
                          承認を取消
                        </Button>
                      )}
                      {app.status !== 'rejected' && (
                        <Button size="sm" variant="destructive" className="h-7"
                          onClick={() => handleApplication(app.id, slot.id, app.cast_id, 'rejected')}>
                          <X className="h-3 w-3 mr-1" />却下
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
              )
            })}
          </TableBody>
        </Table>
        <Pagination
          page={page} totalPages={totalPages} pageSize={pageSize} totalItems={totalItems}
          onPageChange={setPage} onPageSizeChange={setPageSize}
        />
      </CardContent>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setDateCalendarOpen(false) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>空き枠追加</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>日付 *</Label>
              <button
                type="button"
                onClick={() => setDateCalendarOpen(o => !o)}
                className="w-full flex items-center justify-between rounded-md border bg-background px-3 min-h-11 text-sm"
              >
                {form.date ? format(new Date(`${form.date}T00:00:00`), 'yyyy年M月d日(E)', { locale: ja }) : '日付を選択'}
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${dateCalendarOpen ? 'rotate-180' : ''}`} />
              </button>
              {dateCalendarOpen && (
                <div className="rounded-md border p-2">
                  <ShiftCalendar
                    shifts={[]}
                    selectedDates={form.date ? new Set([form.date]) : undefined}
                    onDayClick={d => { setForm({ ...form, date: format(d, 'yyyy-MM-dd') }); setDateCalendarOpen(false) }}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>開始</Label><TimeSelect value={form.start_time} onChange={v => setForm({ ...form, start_time: v })} /></div>
              <div className="space-y-1.5"><Label>終了</Label><TimeSelect value={form.end_time} onChange={v => setForm({ ...form, end_time: v })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>募集人数</Label>
              <Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
            </div>
            {rooms.length > 0 && (
              <div className="space-y-1.5">
                <Label>ルーム</Label>
                <Select value={form.room_id} onValueChange={v => setForm({ ...form, room_id: v ?? '' })}>
                  <SelectTrigger>
                    <SelectValue placeholder="選択（任意）">
                      {form.room_id ? rooms.find(r => r.id === form.room_id)?.name : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>{rooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5"><Label>備考</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button onClick={handleCreate} disabled={!form.date}>登録</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
