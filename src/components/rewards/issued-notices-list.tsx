'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/ui/pagination'
import { Download } from 'lucide-react'
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
}

interface Props {
  notices: Notice[]
  casts: { id: string; display_name: string | null }[]
}

export function IssuedNoticesList({ notices, casts }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterCast, setFilterCast] = useState('all')
  const [filterFrom, setFilterFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [filterTo, setFilterTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [downloading, setDownloading] = useState(false)

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
    const targets = filtered.filter(n => selected.has(n.id))
    if (targets.length === 0) { toast.error('ダウンロードする通知書を選択してください'); return }

    setDownloading(true)
    const res = await fetch('/api/rewards/notices/bulk-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notices: targets.map(n => ({ cast_id: n.castId, from: n.from, to: n.to, issued_at: n.createdAt })),
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>発行済み支払通知書</CardTitle>
          <Button size="sm" onClick={handleBulkDownload} disabled={downloading || selected.size === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />
            {downloading ? 'ダウンロード中...' : `選択した${selected.size}件を一括ダウンロード`}
          </Button>
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
                <TableCell className="font-medium">{n.castName}</TableCell>
                <TableCell className="text-muted-foreground">{n.castRealName ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{n.body}</TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(n.createdAt), 'yyyy/M/d', { locale: ja })}
                </TableCell>
                <TableCell className="text-right">
                  <PaymentNoticeButton castId={n.castId} from={n.from} to={n.to} label="開く" />
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
    </Card>
  )
}
