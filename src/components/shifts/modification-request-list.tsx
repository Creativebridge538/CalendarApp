'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { TimeSelect } from '@/components/ui/time-select'
import { ShiftCalendar } from '@/components/shifts/shift-calendar'
import { Check, X, ChevronDown, Pencil, Ban } from 'lucide-react'
import { sendPushNotification } from '@/lib/push'
import { usePagination } from '@/hooks/use-pagination'

interface Request {
  id: string
  shift_id: string
  requested_by: string
  reason: string
  new_date: string | null
  new_start_time: string | null
  new_end_time: string | null
  status: string
  created_at: string
  shifts: {
    date: string
    start_time: string
    end_time: string
    cast: { display_name: string | null } | null
  } | null
}

export function ModificationRequestList({ requests: initialRequests }: { requests: Request[] }) {
  const [requests, setRequests] = useState(initialRequests)
  const [rejectTarget, setRejectTarget] = useState<Request | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approveTarget, setApproveTarget] = useState<Request | null>(null)
  const [approveForm, setApproveForm] = useState({ date: '', start_time: '18:00', end_time: '23:00' })
  const [dateCalendarOpen, setDateCalendarOpen] = useState(false)
  const supabase = createClient()
  const searchParams = useSearchParams()
  const highlightShiftId = searchParams.get('shift')
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(requests)

  // シフト管理からのリンクで来た場合、該当申請があるページへ自動で移動する
  useEffect(() => {
    if (!highlightShiftId) return
    const index = requests.findIndex(r => r.shift_id === highlightShiftId)
    if (index >= 0) setPage(Math.floor(index / pageSize) + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightShiftId])

  function openApprove(req: Request) {
    setApproveTarget(req)
    setApproveForm({
      date: req.new_date ?? req.shifts?.date ?? '',
      start_time: (req.new_start_time ?? req.shifts?.start_time ?? '18:00:00').slice(0, 5),
      end_time: (req.new_end_time ?? req.shifts?.end_time ?? '23:00:00').slice(0, 5),
    })
  }

  async function handleApprove() {
    if (!approveTarget) return
    const req = approveTarget
    const updateShift = {
      status: 'confirmed' as const, confirmed_at: new Date().toISOString(),
      date: approveForm.date, start_time: approveForm.start_time, end_time: approveForm.end_time,
    }

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('shift_modification_requests').update({
        status: 'approved', reviewed_at: new Date().toISOString(),
      }).eq('id', req.id),
      supabase.from('shifts').update(updateShift).eq('id', req.shift_id),
    ])
    if (e1 || e2) {
      // 23P01 = exclusion_violation。変更後の時間帯に別の確定シフトが割り込んでいた場合
      toast.error((e2 as { code?: string } | null)?.code === '23P01' ? 'この時間帯は同じルームに既に確定シフトがあります' : '承認に失敗しました')
      return
    }
    setRequests(requests.filter(r => r.id !== req.id))
    toast.success('承認して確定しました')
    setApproveTarget(null)
    const title = 'シフト修正申請が承認されました'
    const body = `${format(new Date(`${approveForm.date}T00:00:00`), 'M/d(E)', { locale: ja })} ${approveForm.start_time}〜${approveForm.end_time} のシフト修正申請`
    await supabase.from('notifications').insert({ user_id: req.requested_by, title, body, link: '/cast/shifts' })
    sendPushNotification(req.requested_by, title, body, '/cast/shifts')
  }

  async function handleApproveAndCancel(req: Request) {
    if (!confirm('この申請を承認し、シフトをキャンセル（削除）しますか？この操作は元に戻せません。')) return
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('shift_modification_requests').update({
        status: 'approved', reviewed_at: new Date().toISOString(),
      }).eq('id', req.id),
      supabase.from('shifts').delete().eq('id', req.shift_id),
    ])
    if (e1 || e2) { toast.error('処理に失敗しました'); return }
    setRequests(requests.filter(r => r.id !== req.id))
    toast.success('承認してシフトをキャンセルしました')
    const title = 'シフトがキャンセルされました'
    const body = req.shifts
      ? `${format(new Date(req.shifts.date), 'M/d(E)', { locale: ja })} ${req.shifts.start_time.slice(0, 5)}〜${req.shifts.end_time.slice(0, 5)} のシフトがキャンセルされました`
      : 'シフトがキャンセルされました'
    await supabase.from('notifications').insert({ user_id: req.requested_by, title, body, link: '/cast/shifts' })
    sendPushNotification(req.requested_by, title, body, '/cast/shifts')
  }

  async function handleReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    const [{ error }, { error: statusError }] = await Promise.all([
      supabase.from('shift_modification_requests').update({
        status: 'rejected', reject_reason: rejectReason, reviewed_at: new Date().toISOString(),
      }).eq('id', rejectTarget.id),
      supabase.from('shifts').update({ status: 'confirmed' }).eq('id', rejectTarget.shift_id),
    ])
    if (error || statusError) {
      // 23P01 = exclusion_violation。元の時間帯に別の確定シフトが割り込んでいた場合
      toast.error(statusError?.code === '23P01' ? 'この時間帯は同じルームに既に確定シフトがあります' : '却下に失敗しました')
      return
    }
    setRequests(requests.filter(r => r.id !== rejectTarget.id))
    toast.success('却下しました')
    const title = 'シフト修正申請が却下されました'
    const body = `却下理由: ${rejectReason}`
    await supabase.from('notifications').insert({ user_id: rejectTarget.requested_by, title, body, link: '/cast/shifts' })
    sendPushNotification(rejectTarget.requested_by, title, body, '/cast/shifts')
    setRejectTarget(null)
    setRejectReason('')
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>修正申請管理</CardTitle>
          <p className="text-sm text-muted-foreground">未処理: {requests.length} 件</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キャスト</TableHead>
                <TableHead>現在のシフト</TableHead>
                <TableHead>変更後</TableHead>
                <TableHead>理由</TableHead>
                <TableHead>申請日</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    未処理の申請はありません
                  </TableCell>
                </TableRow>
              )}
              {paged.map(req => (
                <TableRow key={req.id} className={req.shift_id === highlightShiftId ? 'bg-primary/5 ring-1 ring-primary/30' : undefined}>
                  <TableCell className="font-medium">{req.shifts?.cast?.display_name ?? '—'}</TableCell>
                  <TableCell>
                    <p>{req.shifts ? format(new Date(req.shifts.date), 'M/d(E)', { locale: ja }) : '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.shifts?.start_time.slice(0, 5)} 〜 {req.shifts?.end_time.slice(0, 5)}
                    </p>
                    <Link href={`/admin/shifts?shift=${req.shift_id}`} className="text-[10px] text-primary underline underline-offset-2">
                      シフト管理で見る
                    </Link>
                  </TableCell>
                  <TableCell>
                    {req.new_date && <p>{format(new Date(req.new_date), 'M/d(E)', { locale: ja })}</p>}
                    {(req.new_start_time || req.new_end_time) && (
                      <p className="text-xs text-muted-foreground">
                        {req.new_start_time?.slice(0, 5)} 〜 {req.new_end_time?.slice(0, 5)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{req.reason}</TableCell>
                  <TableCell>{format(new Date(req.created_at), 'M/d', { locale: ja })}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="outline" className="text-positive" onClick={() => openApprove(req)}>
                      <Check className="h-3.5 w-3.5 mr-1" />承認して確定
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => handleApproveAndCancel(req)}>
                      <Ban className="h-3.5 w-3.5 mr-1" />承認してキャンセル
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(req); setRejectReason('') }}>
                      <X className="h-3.5 w-3.5 mr-1" />却下
                    </Button>
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

      <Dialog open={!!approveTarget} onOpenChange={open => { if (!open) { setApproveTarget(null); setDateCalendarOpen(false) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>承認内容を確認・編集</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {approveTarget && (
              <p className="text-sm text-muted-foreground">
                {approveTarget.shifts?.cast?.display_name ?? '—'}／申請理由: {approveTarget.reason}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>日付</Label>
              <button
                type="button"
                onClick={() => setDateCalendarOpen(o => !o)}
                className="w-full flex items-center justify-between rounded-md border bg-background px-3 min-h-11 text-sm"
              >
                {approveForm.date ? format(new Date(`${approveForm.date}T00:00:00`), 'yyyy年M月d日(E)', { locale: ja }) : '日付を選択'}
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${dateCalendarOpen ? 'rotate-180' : ''}`} />
              </button>
              {dateCalendarOpen && (
                <div className="rounded-md border p-2">
                  <ShiftCalendar
                    shifts={[]}
                    selectedDates={approveForm.date ? new Set([approveForm.date]) : undefined}
                    onDayClick={d => { setApproveForm({ ...approveForm, date: format(d, 'yyyy-MM-dd') }); setDateCalendarOpen(false) }}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>開始</Label>
                <TimeSelect value={approveForm.start_time} onChange={v => setApproveForm({ ...approveForm, start_time: v })} />
              </div>
              <div className="space-y-1.5">
                <Label>終了</Label>
                <TimeSelect value={approveForm.end_time} onChange={v => setApproveForm({ ...approveForm, end_time: v })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveTarget(null)}>キャンセル</Button>
              <Button onClick={handleApprove} disabled={!approveForm.date}>
                <Pencil className="h-3.5 w-3.5 mr-1" />この内容で承認して確定
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) setRejectTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>却下理由</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>理由 *</Label>
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="却下理由を入力してください" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectTarget(null)}>キャンセル</Button>
              <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>却下する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
