'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Check, X } from 'lucide-react'
import { sendPushNotification } from '@/lib/push'

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
  const supabase = createClient()

  async function handleApprove(req: Request) {
    const updateShift: { status: 'submitted'; date?: string; start_time?: string; end_time?: string } = { status: 'submitted' }
    if (req.new_date) updateShift.date = req.new_date
    if (req.new_start_time) updateShift.start_time = req.new_start_time
    if (req.new_end_time) updateShift.end_time = req.new_end_time

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('shift_modification_requests').update({
        status: 'approved', reviewed_at: new Date().toISOString(),
      }).eq('id', req.id),
      supabase.from('shifts').update(updateShift).eq('id', req.shift_id),
    ])
    if (e1 || e2) { toast.error('承認に失敗しました'); return }
    setRequests(requests.filter(r => r.id !== req.id))
    toast.success('承認しました')
    const title = 'シフト修正申請が承認されました'
    const body = req.shifts ? `${format(new Date(req.shifts.date), 'M/d(E)', { locale: ja })} のシフト修正申請` : null
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
    if (error || statusError) { toast.error('却下に失敗しました'); return }
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
              {requests.map(req => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium">{req.shifts?.cast?.display_name ?? '—'}</TableCell>
                  <TableCell>
                    <p>{req.shifts ? format(new Date(req.shifts.date), 'M/d(E)', { locale: ja }) : '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {req.shifts?.start_time.slice(0, 5)} 〜 {req.shifts?.end_time.slice(0, 5)}
                    </p>
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
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" className="text-positive" onClick={() => handleApprove(req)}>
                      <Check className="h-3.5 w-3.5 mr-1" />承認
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(req); setRejectReason('') }}>
                      <X className="h-3.5 w-3.5 mr-1" />却下
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
