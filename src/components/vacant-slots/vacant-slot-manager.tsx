'use client'

import { Fragment, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { TimeSelect } from '@/components/ui/time-select'
import { ShiftCalendar } from '@/components/shifts/shift-calendar'
import { Plus, Check, X, ChevronDown } from 'lucide-react'
import { sendPushNotification } from '@/lib/push'

interface Application { id: string; status: string; cast_id: string; cast: { display_name: string | null } | null }
interface Slot {
  id: string; date: string; start_time: string; end_time: string; notes: string | null; is_published: boolean
  room_id: string | null
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
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', room_id: '', notes: '' })
  const supabase = createClient()

  async function handleCreate() {
    const { data, error } = await supabase.from('vacant_slots').insert({
      store_id: storeId, created_by: userId,
      date: form.date, start_time: form.start_time, end_time: form.end_time,
      room_id: form.room_id || null, notes: form.notes || null, is_published: false,
    }).select('*, rooms(name), vacant_slot_applications(id, status, cast_id, cast:users!vacant_slot_applications_cast_id_fkey(display_name))').single()
    if (error) { toast.error('登録に失敗しました'); return }
    setSlots([data, ...slots])
    toast.success('空き枠を登録しました')
    setOpen(false)
  }

  async function togglePublish(slot: Slot) {
    const { error } = await supabase.from('vacant_slots').update({ is_published: !slot.is_published }).eq('id', slot.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setSlots(slots.map(s => s.id === slot.id ? { ...s, is_published: !slot.is_published } : s))
    toast.success(slot.is_published ? '非公開にしました' : '公開しました')
  }

  async function handleApplication(appId: string, slotId: string, castId: string, approve: boolean) {
    const updates: { status: 'approved' | 'rejected'; reviewed_at: string } = { status: approve ? 'approved' : 'rejected', reviewed_at: new Date().toISOString() }
    const { error: e1 } = await supabase.from('vacant_slot_applications').update(updates).eq('id', appId)
    if (e1) { toast.error('処理に失敗しました'); return }

    const slot = slots.find(s => s.id === slotId)
    if (approve && slot) {
      await supabase.from('shifts').insert({
        cast_id: castId, store_id: storeId, room_id: slot.room_id ?? null,
        date: slot.date, start_time: slot.start_time, end_time: slot.end_time, status: 'confirmed',
      })
    }
    setSlots(slots.map(s => s.id === slotId ? {
      ...s,
      vacant_slot_applications: s.vacant_slot_applications.map(a => a.id === appId ? { ...a, status: approve ? 'approved' : 'rejected' } : a),
    } : s))
    toast.success(approve ? '承認しました' : '却下しました')

    if (slot) {
      const title = approve ? '空き枠申請が承認されました' : '空き枠申請が却下されました'
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
              <TableHead>公開</TableHead>
              <TableHead>申請</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">空き枠がありません</TableCell></TableRow>
            )}
            {slots.map(slot => (
              <Fragment key={slot.id}>
                <TableRow>
                  <TableCell>{format(new Date(slot.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</TableCell>
                  <TableCell>{slot.rooms?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Switch checked={slot.is_published} onCheckedChange={() => togglePublish(slot)} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{slot.vacant_slot_applications.filter(a => a.status === 'pending').length} 件待ち</Badge>
                  </TableCell>
                </TableRow>
                {slot.vacant_slot_applications.filter(a => a.status === 'pending').map(app => (
                  <TableRow key={app.id} className="bg-primary/10">
                    <TableCell colSpan={3} className="pl-8 text-sm">
                      申請: {app.cast?.display_name ?? '—'}
                    </TableCell>
                    <TableCell colSpan={2} className="space-x-1">
                      <Button size="sm" variant="outline" className="text-positive h-7"
                        onClick={() => handleApplication(app.id, slot.id, app.cast_id, true)}>
                        <Check className="h-3 w-3 mr-1" />承認
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7"
                        onClick={() => handleApplication(app.id, slot.id, app.cast_id, false)}>
                        <X className="h-3 w-3 mr-1" />却下
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
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
            {rooms.length > 0 && (
              <div className="space-y-1.5">
                <Label>ルーム</Label>
                <Select value={form.room_id} onValueChange={v => setForm({ ...form, room_id: v ?? '' })}>
                  <SelectTrigger><SelectValue placeholder="選択（任意）" /></SelectTrigger>
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
