'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Plus, Pencil, UserX, UserCheck, LayoutGrid, List, User } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'

type CastUser = Pick<
  Database['public']['Tables']['users']['Row'],
  'id' | 'display_name' | 'real_name' | 'phone' | 'reward_rate' | 'is_active' | 'email' | 'profile_answers'
  | 'photo_url' | 'login_id'
>

interface CastListProps {
  casts: CastUser[]
  storeId: string
  profileFields: { id: string; label: string }[]
}

export function CastList({ casts: initialCasts, storeId, profileFields }: CastListProps) {
  const [casts, setCasts] = useState(initialCasts)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CastUser | null>(null)
  const [form, setForm] = useState({ email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40', profile_answers: {} as Record<string, string> })
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkSetActive(isActive: boolean) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const { error } = await supabase.from('users').update({ is_active: isActive }).in('id', ids)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => ids.includes(c.id) ? { ...c, is_active: isActive } : c))
    setSelected(new Set())
    toast.success(isActive ? '選択したキャストを有効にしました' : '選択したキャストを無効にしました')
  }

  function openNew() {
    setEditing(null)
    setForm({ email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40', profile_answers: {} })
    setOpen(true)
  }

  function openEdit(cast: CastUser) {
    setEditing(cast)
    setForm({
      email: cast.email ?? '',
      password: '',
      login_id: cast.login_id ?? '',
      display_name: cast.display_name ?? '',
      real_name: cast.real_name ?? '',
      phone: cast.phone ?? '',
      reward_rate: String(Number(cast.reward_rate) * 100),
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
          body: JSON.stringify({ ...form, reward_rate: form.reward_rate ? String(parseFloat(form.reward_rate) / 100) : form.reward_rate }),
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
          reward_rate: parseFloat(form.reward_rate) / 100,
          profile_answers: form.profile_answers,
          login_id: form.login_id,
        }
        const { error } = await supabase.from('users').update(payload).eq('id', editing.id)
        if (error) {
          toast.error(error.code === '23505' ? 'このユーザーIDは既に使用されています' : '更新に失敗しました')
          return
        }
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
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle>キャスト管理</CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              aria-label="リスト表示"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-sm transition-colors border-l ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              aria-label="グリッド表示"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> キャスト追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-muted text-sm">
            <span className="font-medium">{selected.size}件選択中</span>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => bulkSetActive(true)}>有効にする</Button>
              <Button size="sm" variant="outline" onClick={() => bulkSetActive(false)}>無効にする</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>選択解除</Button>
            </div>
          </div>
        )}

        {viewMode === 'list' && (
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
                  <TableCell className="font-medium">
                    {cast.display_name ?? '—'}
                  </TableCell>
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
        )}

        {viewMode === 'grid' && (
          <>
            {casts.length === 0 && (
              <p className="text-center text-muted-foreground py-8">キャストが登録されていません</p>
            )}
            {casts.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {casts.map(cast => (
                  <button
                    key={cast.id}
                    type="button"
                    onClick={() => openEdit(cast)}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center hover:bg-accent/40 transition-colors',
                      !cast.is_active && 'opacity-50'
                    )}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); toggleSelected(cast.id) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleSelected(cast.id) } }}
                      className="absolute top-2 left-2"
                    >
                      <Checkbox checked={selected.has(cast.id)} onCheckedChange={() => toggleSelected(cast.id)} />
                    </span>
                    <div className="h-14 w-14 rounded-full overflow-hidden bg-muted flex items-center justify-center mt-1">
                      {cast.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cast.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <User className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <span className="text-sm font-medium truncate w-full">{cast.display_name ?? 'キャスト名'}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
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
                  <p className="text-xs text-muted-foreground">パスワード再設定メールの送付に使用します（ログインには使いません）</p>
                </div>
                <div className="space-y-1.5">
                  <Label>パスワード *</Label>
                  <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8文字以上" />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>ユーザーID *</Label>
              <Input
                value={form.login_id}
                onChange={e => setForm({ ...form, login_id: e.target.value.trim() })}
                placeholder="ログイン時に使用するID"
              />
            </div>
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
              <Label>報酬率（%）</Label>
              <div className="relative">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="100"
                  className="pr-8"
                  value={form.reward_rate}
                  onChange={e => setForm({ ...form, reward_rate: e.target.value })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
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
                disabled={saving || !form.display_name || !form.login_id || (!editing && (!form.email || !form.password))}
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
