'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { Plus, Pencil, ToggleLeft, ToggleRight, GripVertical } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { usePagination } from '@/hooks/use-pagination'

type Area = Database['public']['Tables']['areas']['Row']

interface Props {
  areas: Area[]
  storeId: string
  areaLabel: string
}

export function AreaList({ areas: initialAreas, storeId, areaLabel }: Props) {
  const [areas, setAreas] = useState(initialAreas)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Area | null>(null)
  const [form, setForm] = useState({ name: '', sort_order: '0' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function openNew() {
    setEditing(null)
    setForm({ name: '', sort_order: String(areas.length) })
    setOpen(true)
  }

  function openEdit(area: Area) {
    setEditing(area)
    setForm({ name: area.name, sort_order: String(area.sort_order) })
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = { name: form.name, sort_order: parseInt(form.sort_order) || 0 }
      if (editing) {
        const { error } = await supabase.from('areas').update(payload).eq('id', editing.id)
        if (error) { toast.error('更新に失敗しました'); return }
        setAreas(areas.map(a => a.id === editing.id ? { ...a, ...payload } : a))
        toast.success(`${areaLabel}を更新しました`)
      } else {
        const { data, error } = await supabase.from('areas')
          .insert({ ...payload, store_id: storeId, is_active: true })
          .select().single()
        if (error) { toast.error('作成に失敗しました'); return }
        setAreas([...areas, data])
        toast.success(`${areaLabel}を作成しました`)
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(area: Area) {
    const { error } = await supabase.from('areas').update({ is_active: !area.is_active }).eq('id', area.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setAreas(areas.map(a => a.id === area.id ? { ...a, is_active: !area.is_active } : a))
    toast.success(area.is_active ? '無効にしました' : '有効にしました')
  }

  const sorted = [...areas].sort((a, b) => a.sort_order - b.sort_order)
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(sorted)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{areaLabel}管理</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> {areaLabel}追加
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>{areaLabel}名</TableHead>
              <TableHead className="text-right">順番</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {areaLabel}が登録されていません
                </TableCell>
              </TableRow>
            )}
            {paged.map(area => (
              <TableRow key={area.id} className={!area.is_active ? 'opacity-50' : ''}>
                <TableCell><GripVertical className="h-4 w-4 text-muted-foreground" /></TableCell>
                <TableCell className="font-medium">{area.name}</TableCell>
                <TableCell className="text-right">{area.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={area.is_active ? 'default' : 'secondary'}>
                    {area.is_active ? '有効' : '無効'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(area)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleActive(area)}>
                    {area.is_active
                      ? <ToggleRight className="h-3.5 w-3.5" />
                      : <ToggleLeft className="h-3.5 w-3.5" />}
                  </Button>
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
            <DialogTitle>{editing ? `${areaLabel}編集` : `${areaLabel}追加`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>{areaLabel}名 *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例: VIPフロア" />
            </div>
            <div className="space-y-1.5">
              <Label>表示順</Label>
              <Input type="number" min="0" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} />
              <p className="text-xs text-muted-foreground">小さい数字が先に表示されます</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>キャンセル</Button>
              <Button onClick={handleSave} disabled={saving || !form.name}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
