'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
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
import { Pagination } from '@/components/ui/pagination'
import { Plus, Pencil, UserX, UserCheck, LayoutGrid, List, User, Copy } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'
import { toHalfWidthDigits } from '@/lib/zenkaku'
import { usePagination } from '@/hooks/use-pagination'

type CastUser = Pick<
  Database['public']['Tables']['users']['Row'],
  'id' | 'display_name' | 'real_name' | 'phone' | 'reward_rate' | 'is_active' | 'email' | 'profile_answers'
  | 'photo_url' | 'login_id' | 'bank_name' | 'bank_branch' | 'bank_account_number' | 'bank_account_holder'
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
  const [form, setForm] = useState({
    email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40',
    bank_name: '', bank_branch: '', bank_account_number: '', bank_account_holder: '',
    profile_answers: {} as Record<string, string>,
  })
  const [saving, setSaving] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<CastUser | null>(null)
  const supabase = createClient()
  const { page, setPage, pageSize, setPageSize, totalPages, paged: pagedCasts, totalItems } = usePagination(casts)

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
    setForm({
      email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40',
      bank_name: '', bank_branch: '', bank_account_number: '', bank_account_holder: '',
      profile_answers: {},
    })
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
      bank_name: cast.bank_name ?? '',
      bank_branch: cast.bank_branch ?? '',
      bank_account_number: cast.bank_account_number ?? '',
      bank_account_holder: cast.bank_account_holder ?? '',
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
          bank_name: form.bank_name || null,
          bank_branch: form.bank_branch || null,
          bank_account_number: form.bank_account_number || null,
          bank_account_holder: form.bank_account_holder || null,
          profile_answers: form.profile_answers,
          login_id: form.login_id,
        }
        const { error } = await supabase.from('users').update(payload).eq('id', editing.id)
        if (error) {
          toast.error(error.code === '23505' ? 'このユーザーIDは既に使用されています' : '更新に失敗しました')
          return
        }
        let email = editing.email
        if (form.email !== editing.email) {
          const res = await fetch('/api/account/update-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: editing.id, email: form.email }),
          })
          const json = await res.json()
          if (!res.ok) {
            toast.error(json.error ?? 'メールアドレスの更新に失敗しました')
            setCasts(casts.map(c => c.id === editing.id ? { ...c, ...payload } : c))
            return
          }
          email = json.email
        }
        if (form.password) {
          const res = await fetch('/api/admin/update-cast-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: editing.id, password: form.password }),
          })
          const json = await res.json()
          if (!res.ok) {
            toast.error(json.error ?? 'パスワードの変更に失敗しました')
            setCasts(casts.map(c => c.id === editing.id ? { ...c, ...payload, email } : c))
            return
          }
        }
        setCasts(casts.map(c => c.id === editing.id ? { ...c, ...payload, email } : c))
        toast.success('キャスト情報を更新しました')
      }
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  function accountInfoText(loginId: string, password: string, email?: string | null) {
    const lines = [`ログインURL: ${window.location.origin}/login`, `ログインID: ${loginId}`]
    if (password) lines.push(`パスワード: ${password}`)
    if (email) lines.push(`メールアドレス: ${email}`)
    return lines.join('\n')
  }

  async function copyAccountInfo() {
    if (!form.login_id) { toast.error('ユーザーIDを入力してください'); return }
    await navigator.clipboard.writeText(accountInfoText(form.login_id, form.password, form.email))
    toast.success(form.password ? 'ログイン情報をコピーしました' : 'ログイン情報をコピーしました（パスワードは未入力のため含まれません）')
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    return Array.from(bytes, b => chars[b % chars.length]).join('')
  }

  // 発行後はパスワードを平文で保持していないため、行からコピーする場合は
  // 新しいパスワードを発行し直してからコピーする（＝旧パスワードは使えなくなる）
  async function copyCastAccountInfo(cast: CastUser) {
    if (!cast.login_id) { toast.error('このキャストにはユーザーIDが設定されていません'); return }
    if (!confirm(`「${cast.display_name ?? cast.login_id}」の新しいパスワードを発行してコピーします。今のパスワードは使えなくなります。よろしいですか？`)) return

    const password = generatePassword()
    const res = await fetch('/api/admin/update-cast-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: cast.id, password }),
    })
    if (!res.ok) { toast.error('パスワードの発行に失敗しました'); return }

    await navigator.clipboard.writeText(accountInfoText(cast.login_id, password, cast.email))
    toast.success('新しいパスワードを発行してコピーしました')
  }

  async function toggleActive(cast: CastUser) {
    // 無効化は影響が大きい（ログイン不可・一覧から外れる）ので確認を挟む。再有効化は即実行してよい
    if (cast.is_active) { setDeactivateTarget(cast); return }
    const { error } = await supabase.from('users').update({ is_active: true }).eq('id', cast.id)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => c.id === cast.id ? { ...c, is_active: true } : c))
    toast.success('有効にしました')
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    const cast = deactivateTarget
    const { error } = await supabase.from('users').update({ is_active: false }).eq('id', cast.id)
    setDeactivateTarget(null)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => c.id === cast.id ? { ...c, is_active: false } : c))
    toast.success('無効にしました')
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
              {pagedCasts.map((cast) => (
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
                    <Button size="sm" variant="outline" onClick={() => copyCastAccountInfo(cast)}>
                      <Copy className="h-3.5 w-3.5 mr-1" />コピー
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(cast)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />編集
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className={cast.is_active ? 'text-destructive' : 'text-positive'}
                      onClick={() => toggleActive(cast)}
                    >
                      {cast.is_active ? <UserX className="h-3.5 w-3.5 mr-1" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
                      {cast.is_active ? '無効化' : '有効化'}
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
                {pagedCasts.map(cast => (
                  <div
                    key={cast.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEdit(cast)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(cast) } }}
                    className={cn(
                      'relative flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center hover:bg-accent/40 transition-colors cursor-pointer',
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
                    <span
                      role="button"
                      tabIndex={0}
                      title={cast.is_active ? '無効化' : '有効化'}
                      onClick={e => { e.stopPropagation(); toggleActive(cast) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleActive(cast) } }}
                      className={cn(
                        'absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background hover:bg-accent',
                        cast.is_active ? 'text-destructive' : 'text-positive'
                      )}
                    >
                      {cast.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
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
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Pagination
          page={page} totalPages={totalPages} pageSize={pageSize} totalItems={totalItems}
          onPageChange={setPage} onPageSizeChange={setPageSize}
        />
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'キャスト編集' : 'キャスト追加'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>メールアドレス *</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="cast@example.com" />
            </div>
            {!editing ? (
              <div className="space-y-1.5">
                <Label>パスワード *</Label>
                <PasswordInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8文字以上" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>パスワード変更</Label>
                <PasswordInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="変更する場合のみ入力（8文字以上）" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>ユーザーID *</Label>
              <div className="flex gap-2">
                <Input
                  value={form.login_id}
                  onChange={e => setForm({ ...form, login_id: e.target.value.trim() })}
                  placeholder="ログイン時に使用するID"
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={copyAccountInfo}>
                  <Copy className="h-3.5 w-3.5 mr-1" />コピー
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">ログインURL・ユーザーID・パスワード（入力済みの場合）をコピーします</p>
            </div>
            <div className="space-y-1.5">
              <Label>源氏名 *</Label>
              <Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>本名 *</Label>
              <Input value={form.real_name} onChange={e => setForm({ ...form, real_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>連絡先</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: toHalfWidthDigits(e.target.value) })} placeholder="090-xxxx-xxxx" />
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
            <div className="pt-3 border-t space-y-3">
              <p className="text-sm font-medium">振込先口座</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>銀行名 *</Label>
                  <Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="例: 三菱UFJ銀行" />
                </div>
                <div className="space-y-1.5">
                  <Label>支店名 *</Label>
                  <Input value={form.bank_branch} onChange={e => setForm({ ...form, bank_branch: e.target.value })} placeholder="例: 青葉台支店" />
                </div>
                <div className="space-y-1.5">
                  <Label>口座番号 *</Label>
                  <Input
                    value={form.bank_account_number}
                    maxLength={7}
                    inputMode="numeric"
                    onChange={e => setForm({ ...form, bank_account_number: toHalfWidthDigits(e.target.value).replace(/\D/g, '').slice(0, 7) })}
                    placeholder="7桁の数字"
                  />
                  {form.bank_account_number.length > 0 && form.bank_account_number.length < 7 && (
                    <p className="text-xs text-destructive">口座番号は7桁で入力してください</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>名義人（カナ）*</Label>
                  <Input value={form.bank_account_holder} onChange={e => setForm({ ...form, bank_account_holder: e.target.value })} placeholder="例: ヨコタ マナミ" />
                </div>
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
                disabled={
                  saving || !form.display_name || !form.real_name || !form.login_id || !form.email
                  || !form.bank_name || !form.bank_branch || form.bank_account_number.length !== 7 || !form.bank_account_holder
                  || (!editing && !form.password)
                }
              >
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deactivateTarget} onOpenChange={open => { if (!open) setDeactivateTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>キャストを無効化しますか？</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              「{deactivateTarget?.display_name ?? '—'}」がログインできなくなり、一覧では「無効」表示になります。後からいつでも再度有効化できます。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeactivateTarget(null)}>キャンセル</Button>
              <Button variant="destructive" onClick={confirmDeactivate}>無効化する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
