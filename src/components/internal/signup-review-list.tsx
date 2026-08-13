'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, X } from 'lucide-react'

interface SignupRequest {
  id: string
  store_name: string
  contact_name: string
  contact_email: string
  phone: string | null
  message: string | null
  status: string
  reject_reason: string | null
  reviewed_at: string | null
  created_at: string
}

const STATUS_LABEL: Record<string, string> = { approved: '承認済み', rejected: '却下' }
const STATUS_VARIANT: Record<string, 'default' | 'destructive'> = { approved: 'default', rejected: 'destructive' }

export function SignupReviewList({ pending: initialPending, recent: initialRecent }: { pending: SignupRequest[]; recent: SignupRequest[] }) {
  const [pending, setPending] = useState(initialPending)
  const [recent, setRecent] = useState(initialRecent)
  const [processing, setProcessing] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<SignupRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  async function handleApprove(req: SignupRequest) {
    if (!confirm(`「${req.store_name}」を承認しますか？店舗と管理者アカウントが作成され、${req.contact_email} 宛に招待メールが送信されます。`)) return
    setProcessing(req.id)
    const res = await fetch(`/api/internal/store-signups/${req.id}/approve`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setProcessing(null)
    if (!res.ok) { toast.error(data.error ?? '承認に失敗しました'); return }
    setPending(pending.filter(p => p.id !== req.id))
    setRecent([{ ...req, status: 'approved', reviewed_at: new Date().toISOString() }, ...recent])
    toast.success(`${req.store_name} を承認しました`)
  }

  async function handleReject() {
    if (!rejectTarget) return
    setProcessing(rejectTarget.id)
    const res = await fetch(`/api/internal/store-signups/${rejectTarget.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reject_reason: rejectReason || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    setProcessing(null)
    if (!res.ok) { toast.error(data.error ?? '却下に失敗しました'); return }
    setPending(pending.filter(p => p.id !== rejectTarget.id))
    setRecent([{ ...rejectTarget, status: 'rejected', reject_reason: rejectReason || null, reviewed_at: new Date().toISOString() }, ...recent])
    toast.success('却下しました')
    setRejectTarget(null)
    setRejectReason('')
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>未処理の申込 — {pending.length} 件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">未処理の申込はありません</p>
          )}
          {pending.map(req => (
            <div key={req.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <p className="font-medium">{req.store_name}</p>
                  <p className="text-sm text-muted-foreground">{req.contact_name} ／ {req.contact_email}{req.phone && ` ／ ${req.phone}`}</p>
                </div>
                <span className="text-xs text-muted-foreground">{format(new Date(req.created_at), 'yyyy/M/d(E) HH:mm', { locale: ja })}</span>
              </div>
              {req.message && <p className="text-sm bg-muted rounded p-2 whitespace-pre-wrap">{req.message}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => handleApprove(req)} disabled={processing === req.id}>
                  <Check className="h-3.5 w-3.5 mr-1" />承認する
                </Button>
                <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(req); setRejectReason('') }} disabled={processing === req.id}>
                  <X className="h-3.5 w-3.5 mr-1" />却下する
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">処理履歴</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recent.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b last:border-b-0">
                <div className="min-w-0">
                  <span className="font-medium">{req.store_name}</span>
                  <span className="text-muted-foreground ml-2">{req.contact_email}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {req.reviewed_at && (
                    <span className="text-xs text-muted-foreground">{format(new Date(req.reviewed_at), 'M/d', { locale: ja })}</span>
                  )}
                  <Badge variant={STATUS_VARIANT[req.status] ?? 'default'}>{STATUS_LABEL[req.status] ?? req.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) setRejectTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>却下理由（任意）</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>理由</Label>
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="任意入力" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectTarget(null)}>キャンセル</Button>
              <Button variant="destructive" onClick={handleReject} disabled={processing === rejectTarget?.id}>却下する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
