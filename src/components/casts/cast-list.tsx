'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Plus, Pencil, UserX, UserCheck, LayoutGrid, List, User, Copy, Loader2, X } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { cn } from '@/lib/utils'
import { toHalfWidthDigits } from '@/lib/zenkaku'
import { usePagination } from '@/hooks/use-pagination'
import { parsePlatformRewardRates } from '@/lib/reward-rate'

type CastUser = Pick<
  Database['public']['Tables']['users']['Row'],
  'id' | 'display_name' | 'real_name' | 'phone' | 'reward_rate' | 'platform_reward_rates' | 'daily_payment_reward_rate' | 'is_active' | 'email' | 'profile_answers'
  | 'photo_url' | 'login_id' | 'bank_name' | 'bank_branch' | 'bank_account_number' | 'bank_account_holder' | 'platform_daily_payment_reward_rates'
>

const PLATFORM_RATE_FIELDS: { key: 'stripchat' | 'fc2' | 'dxlive'; label: string }[] = [
  { key: 'stripchat', label: 'STRIPCHAT' },
  { key: 'fc2', label: 'FC2' },
  { key: 'dxlive', label: 'DXライブ' },
]

interface CastListProps {
  casts: CastUser[]
  storeId: string
  profileFields: { id: string; label: string }[]
  stageNamesByCastId: Record<string, string[]>
  enabledPlatforms: string[]
}

