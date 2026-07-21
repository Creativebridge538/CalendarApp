'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Plus, Pencil, UserX, UserCheck } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'

type CastUser = Pick<
  Database['public']['Tables']['users']['Row'],
  'id' | 'display_name' | 'real_name' | 'phone' | 'reward_rate' | 'is_active' | 'email' | 'profile_answers'
>

interface CastListProps {
  casts: CastUser[]
  storeId: string
  profileFields: { id: string; label: string }[]
}

export function CastList({ casts: initialCasts, storeId, profileFields }: CastListProps) {
  const [casts, setCasts] = useState(initialCasts)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CastUser | null>(null)
  const [form, setForm] = useState({ email: '', password: '', display_name: '', real_name: '', phone: '', reward_rate: '0.4', profile_answers: {} as Record<string, string> })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function openNew() {
    setEditing(null)
    setForm({ email: '', password: '', display_name: '', real_name: '', phone: '', reward_rate: '0.4', profile_answers: {} })
    setOpen(true)
  }

  function openEdit(cast: CastUser) {
    setEditing(cast)
    setForm({
      email: cast.email ?? '',
      password: '',
      display_name: cast.display_name ?? '',
      real_name: cast.real_name ?? '',
      phone: cast.phone ?? '',
      reward_rate: String(cast.reward_rate),
      profile_answers: { ...(cast.profile_answers as Record<string, string> | null ?? {}) },
    })
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (!editing) {
        const res = await fetch('/api/admin/create-cast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const json = await res.json()
        if (!res.ok) { toast.error(json.error ?? '作成に失敗しました'); return }
        setCasts([...casts, json.cast])
        toast.success('キャストを作成しました')
      } else {
        const payload = {
          display_name: form.display_name,
          real_name: form.real_name || null,
          phone: form.phone || null,
          reward_rate: parseFloat(form.reward_rate),
          profile_answers: form.profile_answers,
        }
        const { error } = await supabase.from('users').update(payload).eq('id', editing.id)
        if (error) { toast.error('更新に失敗しました'); return }
        setCasts(casts.map(c => c.id === editing.id ? { ...c, ...payload } : c))
        toast.success('キャスト情報を更新しました')
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(cast: CastUser) {
    const { error } = await supabase.from('users').update({ is_active: !cast.is_active }).eq('id', cast.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => c.id === cast.id ? { ...c, is_active: !cast.is_active } : c))
    toast.success(cast.is_active ? '無効にしました' : '有効にしました')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>キャスト管理</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4 mr-1" /> キャスト追加
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>源氏名</TableHead>
              <TableHead>本名</TableHead>
              <TableHead>連絡先</TableHead>
              <TableHead className="text-right">報酬率</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {casts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  キャストが登録されていません
                </TableCell>
              </TableRow>
            )}
            {casts.map((cast) => (
              <TableRow key={cast.id} className={!cast.is_active ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{cast.display_name ?? '—'}</TableCell>
                <TableCell>{cast.real_name ?? '—'}</TableCell>
                <TableCell>{cast.phone ?? '—'}</TableCell>
                <TableCell className="text-right">{(Number(cast.reward_rate) * 100).toFixed(1)}%</TableCell>
                <TableCell>
                  <Badge variant={cast.is_active ? 'default' : 'secondary'}>
                    {cast.is_active ? '在籍中' : '無効'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(cast)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => toggleActive(cast)}>
                    {cast.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
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
            <DialogTitle>{editing ? 'キャスト編集' : 'キャスト追加'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {!editing && (
              <>
                <div className="space-y-1.5">
                  <Label>メールアドレス *</Label>
                  <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="cast@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>パスワード *</Label>
                  <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8文字以上" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>源氏名 *</Label>
              <Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>本名</Label>
              <Input value={form.real_name} onChange={e => setForm({ ...form, real_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>連絡先</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="090-xxxx-xxxx" />
            </div>
            <div className="space-y-1.5">
              <Label>報酬率（0〜1）</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={form.reward_rate}
                onChange={e => setForm({ ...form, reward_rate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">例: 0.40 = 40%</p>
            </div>
            {editing && profileFields.map(field => (
              <div key={field.id} className="space-y-1.5">
                <Label>{field.label}</Label>
                <Input
                  value={form.profile_answers[field.id] ?? ''}
                  onChange={e => setForm({ ...form, profile_answers: { ...form.profile_answers, [field.id]: e.target.value } })}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>キャンセル</Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.display_name || (!editing && (!form.email || !form.password))}
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
