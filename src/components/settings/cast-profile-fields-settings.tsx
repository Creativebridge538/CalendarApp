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
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'

type ProfileField = Database['public']['Tables']['cast_profile_fields']['Row']

interface Props {
  fields: ProfileField[]
  storeId: string
}

export function CastProfileFieldsSettings({ fields: initialFields, storeId }: Props) {
  const [fields, setFields] = useState(initialFields)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProfileField | null>(null)
  const [form, setForm] = useState({ label: '', sort_order: '0' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function openNew() {
    setEditing(null)
    setForm({ label: '', sort_order: String(fields.length) })
    setOpen(true)
  }

  function openEdit(field: ProfileField) {
    setEditing(field)
    setForm({ label: field.label, sort_order: String(field.sort_order) })
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = { label: form.label, sort_order: parseInt(form.sort_order) || 0 }
      if (editing) {
        const { error } = await supabase.from('cast_profile_fields').update(payload).eq('id', editing.id)
        if (error) { toast.error('更新に失敗しました'); return }
        setFields(fields.map(f => f.id === editing.id ? { ...f, ...payload } : f))
        toast.success('項目を更新しました')
      } else {
        const { data, error } = await supabase.from('cast_profile_fields')
          .insert({ ...payload, store_id: storeId, is_active: true })
          .select().single()
        if (error) { toast.error('作成に失敗しました'); return }
        setFields([...fields, data])
        toast.success('項目を作成しました')
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(field: ProfileField) {
    const { error } = await supabase.from('cast_profile_fields').update({ is_active: !field.is_active }).eq('id', field.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setFields(fields.map(f => f.id === field.id ? { ...f, is_active: !field.is_active } : f))
    toast.success(field.is_active ? '無効にしました' : '有効にしました')
  }

  async function handleDelete(field: ProfileField) {
    if (!confirm(`「${field.label}」を削除しますか？`)) return
    const { error } = await supabase.from('cast_profile_fields').delete().eq('id', field.id)
    if (error) { toast.error('削除に失敗しました'); return }
    setFields(fields.filter(f => f.id !== field.id))
    toast.success('削除しました')
  }

  const sorted = [...fields].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>キャストプロフィール項目</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> 項目追加
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          キャスト管理画面の編集フォームに追加されるテキスト項目です（例: 身長、SNS、出身地など）
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>項目名</TableHead>
              <TableHead className="text-right">順番</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  項目が登録されていません
                </TableCell>
              </TableRow>
            )}
            {sorted.map(field => (
              <TableRow key={field.id} className={!field.is_active ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{field.label}</TableCell>
                <TableCell className="text-right">{field.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={field.is_active ? 'default' : 'secondary'}>
                    {field.is_active ? '有効' : '無効'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(field)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleActive(field)}>
                    {field.is_active
                      ? <ToggleRight className="h-3.5 w-3.5" />
                      : <ToggleLeft className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(field)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '項目編集' : '項目追加'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>項目名 *</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="例: 身長" />
            </div>
            <div className="space-y-1.5">
              <Label>表示順</Label>
              <Input type="number" min="0" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} />
              <p className="text-xs text-muted-foreground">小さい数字が先に表示されます</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>キャンセル</Button>
              <Button onClick={handleSave} disabled={saving || !form.label}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