export function CastList({ casts: initialCasts, storeId, profileFields, stageNamesByCastId, enabledPlatforms }: CastListProps) {
  const router = useRouter()
  const [casts, setCasts] = useState(initialCasts)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CastUser | null>(null)
  const [form, setForm] = useState({
    email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40',
    daily_payment_reward_rate: '',
    bank_name: '', bank_branch: '', bank_account_number: '', bank_account_holder: '',
    profile_answers: {} as Record<string, string>,
    platform_reward_rates: { stripchat: '', fc2: '', dxlive: '' } as Record<'stripchat' | 'fc2' | 'dxlive', string>,
    platform_daily_payment_reward_rates: { stripchat: '', fc2: '', dxlive: '' } as Record<'stripchat' | 'fc2' | 'dxlive', string>,
    stage_names: [] as string[],
  })
  const [saving, setSaving] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<CastUser | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [bulkToggling, setBulkToggling] = useState(false)
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
    setBulkToggling(true)
    const { error } = await supabase.from('users').update({ is_active: isActive }).in('id', ids)
    setBulkToggling(false)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => ids.includes(c.id) ? { ...c, is_active: isActive } : c))
    setSelected(new Set())
    toast.success(isActive ? '選択したキャストを有効にしました' : '選択したキャストを無効にしました')
  }

  function openNew() {
    setEditing(null)
    setForm({
      email: '', password: '', login_id: '', display_name: '', real_name: '', phone: '', reward_rate: '40',
      daily_payment_reward_rate: '',
      bank_name: '', bank_branch: '', bank_account_number: '', bank_account_holder: '',
      profile_answers: {},
      platform_reward_rates: { stripchat: '', fc2: '', dxlive: '' },
      platform_daily_payment_reward_rates: { stripchat: '', fc2: '', dxlive: '' },
      stage_names: [],
    })
    setOpen(true)
  }

  function openEdit(cast: CastUser) {
    setEditing(cast)
    const platformRates = parsePlatformRewardRates(cast.platform_reward_rates)
    const platformDailyRates = parsePlatformRewardRates(cast.platform_daily_payment_reward_rates)
    setForm({
      email: cast.email ?? '',
      password: '',
      login_id: cast.login_id ?? '',
      display_name: cast.display_name ?? '',
      real_name: cast.real_name ?? '',
      phone: cast.phone ?? '',
      reward_rate: String(Number(cast.reward_rate) * 100),
      daily_payment_reward_rate: cast.daily_payment_reward_rate != null ? String(Number(cast.daily_payment_reward_rate) * 100) : '',
      bank_name: cast.bank_name ?? '',
      bank_branch: cast.bank_branch ?? '',
      bank_account_number: cast.bank_account_number ?? '',
      bank_account_holder: cast.bank_account_holder ?? '',
      profile_answers: { ...(cast.profile_answers as Record<string, string> | null ?? {}) },
      platform_reward_rates: {
        stripchat: platformRates.stripchat != null ? String(platformRates.stripchat * 100) : '',
        fc2: platformRates.fc2 != null ? String(platformRates.fc2 * 100) : '',
        dxlive: platformRates.dxlive != null ? String(platformRates.dxlive * 100) : '',
      },
      platform_daily_payment_reward_rates: {
        stripchat: platformDailyRates.stripchat != null ? String(platformDailyRates.stripchat * 100) : '',
        fc2: platformDailyRates.fc2 != null ? String(platformDailyRates.fc2 * 100) : '',
        dxlive: platformDailyRates.dxlive != null ? String(platformDailyRates.dxlive * 100) : '',
      },
      stage_names: stageNamesByCastId[cast.id] ?? [],
    })
    setOpen(true)
  }

  // 入力欄が空のプラットフォームは「基本報酬率を使う」として保存しない
  function buildPlatformRewardRates(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const { key } of PLATFORM_RATE_FIELDS) {
      const raw = form.platform_reward_rates[key]
      if (raw.trim() === '') continue
      const pct = parseFloat(raw)
      if (!Number.isNaN(pct)) result[key] = pct / 100
    }
    return result
  }

  // 入力欄が空のプラットフォームは「キャスト共通の前払い率（未設定なら基本報酬率）を使う」として保存しない
  function buildPlatformDailyPaymentRewardRates(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const { key } of PLATFORM_RATE_FIELDS) {
      const raw = form.platform_daily_payment_reward_rates[key]
      if (raw.trim() === '') continue
      const pct = parseFloat(raw)
      if (!Number.isNaN(pct)) result[key] = pct / 100
    }
    return result
  }

  // 源氏名一覧を丸ごと入れ替える（削除してから、空でないものだけ挿入し直す）
  async function syncStageNames(castId: string): Promise<boolean> {
    const names = Array.from(new Set(form.stage_names.map(n => n.trim()).filter(Boolean)))
    const { error: deleteError } = await supabase.from('cast_stage_names').delete().eq('cast_id', castId)
    if (deleteError) return true
    if (names.length > 0) {
      const { error } = await supabase.from('cast_stage_names').insert(names.map(name => ({ store_id: storeId, cast_id: castId, name })))
      if (error) return true
    }
    return false
  }

  async function handleSave() {
    const trimmedStageNames = form.stage_names.map(n => n.trim()).filter(Boolean)
    const namesToCheck = [form.display_name.trim(), ...trimmedStageNames]
    const lowerNames = namesToCheck.map(n => n.toLowerCase())
    if (new Set(lowerNames).size !== lowerNames.length) {
      toast.error('同じ源氏名が重複しています。それぞれ別の名前にしてください')
      return
    }

    // 売上登録のキャスト選択で同じ表記が複数キャストにまたがると区別できなくなるため、
    // 他のキャスト（本名以外の源氏名も含む）との重複も禁止する
    const otherCastsNames = new Set(
      casts
        .filter(c => c.id !== editing?.id)
        .flatMap(c => [c.display_name ?? '', ...(stageNamesByCastId[c.id] ?? [])])
        .map(n => n.trim().toLowerCase())
        .filter(Boolean)
    )
    const conflictingName = namesToCheck.find(n => otherCastsNames.has(n.toLowerCase()))
    if (conflictingName) {
      toast.error(`「${conflictingName}」という源氏名は既に他のキャストで使われています。別の名前にしてください`)
      return
    }

    setSaving(true)
    try {
      if (!editing) {
        const res = await fetch('/api/admin/create-cast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            reward_rate: form.reward_rate ? String(parseFloat(form.reward_rate) / 100) : form.reward_rate,
            daily_payment_reward_rate: form.daily_payment_reward_rate.trim() !== '' ? String(parseFloat(form.daily_payment_reward_rate) / 100) : null,
            platform_reward_rates: buildPlatformRewardRates(),
            platform_daily_payment_reward_rates: buildPlatformDailyPaymentRewardRates(),
          }),
        })
        const json = await res.json()
        if (!res.ok) { toast.error(json.error ?? '作成に失敗しました'); return }
        const stageNameError = await syncStageNames(json.cast.id)
        if (stageNameError) { toast.error('源氏名の保存に失敗しました'); return }
        setCasts([...casts, json.cast])
        toast.success('キャストを作成しました')
      } else {
        const payload = {
          display_name: form.display_name,
          real_name: form.real_name || null,
          phone: form.phone || null,
          reward_rate: parseFloat(form.reward_rate) / 100,
          daily_payment_reward_rate: form.daily_payment_reward_rate.trim() !== '' ? parseFloat(form.daily_payment_reward_rate) / 100 : null,
          platform_reward_rates: buildPlatformRewardRates(),
          platform_daily_payment_reward_rates: buildPlatformDailyPaymentRewardRates(),
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
        const stageNameError = await syncStageNames(editing.id)
        if (stageNameError) { toast.error('源氏名の保存に失敗しました'); return }
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
      // 源氏名はサーバーコンポーネント側で取得したstageNamesByCastIdに依存するため、
      // 保存直後の画面にも反映されるよう再取得する
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  // パスワードは一方向ハッシュで保存され後から取得できないため、既に入力済みの場合のみ含め、
  // 不明な場合は空欄のまま渡す（コピーのために勝手にパスワードを再発行することはしない）
  function accountInfoText(loginId: string, password: string, email?: string | null) {
    return [
      `ログインURL: ${window.location.origin}/login`,
      `メールアドレス: ${email || '—'}`,
      `ログインID: ${loginId}`,
      `パスワード: ${password}`,
    ].join('\n')
  }

  async function copyAccountInfo() {
    if (!form.login_id) { toast.error('ユーザーIDを入力してください'); return }
    await navigator.clipboard.writeText(accountInfoText(form.login_id, form.password, form.email))
    toast.success('ログイン情報をコピーしました')
  }

  async function copyCastAccountInfo(cast: CastUser) {
    if (!cast.login_id) { toast.error('このキャストにはユーザーIDが設定されていません'); return }
    await navigator.clipboard.writeText(accountInfoText(cast.login_id, '', cast.email))
    toast.success('ログイン情報をコピーしました')
  }

  async function toggleActive(cast: CastUser) {
    // 無効化は影響が大きい（ログイン不可・一覧から外れる）ので確認を挟む。再有効化は即実行してよい
    if (cast.is_active) { setDeactivateTarget(cast); return }
    setTogglingId(cast.id)
    const { error } = await supabase.from('users').update({ is_active: true }).eq('id', cast.id)
    setTogglingId(null)
    if (error) { toast.error('更新に失敗しました'); return }
    setCasts(casts.map(c => c.id === cast.id ? { ...c, is_active: true } : c))
    toast.success('有効にしました')
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    const cast = deactivateTarget
    setTogglingId(cast.id)
    const { error } = await supabase.from('users').update({ is_active: false }).eq('id', cast.id)
    setTogglingId(null)
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
              <Button size="sm" variant="outline" disabled={bulkToggling} onClick={() => bulkSetActive(true)}>有効にする</Button>
              <Button size="sm" variant="outline" disabled={bulkToggling} onClick={() => bulkSetActive(false)}>無効にする</Button>
              <Button size="sm" variant="ghost" disabled={bulkToggling} onClick={() => setSelected(new Set())}>選択解除</Button>
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
                      disabled={togglingId === cast.id}
                      onClick={() => toggleActive(cast)}
                    >
                      {togglingId === cast.id
                        ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        : cast.is_active ? <UserX className="h-3.5 w-3.5 mr-1" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
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
                      onClick={e => { e.stopPropagation(); if (togglingId !== cast.id) toggleActive(cast) }}
                      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && togglingId !== cast.id) { e.preventDefault(); e.stopPropagation(); toggleActive(cast) } }}
                      className={cn(
                        'absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border bg-background hover:bg-accent',
                        cast.is_active ? 'text-destructive' : 'text-positive'
                      )}
                    >
                      {togglingId === cast.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : cast.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
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
              <Label required>メールアドレス</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="cast@example.com" />
            </div>
            {!editing ? (
              <div className="space-y-1.5">
                <Label required>パスワード</Label>
                <PasswordInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8文字以上" autoComplete="new-password" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>パスワード変更</Label>
                <PasswordInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="変更する場合のみ入力（8文字以上）" autoComplete="new-password" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label required>ユーザーID</Label>
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
              <Label required>源氏名</Label>
              <Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label required>本名</Label>
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
              <p className="text-xs text-muted-foreground">プラットフォーム別の報酬率を設定していない場合、この率が使われます</p>
            </div>
            <div className="space-y-1.5 pt-2 border-t">
              <Label>日払い時の報酬率（任意）</Label>
              <div className="relative w-32">
                <Input
                  type="number" step="1" min="0" max="100" className="pr-8"
                  value={form.daily_payment_reward_rate}
                  onChange={e => setForm({ ...form, daily_payment_reward_rate: e.target.value })}
                  placeholder={form.reward_rate}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">日払いに変更した売上で、個別に率を指定しなかった場合に使われます</p>
            </div>
            {enabledPlatforms.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t">
                <Label>プラットフォーム別の報酬率（任意）</Label>
                <div className="grid grid-cols-3 gap-2">
                  {PLATFORM_RATE_FIELDS.filter(f => enabledPlatforms.includes(f.key)).map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
                      <div className="relative">
                        <Input
                          type="number" step="1" min="0" max="100" className="pr-6"
                          value={form.platform_reward_rates[key]}
                          onChange={e => setForm({ ...form, platform_reward_rates: { ...form.platform_reward_rates, [key]: e.target.value } })}
                          placeholder={form.reward_rate}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {enabledPlatforms.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t">
                <Label>プラットフォーム別の前払い時報酬率（任意）</Label>
                <div className="grid grid-cols-3 gap-2">
                  {PLATFORM_RATE_FIELDS.filter(f => enabledPlatforms.includes(f.key)).map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
                      <div className="relative">
                        <Input
                          type="number" step="1" min="0" max="100" className="pr-6"
                          value={form.platform_daily_payment_reward_rates[key]}
                          onChange={e => setForm({ ...form, platform_daily_payment_reward_rates: { ...form.platform_daily_payment_reward_rates, [key]: e.target.value } })}
                          placeholder={form.daily_payment_reward_rate || form.reward_rate}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">未設定のプラットフォームは「日払い時の報酬率」（それも未設定ならプラットフォーム別/基本の報酬率）が使われます</p>
              </div>
            )}
            <div className="space-y-1.5 pt-2 border-t">
              <Label>追加の源氏名（任意）</Label>
              <div className="space-y-2">
                {form.stage_names.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="源氏名" value={name}
                      onChange={e => setForm({ ...form, stage_names: form.stage_names.map((n, idx) => idx === i ? e.target.value : n) })}
                    />
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, stage_names: form.stage_names.filter((_, idx) => idx !== i) })}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setForm({ ...form, stage_names: [...form.stage_names, ''] })}>
                <Plus className="h-3.5 w-3.5 mr-1" />源氏名を追加
              </Button>
              <p className="text-xs text-muted-foreground">同一人物が複数の源氏名で活動している場合に設定します。売上登録のキャスト選択でどの源氏名を選んでも、このキャスト1人として登録されます</p>
            </div>
            <div className="pt-3 border-t space-y-3">
              <p className="text-sm font-medium">振込先口座</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label required>銀行名</Label>
                  <Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="例: 三菱UFJ銀行" />
                </div>
                <div className="space-y-1.5">
                  <Label required>支店名</Label>
                  <Input value={form.bank_branch} onChange={e => setForm({ ...form, bank_branch: e.target.value })} placeholder="例: 青葉台支店" />
                </div>
                <div className="space-y-1.5">
                  <Label required>口座番号</Label>
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
                  <Label required>名義人（カナ）</Label>
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
              <Button variant="outline" onClick={() => setDeactivateTarget(null)} disabled={togglingId === deactivateTarget?.id}>キャンセル</Button>
              <Button variant="destructive" onClick={confirmDeactivate} disabled={togglingId === deactivateTarget?.id}>
                {togglingId === deactivateTarget?.id && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}無効化する
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
