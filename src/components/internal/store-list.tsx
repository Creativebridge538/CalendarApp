'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Ban, Play, Pencil, Plus } from 'lucide-react'

interface StoreAdmin {
  email: string
  display_name: string | null
}

interface StoreRow {
  id: string
  name: string
  created_at: string
  is_active: boolean
  admins: StoreAdmin[]
  castCount: number
}

export function StoreList({ stores: initialStores }: { stores: StoreRow[] }) {
  const [stores, setStores] = useState(initialStores)
  const [processing, setProcessing] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<StoreRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ store_name: '', contact_name: '', contact_email: '' })
  const [creating, setCreating] = useState(false)

  async function toggleActive(store: StoreRow) {
    const nextActive = !store.is_active
    const confirmMsg = nextActive
      ? `「${store.name}」の利用を再開しますか？`
      : `「${store.name}」を利用停止しますか？管理者・キャストともにログインできなくなります。`
    if (!confirm(confirmMsg)) return

    setProcessing(store.id)
    const res = await fetch(`/api/internal/stores/${store.id}/toggle-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: nextActive }),
    })
    const data = await res.json().catch(() => ({}))
    setProcessing(null)
    if (!res.ok) { toast.error(data.error ?? '更新に失敗しました'); return }

    setStores(stores.map(s => s.id === store.id ? { ...s, is_active: nextActive } : s))
    toast.success(nextActive ? `${store.name} の利用を再開しました` : `${store.name} を利用停止しました`)
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return
    setProcessing(renameTarget.id)
    const res = await fetch(`/api/internal/stores/${renameTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    })
    const data = await res.json().catch(() => ({}))
    setProcessing(null)
    if (!res.ok) { toast.error(data.error ?? '更新に失敗しました'); return }

    setStores(stores.map(s => s.id === renameTarget.id ? { ...s, name: renameValue.trim() } : s))
    toast.success('店舗名を変更しました')
    setRenameTarget(null)
  }

  async function submitCreate() {
    if (!createForm.store_name || !createForm.contact_name || !createForm.contact_email) {
      toast.error('すべての項目を入力してください')
      return
    }
    setCreating(true)
    const res = await fetch('/api/internal/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createForm),
    })
    const data = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) { toast.error(data.error ?? '作成に失敗しました'); return }

    setStores([{
      id: data.store.id, name: data.store.name, created_at: data.store.created_at, is_active: true,
      admins: [{ email: createForm.contact_email, display_name: createForm.contact_name }], castCount: 0,
    }, ...stores])
    toast.success(`${createForm.store_name} を作成しました。招待メールを送信しました`)
    setCreateOpen(false)
    setCreateForm({ store_name: '', contact_name: '', contact_email: '' })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>全店舗 — {stores.length} 件</CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />新規店舗を作成
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {stores.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">店舗がまだありません</p>
          )}
          {stores.map(store => (
            <div key={store.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{store.name}</p>
                    <Badge variant={store.is_active ? 'default' : 'destructive'}>
                      {store.is_active ? '稼働中' : '利用停止中'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {store.admins.map(a => a.display_name ?? a.email).join(', ') || '管理者未登録'}
                    {' ／ '}キャスト {store.castCount} 名
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(store.created_at), 'yyyy/M/d', { locale: ja })} 登録
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                {store.is_active ? (
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => toggleActive(store)} disabled={processing === store.id}>
                    <Ban className="h-3.5 w-3.5 mr-1" />利用停止する
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => toggleActive(store)} disabled={processing === store.id}>
                    <Play className="h-3.5 w-3.5 mr-1" />利用を再開する
                  </Button>
                )}
                <Button
                  size="sm" variant="outline"
                  onClick={() => { setRenameTarget(store); setRenameValue(store.name) }}
                  disabled={processing === store.id}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />店舗名を編集
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!renameTarget} onOpenChange={open => { if (!open) setRenameTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>店舗名を編集</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>店舗名</Label>
              <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>キャンセル</Button>
              <Button onClick={submitRename} disabled={processing === renameTarget?.id}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新規店舗を作成</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>店舗名</Label>
              <Input value={createForm.store_name} onChange={e => setCreateForm({ ...createForm, store_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>管理者氏名</Label>
              <Input value={createForm.contact_name} onChange={e => setCreateForm({ ...createForm, contact_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>管理者メールアドレス</Label>
              <Input type="email" value={createForm.contact_email} onChange={e => setCreateForm({ ...createForm, contact_email: e.target.value })} />
              <p className="text-xs text-muted-foreground">このメールアドレスに招待メールが送信されます</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>キャンセル</Button>
              <Button onClick={submitCreate} disabled={creating}>作成する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
