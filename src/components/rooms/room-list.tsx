'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { usePagination } from '@/hooks/use-pagination'

type Room = Database['public']['Tables']['rooms']['Row']
type Area = Database['public']['Tables']['areas']['Row']

interface Props {
  rooms: Room[]
  storeId: string
  areas: Area[]
  areaLabel: string
  roomLabel: string
}

export function RoomList({ rooms: initialRooms, storeId, areas, areaLabel, roomLabel }: Props) {
  const [rooms, setRooms] = useState(initialRooms)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Room | null>(null)
  const [form, setForm] = useState({ name: '', capacity: '', notes: '', area_id: '' })
  const supabase = createClient()
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(rooms)

  const activeAreas = areas.filter(a => a.is_active).sort((a, b) => a.sort_order - b.sort_order)

  function openNew() {
    setEditing(null)
    setForm({ name: '', capacity: '', notes: '', area_id: '' })
    setOpen(true)
  }

  function openEdit(room: Room) {
    setEditing(room)
    setForm({
      name: room.name,
      capacity: String(room.capacity ?? ''),
      notes: room.notes ?? '',
      area_id: room.area_id ?? '',
    })
    setOpen(true)
  }

  async function handleSave() {
    const payload = {
      name: form.name,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      notes: form.notes || null,
      store_id: storeId,
      area_id: form.area_id || null,
    }
    if (editing) {
      const { error } = await supabase.from('rooms').update(payload).eq('id', editing.id)
      if (error) { toast.error('更新に失敗しました'); return }
      setRooms(rooms.map(r => r.id === editing.id ? { ...r, ...payload } : r))
      toast.success(`${roomLabel}を更新しました`)
    } else {
      const { data, error } = await supabase.from('rooms').insert(payload).select().single()
      if (error) { toast.error('登録に失敗しました'); return }
      setRooms([...rooms, data])
      toast.success(`${roomLabel}を登録しました`)
    }
    setOpen(false)
  }

  async function handleDelete(room: Room) {
    if (!confirm(`「${room.name}」を削除しますか？`)) return
    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    if (error) { toast.error('削除に失敗しました'); return }
    setRooms(rooms.filter(r => r.id !== room.id))
    toast.success('削除しました')
  }

  function getAreaName(areaId: string | null) {
    if (!areaId) return '—'
    return areas.find(a => a.id === areaId)?.name ?? '—'
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{roomLabel}管理</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> {roomLabel}追加</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{roomLabel}名</TableHead>
              {activeAreas.length > 0 && <TableHead>{areaLabel}</TableHead>}
              <TableHead className="text-right">収容人数</TableHead>
              <TableHead>備考</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {roomLabel}が登録されていません
                </TableCell>
              </TableRow>
            )}
            {paged.map((room) => (
              <TableRow key={room.id}>
                <TableCell className="font-medium">{room.name}</TableCell>
                {activeAreas.length > 0 && <TableCell>{getAreaName(room.area_id)}</TableCell>}
                <TableCell className="text-right">{room.capacity ?? '—'}</TableCell>
                <TableCell>{room.notes ?? '—'}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(room)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(room)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination
          page={page} totalPages={totalPages} pageSize={pageSize} totalItems={totalItems}
          onPageChange={setPage} onPageSizeChange={setPageSize}
        />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `${roomLabel}編集` : `${roomLabel}追加`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{roomLabel}名 *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            {activeAreas.length > 0 && (
              <div className="space-y-1.5">
                <Label>{areaLabel}</Label>
                <Select value={form.area_id || 'none'} onValueChange={v => setForm({ ...form, area_id: v === 'none' ? '' : (v ?? '') })}>
                  <SelectTrigger>
                    <SelectValue placeholder={`${areaLabel}を選択（任意）`}>
                      {form.area_id ? (activeAreas.find(a => a.id === form.area_id)?.name ?? 'なし') : 'なし'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">なし</SelectItem>
                    {activeAreas.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>収容人数</Label>
              <Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>備考</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button onClick={handleSave} disabled={!form.name}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
