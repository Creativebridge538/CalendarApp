'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pagination } from '@/components/ui/pagination'
import { Download, HardDriveUpload, Link2Off, Pencil, Plus, X } from 'lucide-react'
import { PaymentNoticeButton } from '@/components/rewards/payment-notice-modal'
import { usePagination } from '@/hooks/use-pagination'

interface Notice {
  id: string
  castId: string
  castName: string
  castRealName: string | null
  body: string | null
  from: string
  to: string
  createdAt: string
  manuallyEdited: boolean
  /** この通知が指す発行済み通知書の実体ID。この機能追加より前に発行された古い通知はnull */
  noticeId: string | null
}

interface Props {
  notices: Notice[]
  casts: { id: string; display_name: string | null }[]
  googleDriveConnected: boolean
}

export function IssuedNoticesList({ notices, casts, googleDriveConnected }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterCast, setFilterCast] = useState('all')
  const [filterFrom, setFilterFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [filterTo, setFilterTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [downloading, setDownloading] = useState(false)
  const [driveUploading, setDriveUploading] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [editTarget, setEditTarget] = useState<Notice | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    cast_name: '', cast_real_name: '', bank_name: '', bank_branch: '', bank_account_number: '', bank_account_holder: '',
    reward_rate: '', bonus: '', deduction: '', show_sales_total: true, show_reward_rate: true,
  })
  const [editCustomItems, setEditCustomItems] = useState<{ label: string; amount: string }[]>([])
  const [editSalesRows, setEditSalesRows] = useState<{ date: string; platformLabel: string; amount: string; reward: string; isDailyPayment: boolean }[]>([])

  const editSalesTotal = editSalesRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
  const editBaseReward = editSalesRows.reduce((sum, r) => sum + (parseFloat(r.reward) || 0), 0)

  async function openEdit(notice: Notice) {
    if (!notice.noticeId) { toast.error('この通知書は古い形式のため編集できません'); return }
    setEditTarget(notice)
    setEditLoading(true)
    const res = await fetch(`/api/rewards/notices/snapshot?id=${notice.noticeId}`)
    const json = await res.json()
    setEditLoading(false)
    if (!res.ok) { toast.error(json.error ?? '内容の取得に失敗しました'); setEditTarget(null); return }
    const c = json.content
    setEditForm({
      cast_name: c.castName, cast_real_name: c.castRealName,
      bank_name: c.bankName, bank_branch: c.bankBranch,
      bank_account_number: c.bankAccountNumber, bank_account_holder: c.bankAccountHolder,
      reward_rate: String(Number(c.rewardRate) * 100), bonus: String(c.bonus), deduction: String(c.deduction),
      show_sales_total: c.showSalesTotal, show_reward_rate: c.showRewardRate,
    })
    setEditCustomItems((c.customItems ?? []).map((i: { label: string; amount: number }) => ({ label: i.label, amount: String(i.amount) })))
    setEditSalesRows((c.salesRows ?? []).map((r: { date: string; platformLabel: string; amount: number; reward: number; isDailyPayment: boolean }) => ({
      date: r.date, platformLabel: r.platformLabel, amount: String(r.amount), reward: String(r.reward ?? 0), isDailyPayment: r.isDailyPayment,
    })))
  }

  async function saveEdit() {
    if (!editTarget?.noticeId) return
    setEditSaving(true)
    const res = await fetch('/api/rewards/notices/snapshot', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editTarget.noticeId,
        ...editForm,
        reward_rate: (parseFloat(editForm.reward_rate) || 0) / 100,
        bonus: parseFloat(editForm.bonus) || 0, deduction: parseFloat(editForm.deduction) || 0,
        custom_items: editCustomItems
          .filter(i => i.label.trim() !== '')
          .map(i => ({ label: i.label, amount: parseFloat(i.amount) || 0 })),
        sales_rows: editSalesRows.map(r => ({
          date: r.date, platformLabel: r.platformLabel,
          amount: parseFloat(r.amount) || 0, reward: parseFloat(r.reward) || 0,
          isDailyPayment: r.isDailyPayment, dailyPaymentAt: null,
        })),
      }),
    })
    const json = await res.json()
    setEditSaving(false)
    if (!res.ok) { toast.error(json.error ?? '更新に失敗しました'); return }
    toast.success('通知書の内容を更新しました')
    setEditTarget(null)
    router.refresh()
  }

  useEffect(() => {
    const status = searchParams.get('google_drive')
    if (status === 'connected') toast.success('Google Driveと連携しました')
    else if (status === 'error') toast.error('Google Driveとの連携に失敗しました')
    if (status) router.replace('/admin/issued-notices')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => notices.filter(n =>
    (filterCast === 'all' || n.castId === filterCast)
    && (!filterFrom || n.to >= filterFrom)
    && (!filterTo || n.from <= filterTo)
  ), [notices, filterCast, filterFrom, filterTo])
  const filtersActive = filterCast !== 'all' || !!filterFrom || !!filterTo
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(filtered)

  const allSelected = filtered.length > 0 && filtered.every(n => selected.has(n.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map(n => n.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDownload() {
    const targets = filtered.filter(n => selected.has(n.id) && n.noticeId)
    if (targets.length === 0) { toast.error('ダウンロードする通知書を選択してください（古い形式の通知書は対象外です）'); return }

    setDownloading(true)
    const res = await fetch('/api/rewards/notices/bulk-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notices: targets.map(n => ({ notice_id: n.noticeId, issued_at: n.createdAt })),
      }),
    })
    setDownloading(false)
    if (!res.ok) { toast.error('ダウンロードに失敗しました'); return }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `支払通知書_${format(new Date(), 'yyyyMMdd')}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(`${targets.length}件をダウンロードしました`)
  }

  async function handleDriveUpload() {
    const targets = filtered.filter(n => selected.has(n.id) && n.noticeId)
    if (targets.length === 0) { toast.error('保存する通知書を選択してください（古い形式の通知書は対象外です）'); return }

    setDriveUploading(true)
    try {
      const res = await fetch('/api/rewards/notices/drive-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notices: targets.map(n => ({ notice_id: n.noticeId, to: n.to, issued_at: n.createdAt })),
        }),
      })
      // サーバー関数がタイムアウトするとJSONではなくエラーページが返ってくることがあるため、
      // res.json()の失敗もまとめて捕捉する
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        toast.error(json?.error ?? `Google Driveへの保存に失敗しました（サーバーエラー: ${res.status}）`)
        return
      }
      if (json.failed > 0) {
        toast.error(`${json.uploaded}件を保存しました（${json.failed}件は失敗）`)
      } else {
        toast.success(`${json.uploaded}件をGoogle Driveに保存しました`)
      }
    } catch (e) {
      console.error('[drive-upload] request failed', e)
      toast.error('Google Driveへの保存に失敗しました（通信エラー）')
    } finally {
      setDriveUploading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Google Driveとの連携を解除しますか？')) return
    setDisconnecting(true)
    const res = await fetch('/api/google-drive/disconnect', { method: 'POST' })
    setDisconnecting(false)
    if (!res.ok) { toast.error('連携解除に失敗しました'); return }
    toast.success('連携を解除しました')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>発行済み支払通知書</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {googleDriveConnected ? (
              <>
                <Button size="sm" variant="outline" onClick={handleDriveUpload} disabled={driveUploading || selected.size === 0}>
                  <HardDriveUpload className="h-3.5 w-3.5 mr-1" />
                  {driveUploading ? '保存中...' : `選択した${selected.size}件をGoogle Driveに保存`}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDisconnect} disabled={disconnecting} title="Google Driveとの連携を解除">
                  <Link2Off className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <a href="/api/google-drive/connect" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                <HardDriveUpload className="h-3.5 w-3.5 mr-1" />
                Google Driveと連携
              </a>
            )}
            <Button size="sm" onClick={handleBulkDownload} disabled={downloading || selected.size === 0}>
              <Download className="h-3.5 w-3.5 mr-1" />
              {downloading ? 'ダウンロード中...' : `選択した${selected.size}件を一括ダウンロード`}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">開始日</Label>
            <Input type="date" className="w-40" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setPage(1) }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">終了日</Label>
            <Input type="date" className="w-40" value={filterTo} onChange={e => { setFilterTo(e.target.value); setPage(1) }} />
          </div>
          <Select value={filterCast} onValueChange={v => { if (v) { setFilterCast(v); setPage(1) } }}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {filterCast === 'all' ? '全キャスト' : (casts.find(c => c.id === filterCast)?.display_name ?? filterCast)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="all">全キャスト</SelectItem>
              {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button size="sm" variant="ghost" onClick={() => { setFilterCast('all'); setFilterFrom(''); setFilterTo(''); setPage(1) }}>
              絞り込みを解除
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} disabled={filtered.length === 0} />
              </TableHead>
              <TableHead>キャスト（源氏名）</TableHead>
              <TableHead>本名</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>発行日</TableHead>
              <TableHead className="text-right">プレビュー</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                {filtersActive ? '絞り込み条件に一致する通知書がありません' : '発行済みの支払通知書はまだありません'}
              </TableCell></TableRow>
            )}
            {paged.map(n => (
              <TableRow key={n.id}>
                <TableCell>
                  <Checkbox checked={selected.has(n.id)} onCheckedChange={() => toggleOne(n.id)} />
                </TableCell>
                <TableCell className="font-medium">
                  {n.castName}
                  {n.manuallyEdited && (
                    <Badge variant="outline" className="ml-1.5 text-[10px] font-normal align-middle" title="編集済みのため「発行」を押しても内容は上書きされません">
                      編集済み
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{n.castRealName ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{n.body}</TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(n.createdAt), 'yyyy/M/d', { locale: ja })}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(n)} disabled={!n.noticeId} title={n.noticeId ? undefined : '古い形式の通知書は編集できません'}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />編集
                  </Button>
                  <PaymentNoticeButton castId={n.castId} from={n.from} to={n.to} noticeId={n.noticeId} label="開く" />
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

      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null) }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>発行済み通知書を編集</DialogTitle>
          </DialogHeader>
          {editLoading ? (
            <p className="text-sm text-muted-foreground py-4">読み込み中...</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                ここで編集した内容は、キャストに表示される発行済み通知書に反映されます。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">源氏名</Label>
                  <Input value={editForm.cast_name} onChange={e => setEditForm({ ...editForm, cast_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">本名</Label>
                  <Input value={editForm.cast_real_name} onChange={e => setEditForm({ ...editForm, cast_real_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">銀行名</Label>
                  <Input value={editForm.bank_name} onChange={e => setEditForm({ ...editForm, bank_name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">支店名</Label>
                  <Input value={editForm.bank_branch} onChange={e => setEditForm({ ...editForm, bank_branch: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">口座番号</Label>
                  <Input value={editForm.bank_account_number} onChange={e => setEditForm({ ...editForm, bank_account_number: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">口座名義</Label>
                  <Input value={editForm.bank_account_holder} onChange={e => setEditForm({ ...editForm, bank_account_holder: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground font-normal">報酬率（%・表示用）</Label>
                <Input type="number" value={editForm.reward_rate} onChange={e => setEditForm({ ...editForm, reward_rate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">ボーナス</Label>
                  <Input type="number" value={editForm.bonus} onChange={e => setEditForm({ ...editForm, bonus: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">控除</Label>
                  <Input type="number" value={editForm.deduction} onChange={e => setEditForm({ ...editForm, deduction: e.target.value })} />
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground font-normal">売上内訳（各行を編集・追加・削除できます）</Label>
                  <p className="text-xs text-muted-foreground">
                    売上合計: ¥{editSalesTotal.toLocaleString()} ・ 基本報酬: ¥{editBaseReward.toLocaleString()}
                  </p>
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {editSalesRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input
                        type="date" className="w-36" value={row.date}
                        onChange={e => setEditSalesRows(editSalesRows.map((r, idx) => idx === i ? { ...r, date: e.target.value } : r))}
                      />
                      <Input
                        placeholder="プラットフォーム" className="w-28" value={row.platformLabel}
                        onChange={e => setEditSalesRows(editSalesRows.map((r, idx) => idx === i ? { ...r, platformLabel: e.target.value } : r))}
                      />
                      <Input
                        type="number" placeholder="売上額" className="w-24" value={row.amount}
                        onChange={e => setEditSalesRows(editSalesRows.map((r, idx) => idx === i ? { ...r, amount: e.target.value } : r))}
                      />
                      <Input
                        type="number" placeholder="女子給" className="w-24" value={row.reward}
                        onChange={e => setEditSalesRows(editSalesRows.map((r, idx) => idx === i ? { ...r, reward: e.target.value } : r))}
                      />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                        <Checkbox
                          checked={row.isDailyPayment}
                          onCheckedChange={v => setEditSalesRows(editSalesRows.map((r, idx) => idx === i ? { ...r, isDailyPayment: !!v } : r))}
                        />
                        日払い済み
                      </label>
                      <Button size="icon" variant="ghost" onClick={() => setEditSalesRows(editSalesRows.filter((_, idx) => idx !== i))}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm" variant="outline"
                  onClick={() => setEditSalesRows([...editSalesRows, { date: editTarget?.from ?? '', platformLabel: '手入力', amount: '', reward: '', isDailyPayment: false }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />行を追加
                </Button>
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-xs text-muted-foreground font-normal">追加項目（ドリンクバックなど・マイナス値で控除も可）</Label>
                {editCustomItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="項目名（例: ドリンクバック）" value={item.label}
                      onChange={e => setEditCustomItems(editCustomItems.map((it, idx) => idx === i ? { ...it, label: e.target.value } : it))}
                    />
                    <Input
                      type="number" className="w-28" placeholder="金額" value={item.amount}
                      onChange={e => setEditCustomItems(editCustomItems.map((it, idx) => idx === i ? { ...it, amount: e.target.value } : it))}
                    />
                    <Button size="icon" variant="ghost" onClick={() => setEditCustomItems(editCustomItems.filter((_, idx) => idx !== i))}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setEditCustomItems([...editCustomItems, { label: '', amount: '' }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" />項目を追加
                </Button>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground font-normal">表示設定</Label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={editForm.show_sales_total} onCheckedChange={v => setEditForm({ ...editForm, show_sales_total: !!v })} />
                  売上合計を通知書に載せる
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={editForm.show_reward_rate} onCheckedChange={v => setEditForm({ ...editForm, show_reward_rate: !!v })} />
                  報酬率を通知書に載せる
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditTarget(null)}>キャンセル</Button>
                <Button onClick={saveEdit} disabled={editSaving}>{editSaving ? '保存中...' : '保存'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
