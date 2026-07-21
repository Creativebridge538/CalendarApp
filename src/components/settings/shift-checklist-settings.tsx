'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'

type ChecklistItem = Database['public']['Tables']['shift_checklist_items']['Row']
type ItemType = 'checkbox' | 'select'

const TYPE_LABEL: Record<ItemType, string> = { checkbox: 'チェックボックス', select: 'プルダウン' }

interface Props {
  items: ChecklistItem[]
  storeId: string
}

export function ShiftChecklistSettings({ items: initialItems, storeId }: Props) {
  const [items, setItems] = useState(initialItems)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ChecklistItem | null>(null)
  const [form, setForm] = useState({ label: '', sort_order: '0', item_type: 'checkbox' as ItemType, optionsText: '' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function openNew() {
    setEditing(null)
    setForm({ label: '', sort_order: String(items.length), item_type: 'checkbox', optionsText: '' })
    setOpen(true)
  }

  function openEdit(item: ChecklistItem) {
    setEditing(item)
    setForm({
      label: item.label,
      sort_order: String(item.sort_order),
      item_type: (item.item_type === 'select' ? 'select' : 'checkbox'),
      optionsText: item.options.join('\n'),
    })
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const options = form.item_type === 'select'
        ? form.optionsText.split('\n').map(s => s.trim()).filter(Boolean)
        : []
      const payload = {
        label: form.label,
        sort_order: parseInt(form.sort_order) || 0,
        item_type: form.item_type,
        options,
      }
      if (editing) {
        const { error } = await supabase.from('shift_checklist_items').update(payload).eq('id', editing.id)
        if (error) { toast.error('更新に失敗しました'); return }
        setItems(items.map(i => i.id === editing.id ? { ...i, ...payload } : i))
        toast.success('確認項目を更新しました')
      } else {
        const { data, error } = await supabase.from('shift_checklist_items')
          .insert({ ...payload, store_id: storeId, is_active: true })
          .select().single()
        if (error) { toast.error('作成に失敗しました'); return }
        setItems([...items, data])
        toast.success('確認項目を作成しました')
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(item: ChecklistItem) {
    const { error } = await supabase.from('shift_checklist_items').update({ is_active: !item.is_active }).eq('id', item.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setItems(items.map(i => i.id === item.id ? { ...i, is_active: !item.is_active } : i))
    toast.success(item.is_active ? '無効にしました' : '有効にしました')
  }

  async function handleDelete(item: ChecklistItem) {
    if (!confirm(`「${item.label}」を削除しますか？`)) return
    const { error } = await supabase.from('shift_checklist_items').delete().eq('id', item.id)
    if (error) { toast.error('削除に失敗しました'); return }
    setItems(items.filter(i => i.id !== item.id))
    toast.success('削除しました')
  }

  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const optionCount = form.optionsText.split('\n').map(s => s.trim()).filter(Boolean).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>シフト提出時の確認項目</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> 項目追加
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          キャストがシフト提出時に入力する項目です。チェックボックス（任意でチェック）と、プルダウン（選択肢から1つ選択）が選べます
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>項目名</TableHead>
              <TableHead>タイプ</TableHead>
              <TableHead className="text-right">順番</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  確認項目が登録されていません
                </TableCell>
              </TableRow>
            )}
            {sorted.map(item => (
              <TableRow key={item.id} className={!item.is_active ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{item.label}</TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {TYPE_LABEL[item.item_type === 'select' ? 'select' : 'checkbox']}
                    {item.item_type === 'select' && item.options.length > 0 && (
                      <span className="text-xs"> （{item.options.join(' / ')}）</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">{item.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={item.is_active ? 'default' : 'secondary'}>
                    {item.is_active ? '有効' : '無効'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(item)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleActive(item)}>
                    {item.is_active
                      ? <ToggleRight className="h-3.5 w-3.5" />
                      : <ToggleLeft className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(item)}>
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
            <DialogTitle>{editing ? '確認項目編集' : '確認項目追加'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>項目名 *</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="例: 本指名あり" />
            </div>
            <div className="space-y-1.5">
              <Label>タイプ</Label>
              <Select value={form.item_type} onValueChange={v => { if (v) setForm({ ...form, item_type: v as ItemType }) }}>
                <SelectTrigger>
                  <SelectValue>{TYPE_LABEL[form.item_type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkbox">チェックボックス（任意でチェック）</SelectItem>
                  <SelectItem value="select">プルダウン（選択肢から1つ選択）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.item_type === 'select' && (
              <div className="space-y-1.5">
                <Label>選択肢（1行に1つ）*</Label>
                <Textarea
                  value={form.optionsText}
                  onChange={e => setForm({ ...form, optionsText: e.target.value })}
                  rows={4}
                  placeholder={'例:\n初回\n2回目以降\n常連'}
                />
                <p className="text-xs text-muted-foreground">{optionCount}件の選択肢</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>表示順</Label>
              <Input type="number" min="0" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} />
              <p className="text-xs text-muted-foreground">小さい数字が先に表示されます</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>キャンセル</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.label || (form.item_type === 'select' && optionCount === 0)}
              >
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
