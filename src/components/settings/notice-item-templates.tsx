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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'

type NoticeItemTemplate = Database['public']['Tables']['notice_item_templates']['Row']

export const NOTICE_ITEM_UNIT_LABEL: Record<string, string> = {
  jpy: '円', stripchat: 'STRIPCHATトークン', fc2: 'FC2ポイント', dxlive: 'DXライブポイント',
}

interface Props {
  templates: NoticeItemTemplate[]
  storeId: string
}

export function NoticeItemTemplates({ templates: initialTemplates, storeId }: Props) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<NoticeItemTemplate | null>(null)
  const [form, setForm] = useState({ label: '', unit: 'jpy', sort_order: '0' })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function openNew() {
    setEditing(null)
    setForm({ label: '', unit: 'jpy', sort_order: String(templates.length) })
    setOpen(true)
  }

  function openEdit(template: NoticeItemTemplate) {
    setEditing(template)
    setForm({ label: template.label, unit: template.unit, sort_order: String(template.sort_order) })
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = { label: form.label, unit: form.unit, sort_order: parseInt(form.sort_order) || 0 }
      if (editing) {
        const { error } = await supabase.from('notice_item_templates').update(payload).eq('id', editing.id)
        if (error) { toast.error('更新に失敗しました'); return }
        setTemplates(templates.map(t => t.id === editing.id ? { ...t, ...payload } : t))
        toast.success('項目を更新しました')
      } else {
        const { data, error } = await supabase.from('notice_item_templates')
          .insert({ ...payload, store_id: storeId, is_active: true })
          .select().single()
        if (error) { toast.error('作成に失敗しました'); return }
        setTemplates([...templates, data])
        toast.success('項目を作成しました')
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(template: NoticeItemTemplate) {
    const { error } = await supabase.from('notice_item_templates').update({ is_active: !template.is_active }).eq('id', template.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setTemplates(templates.map(t => t.id === template.id ? { ...t, is_active: !template.is_active } : t))
    toast.success(template.is_active ? '無効にしました' : '有効にしました')
  }

  async function handleDelete(template: NoticeItemTemplate) {
    if (!confirm(`「${template.label}」を削除しますか？`)) return
    const { error } = await supabase.from('notice_item_templates').delete().eq('id', template.id)
    if (error) { toast.error('削除に失敗しました'); return }
    setTemplates(templates.filter(t => t.id !== template.id))
    toast.success('削除しました')
  }

  const sorted = [...templates].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>支払通知書の項目設定</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> 項目追加
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          支払通知書の発行・編集時に追加項目として選べる項目です（例: ボーナス、ドリンクバック、イベント報酬など）。
          円以外の単位を選ぶと、入力した数量からプラットフォームの計算式で自動的に円換算されます。
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>項目名</TableHead>
              <TableHead>単位</TableHead>
              <TableHead className="text-right">順番</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  項目が登録されていません
                </TableCell>
              </TableRow>
            )}
            {sorted.map(template => (
              <TableRow key={template.id} className={!template.is_active ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{template.label}</TableCell>
                <TableCell>{NOTICE_ITEM_UNIT_LABEL[template.unit] ?? template.unit}</TableCell>
                <TableCell className="text-right">{template.sort_order}</TableCell>
                <TableCell>
                  <Badge variant={template.is_active ? 'default' : 'secondary'}>
                    {template.is_active ? '有効' : '無効'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(template)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleActive(template)}>
                    {template.is_active
                      ? <ToggleRight className="h-3.5 w-3.5" />
                      : <ToggleLeft className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(template)}>
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
              <Label required>項目名</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="例: ドリンクバック" />
            </div>
            <div className="space-y-1.5">
              <Label>入力単位</Label>
              <Select value={form.unit} onValueChange={v => { if (v) setForm({ ...form, unit: v }) }}>
                <SelectTrigger>
                  <SelectValue>{NOTICE_ITEM_UNIT_LABEL[form.unit] ?? form.unit}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {Object.entries(NOTICE_ITEM_UNIT_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">円以外を選ぶと、発行・編集時に数量を入力すると自動で円換算されます</p>
            </div>
            <div className="space-y-1.5">
              <Label>表示順</Label>
              <Input type="number" min="0" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} />
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
