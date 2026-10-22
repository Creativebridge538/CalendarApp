'use client'

import { Fragment, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { addDays, format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/ui/pagination'
import { Switch } from '@/components/ui/switch'
import { TimeSelect } from '@/components/ui/time-select'
import { ShiftCalendar } from '@/components/shifts/shift-calendar'
import { Plus, Check, X, ChevronDown, Trash2, Loader2 } from 'lucide-react'
import { dispatchPush } from '@/lib/push'
import { describeNotifySlotsResult, type NotifySlotsResultDescription } from '@/lib/vacant-slot-notification'
import { describeOperationPushResult } from '@/lib/push-dispatch'
import { broadcastVacantSlotsChanged } from '@/lib/vacant-slot-broadcast'
import { vacantSlotRpcErrorMessage, publishToggleToast } from '@/lib/vacant-slot-errors'
import { usePagination } from '@/hooks/use-pagination'
import { resolveRequestedRange, formatTimeRange, isValidTimeOfDay } from '@/lib/vacant-slot-request-time'
import { isVacantSlotEnded } from '@/lib/vacant-slot-window'
import { nowJST } from '@/lib/jst'

// 申請行の取得列（サーバー側の初期取得・作成直後・公開切替後の再取得で同じ形にする）
const APPLICATION_SELECT = 'id, status, cast_id, shift_id, requested_start_time, requested_end_time, cast:users!vacant_slot_applications_cast_id_fkey(display_name)'

interface Application {
  id: string; status: string; cast_id: string; shift_id: string | null
  requested_start_time: string | null; requested_end_time: string | null
  cast: { display_name: string | null } | null
}
interface Slot {
  id: string; date: string; start_time: string; end_time: string; notes: string | null; is_published: boolean
  room_id: string | null; area_id: string | null; capacity: number
  rooms: { name: string } | null
  areas: { name: string } | null
  vacant_slot_applications: Application[]
}

interface Props {
  slots: Slot[]
  rooms: { id: string; name: string; area_id: string | null; capacity: number | null }[]
  areas: { id: string; name: string }[]
  storeId: string
  locationMode: string
  areaLabel: string
  roomLabel: string
}

export function VacantSlotManager({ slots: initialSlots, rooms, areas, storeId, locationMode, areaLabel, roomLabel }: Props) {
  const [slots, setSlots] = useState(initialSlots)
  const [open, setOpen] = useState(false)
  const [dateCalendarOpen, setDateCalendarOpen] = useState(false)
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', capacity: '1' })
  const [creating, setCreating] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [notifyResult, setNotifyResult] = useState<NotifySlotsResultDescription | null>(null)
  const [lastNotify, setLastNotify] = useState<{ notified_count: number; already_sent: boolean } | null>(null)
  const [retryingPush, setRetryingPush] = useState(false)
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null)
  const [savingAppId, setSavingAppId] = useState<string | null>(null)
  const supabase = createClient()
  const { page, setPage, pageSize, setPageSize, totalPages, paged, totalItems } = usePagination(slots)

  const filteredRooms = locationMode === 'area_and_room' && form.area_id
    ? rooms.filter(r => r.area_id === form.area_id)
    : rooms
  const selectedRoom = rooms.find(r => r.id === form.room_id)

  function locationText(slot: Slot): string {
    if (locationMode === 'area_only') return slot.areas?.name ?? '—'
    if (locationMode === 'area_and_room') return [slot.areas?.name, slot.rooms?.name].filter(Boolean).join(' / ') || '—'
    return slot.rooms?.name ?? '—'
  }

  // 同じルーム・日時に既に提出済み/確定シフトがある場合、空き枠作成前に確認する
  async function hasExistingShift(roomId: string, date: string, startTime: string, endTime: string) {
    const prevDay = format(addDays(new Date(`${date}T00:00:00`), -1), 'yyyy-MM-dd')
    const nextDay = format(addDays(new Date(`${date}T00:00:00`), 1), 'yyyy-MM-dd')
    const { data } = await supabase.from('shifts').select('id, date, start_time, end_time')
      .eq('store_id', storeId).eq('room_id', roomId).in('status', ['submitted', 'confirmed'])
      .gte('date', prevDay).lte('date', nextDay)
    if (!data) return false

    const toRange = (d: string, s: string, e: string) => {
      const start = new Date(`${d}T${s}`)
      let end = new Date(`${d}T${e}`)
      if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
      return [start.getTime(), end.getTime()] as const
    }
    const [newStart, newEnd] = toRange(date, startTime, endTime)
    return data.some(s => {
      const [start, end] = toRange(s.date, s.start_time.slice(0, 5), s.end_time.slice(0, 5))
      return newStart < end && start < newEnd
    })
  }

  async function handleCreate() {
    // 開始=終了は24時間枠として扱わず、無効な空き枠として作成前に拒否する
    // （終了<開始は日またぎ枠として許可、終了>開始は同日枠として許可）
    if (form.start_time === form.end_time) {
      toast.error('開始時刻と終了時刻に同じ時刻は指定できません')
      return
    }
    // time型のカラムへ24:00以上・不正な時刻を送らない（翌日は00:00〜05:00等の通常時刻で指定する）
    if (!isValidTimeOfDay(form.start_time) || !isValidTimeOfDay(form.end_time)) {
      toast.error('時刻は00:00〜23:45の範囲で指定してください（翌日にまたがる場合は終了時刻を開始より前にしてください）')
      return
    }
    const capacity = Math.max(1, parseInt(form.capacity) || 1)
    if (selectedRoom?.capacity != null && capacity > selectedRoom.capacity) {
      toast.error(`この${roomLabel}の定員は${selectedRoom.capacity}人です`)
      return
    }
    if (form.room_id) {
      const conflict = await hasExistingShift(form.room_id, form.date, form.start_time, form.end_time)
      if (conflict && !confirm('この時間帯には既に提出済み・確定済みのシフトがあります。シフトが提出されていますが、空き枠を追加しますか？')) return
    }

    setCreating(true)
    // 空き枠の作成と、キャストへの通知は分離されている（通知は管理者が「空き枠をまとめて通知」ボタンで
    // 任意のタイミングで送る）。ここでは空き枠の作成のみを行い、通知は一切作成・送信しない。
    const { data: created, error } = await supabase.rpc('create_vacant_slot', {
      p_date: form.date, p_start_time: form.start_time, p_end_time: form.end_time,
      p_area_id: (locationMode === 'area_only' || locationMode === 'area_and_room') ? (form.area_id || undefined) : undefined,
      p_room_id: form.room_id || undefined, p_notes: form.notes || undefined, p_capacity: capacity,
    })
    setCreating(false)
    if (error) { toast.error(vacantSlotRpcErrorMessage(error, '登録に失敗しました', roomLabel)); return }
    const { slot_id: slotId } = created as { slot_id: string }

    setOpen(false)
    setForm({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', capacity: '1' })
    const { data: newSlot, error: fetchError } = await supabase.from('vacant_slots')
      .select(`*, rooms(name), areas(name), vacant_slot_applications(${APPLICATION_SELECT})`).eq('id', slotId).single()
    if (fetchError || !newSlot) {
      toast.warning('空き枠は登録しました。一覧の更新に失敗したため、ページを再読み込みしてください')
    } else {
      setSlots(prev => [newSlot, ...prev.filter(s => s.id !== newSlot.id)])
      toast.success('空き枠を登録しました（キャストへの通知は未送信です。通知する場合は「空き枠をまとめて通知」を押してください）')
    }
  }

  function showNotifyResult(result: NotifySlotsResultDescription) {
    if (result.level === 'warning') toast.warning(result.message, { duration: 5000 })
    else toast.success(result.message, { duration: 5000 })
    setNotifyResult(result)
  }

  // 公開中の空き枠を対象に、同店舗の有効なキャストへまとめて通知する（空き枠の作成とは別操作）。
  // 1回目はp_force無し（既定false）で呼ぶ。直前に同じ公開中の空き枠の組み合わせへ送信済みなら、
  // サーバーは新規作成せず「送信済み」を返すだけなので、ここで「もう一度通知しますか？」と
  // 明示的に確認してから、確認が取れた場合だけp_force=trueで再送する（空き枠を編集しなくても
  // 意図的な再送ができる）。通常の連打・通信再試行は、サーバー側の直近5秒ガード（p_forceの値に
  // よらず適用）で防がれる。
  // アプリ内通知の結果とPush配信の結果は、別々のポップアップで即座に切り替えて表示すると、
  // 先に出た方を読み切る前に変わってしまい「送信できなかった」と誤認されうるため、
  // 両方が確定してから1つの結果としてまとめて表示する（ボタン下に常時表示も残す）
  async function handleNotifySlots() {
    // v18レビュー対応（Push不具合③）: is_publishedだけでなく、キャスト画面と同じ終了時刻判定
    // （日またぎ対応）も満たす枠が無ければ、サーバーへ問い合わせる前に止める（UXの事前チェック。
    // 実際の判定・通知作成の可否はnotify_vacant_slots側のSQLで最終的に決まる）
    if (!slots.some(s => s.is_published && !isVacantSlotEnded(s, nowJST()))) {
      toast.error('通知できる公開中の空き枠がありません')
      return
    }
    if (!confirm('公開中の空き枠について、キャストへ通知しますか？')) return
    setNotifying(true)
    setNotifyResult(null)
    setLastNotify(null)
    try {
      const { data, error } = await supabase.rpc('notify_vacant_slots', {})
      if (error) {
        const message = vacantSlotRpcErrorMessage(error, '通知の送信に失敗しました', roomLabel)
        toast.error(message, { duration: 5000 })
        setNotifyResult({ level: 'warning', message, canRetryPush: false })
        return
      }
      let notify = data as { notified_count: number; already_sent: boolean }
      if (notify.already_sent) {
        const resend = confirm(`送信済みです（${notify.notified_count}人へ送信済み）。もう一度通知しますか？`)
        if (!resend) {
          setLastNotify(notify)
          setNotifyResult({ level: 'success', message: `アプリ内通知：直前に送信済みです（${notify.notified_count}人）。再送はしていません`, canRetryPush: false })
          return
        }
        const retry = await supabase.rpc('notify_vacant_slots', { p_force: true })
        if (retry.error) {
          const message = vacantSlotRpcErrorMessage(retry.error, '通知の送信に失敗しました', roomLabel)
          toast.error(message, { duration: 5000 })
          setNotifyResult({ level: 'warning', message, canRetryPush: false })
          return
        }
        notify = retry.data as { notified_count: number; already_sent: boolean }
      }
      setLastNotify(notify)
      const push = await dispatchPush()
      showNotifyResult(describeNotifySlotsResult(notify, push))
    } finally {
      setNotifying(false)
    }
  }

  // アプリ内通知は増やさず、Web Pushの配信だけをやり直す（dispatchPushは「自分が作成した
  // 未送信の通知」だけを対象にする既存の仕組みのため、何度呼んでも通知は増えない）
  async function handleRetryPush() {
    if (!lastNotify) return
    setRetryingPush(true)
    try {
      const push = await dispatchPush()
      showNotifyResult(describeNotifySlotsResult(lastNotify, push))
    } finally {
      setRetryingPush(false)
    }
  }

  async function updateCapacity(slot: Slot, capacity: number) {
    if (capacity === slot.capacity || capacity < 1) return
    const room = rooms.find(r => r.id === slot.room_id)
    if (room?.capacity != null && capacity > room.capacity) {
      toast.error(`この${roomLabel}の定員は${room.capacity}人です`)
      return
    }
    setSavingSlotId(slot.id)
    const { error } = await supabase.from('vacant_slots').update({ capacity }).eq('id', slot.id)
    setSavingSlotId(null)
    if (error) { toast.error('募集人数の更新に失敗しました'); return }
    setSlots(slots.map(s => s.id === slot.id ? { ...s, capacity } : s))
  }

  // 公開/非公開の切替と、紐づく仮予定shiftの削除・復元は1つのDB関数（単一トランザクション）で行う。
  // 途中で失敗した場合（復元できないshiftが1件でもある場合を含む）は空き枠の公開状態も含めて全体が取り消され、
  // 非公開のまま・shiftも何も復元されず、孤立したshiftや不整合は残らない。エラー時は成功toastを出さない
  async function togglePublish(slot: Slot) {
    const nextPublished = !slot.is_published
    setSavingSlotId(slot.id)
    try {
      const { error } = await supabase.rpc('set_vacant_slot_published', { p_slot_id: slot.id, p_published: nextPublished })
      const result = publishToggleToast(error, nextPublished, roomLabel)
      if (result.kind === 'error') { toast.error(result.message); return }
      // 非公開化はキャスト側のRealtime(postgres_changes)には届かないため、「一覧が変わった」ことを別途知らせる（失敗しても切替自体は成功）
      void broadcastVacantSlotsChanged(supabase, storeId)

      // 復元・削除後の申請のshift_idを、DBの実際の状態で取り直す（ローカルで推測しない）
      const { data: freshApps, error: appsError } = await supabase.from('vacant_slot_applications')
        .select(APPLICATION_SELECT).eq('vacant_slot_id', slot.id)
      if (appsError || !freshApps) {
        toast.error('公開状態は更新しましたが、最新の申請状況の取得に失敗しました。ページを再読み込みしてください')
        setSlots(slots.map(s => s.id === slot.id ? { ...s, is_published: nextPublished } : s))
        return
      }
      setSlots(slots.map(s => s.id === slot.id ? { ...s, is_published: nextPublished, vacant_slot_applications: freshApps } : s))
      toast.success(result.message)
    } finally {
      setSavingSlotId(null)
    }
  }

  async function deleteSlot(slot: Slot) {
    if (!confirm('この空き枠を削除しますか？申請中の仮予定もあわせて削除されます。')) return
    setSavingSlotId(slot.id)
    // 保留中の申請に紐づく仮予定shiftの削除と空き枠の削除は1つのDB関数（単一トランザクション）で行う
    const { error } = await supabase.rpc('delete_vacant_slot', { p_slot_id: slot.id })
    setSavingSlotId(null)
    if (error) { toast.error(vacantSlotRpcErrorMessage(error, '削除に失敗しました', roomLabel)); return }
    setSlots(slots.filter(s => s.id !== slot.id))
    toast.success('空き枠を削除しました')
  }

  // 承認・不承認・承認取消は、申請とshiftの更新を1つのDB関数（単一トランザクション）で行う。
  // 承認上限（同時承認の直列化を含む）・同じルームの確定シフトとの重複・shift確定/新規作成
  // （新規作成したshiftのIDは申請へ保存）・申請の状態更新のどこで失敗しても、全体が取り消される
  // 承認・不承認・承認取消は、申請とshiftの更新を1つのDB関数（単一トランザクション）で行う。
  // 承認上限（同時承認の直列化を含む）・同じルームの確定シフトとの重複・shift確定/新規作成
  // （新規作成したshiftのIDは申請へ保存）・申請の状態更新・キャストへのアプリ内通知（承認/不承認のみ）の
  // どこで失敗しても、全体が取り消される。Web Push（外部処理）だけがコミット後にここで送られる
  async function handleApplication(appId: string, slotId: string, nextStatus: 'approved' | 'rejected' | 'pending') {
    setSavingAppId(appId)
    try {
      const { data, error } = await supabase.rpc('review_vacant_slot_application', { p_application_id: appId, p_next_status: nextStatus })
      if (error || !data) {
        toast.error(error ? vacantSlotRpcErrorMessage(error, '処理に失敗しました', roomLabel) : '処理に失敗しました')
        return
      }
      const updated = data as unknown as { status: string; shift_id: string | null }

      // DBが返した確定後の状態（status・shift_id）をそのまま反映する
      setSlots(prev => prev.map(s => s.id === slotId ? {
        ...s,
        vacant_slot_applications: s.vacant_slot_applications.map(a => a.id === appId ? { ...a, status: updated.status, shift_id: updated.shift_id } : a),
      } : s))
      const successMessage = nextStatus === 'approved' ? '承認しました' : nextStatus === 'rejected' ? '不承認にしました' : '承認を取り消しました'

      // アプリ内通知はDB関数の中で作成済み。Web Pushだけをサーバーが送る（自分が作成した未送信の通知のみ）。
      // 業務処理（承認/不承認）は既に成功しているため、まず結果を表示し、Push配信の結果が分かり次第、
      // 同じトースト（id指定）を更新する。別々のポップアップを連続表示しない（先に出た方が読み切れない問題の対策）
      if (nextStatus !== 'pending') {
        let dismissed = false
        const toastId = toast.success(successMessage, { duration: 5000, onDismiss: () => { dismissed = true } })
        const push = await dispatchPush()
        if (!dismissed) {
          const result = describeOperationPushResult(successMessage, push)
          if (result.level === 'warning') toast.warning(result.message, { id: toastId, duration: 5000 })
          else toast.success(result.message, { id: toastId, duration: 5000 })
        }
      } else {
        toast.success(successMessage)
      }
    } finally {
      setSavingAppId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1.5">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle>空き枠管理</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline" onClick={handleNotifySlots}
              disabled={notifying || !slots.some(s => s.is_published && !isVacantSlotEnded(s, nowJST()))}
            >
              {notifying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              空き枠をまとめて通知
            </Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />空き枠追加</Button>
          </div>
        </div>
        {notifyResult && (
          <div className="flex items-center justify-end gap-2">
            <p className={`text-sm text-right ${notifyResult.level === 'warning' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {notifyResult.message}
            </p>
            {notifyResult.canRetryPush && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleRetryPush} disabled={retryingPush}>
                {retryingPush ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                プッシュを再送
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>時間</TableHead>
              <TableHead>{locationMode === 'area_only' ? areaLabel : locationMode === 'area_and_room' ? `${areaLabel}/${roomLabel}` : roomLabel}</TableHead>
              <TableHead>定員</TableHead>
              <TableHead>公開</TableHead>
              <TableHead>申請</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">空き枠がありません</TableCell></TableRow>
            )}
            {paged.map(slot => {
              const approvedCount = slot.vacant_slot_applications.filter(a => a.status === 'approved').length
              const isFull = approvedCount >= slot.capacity
              const slotSaving = savingSlotId === slot.id
              return (
              <Fragment key={slot.id}>
                <TableRow>
                  <TableCell>{format(new Date(slot.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{formatTimeRange(slot.start_time, slot.start_time, slot.end_time)}</TableCell>
                  <TableCell>{locationText(slot)}</TableCell>
                  <TableCell>
                    <Input
                      key={slot.capacity} type="number" min="1" defaultValue={slot.capacity}
                      className="w-16 h-8" disabled={slotSaving}
                      onBlur={e => updateCapacity(slot, Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch checked={slot.is_published} disabled={slotSaving} onCheckedChange={() => togglePublish(slot)} />
                  </TableCell>
                  <TableCell className="space-x-1">
                    <Badge variant={isFull ? 'default' : 'outline'}>承認 {approvedCount}/{slot.capacity}</Badge>
                    {slot.vacant_slot_applications.filter(a => a.status === 'pending').length > 0 && (
                      <Badge variant="outline">{slot.vacant_slot_applications.filter(a => a.status === 'pending').length} 件待ち</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => deleteSlot(slot)} disabled={slotSaving} aria-label="削除">
                      {slotSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {slot.vacant_slot_applications.map(app => {
                  const appSaving = savingAppId === app.id
                  const appRange = resolveRequestedRange(app, slot)
                  return (
                  <TableRow key={app.id} className={app.status === 'pending' ? 'bg-primary/10' : ''}>
                    <TableCell colSpan={3} className="pl-8 text-sm">
                      申請: {app.cast?.display_name ?? '—'}
                      <span className="text-muted-foreground"> （{formatTimeRange(slot.start_time, appRange.start_time, appRange.end_time)}）</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={app.status === 'approved' ? 'default' : app.status === 'rejected' ? 'destructive' : 'outline'}>
                        {app.status === 'approved' ? '承認済み' : app.status === 'rejected' ? '不承認' : '保留中'}
                      </Badge>
                    </TableCell>
                    <TableCell colSpan={2} className="text-right space-x-1">
                      {app.status !== 'approved' && (
                        <Button size="sm" variant="outline" className="text-positive h-7" disabled={appSaving || (app.status === 'pending' && isFull)}
                          onClick={() => handleApplication(app.id, slot.id, 'approved')}>
                          {appSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}承認
                        </Button>
                      )}
                      {app.status === 'approved' && (
                        <Button size="sm" variant="outline" className="h-7" disabled={appSaving}
                          onClick={() => handleApplication(app.id, slot.id, 'pending')}>
                          {appSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}承認を取消
                        </Button>
                      )}
                      {app.status !== 'rejected' && (
                        <Button size="sm" variant="destructive" className="h-7" disabled={appSaving}
                          onClick={() => handleApplication(app.id, slot.id, 'rejected')}>
                          {appSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <X className="h-3 w-3 mr-1" />}不承認
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  )
                })}
              </Fragment>
              )
            })}
          </TableBody>
        </Table>
        <Pagination
          page={page} totalPages={totalPages} pageSize={pageSize} totalItems={totalItems}
          onPageChange={setPage} onPageSizeChange={setPageSize}
        />
      </CardContent>

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setDateCalendarOpen(false) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>空き枠追加</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label required>日付</Label>
              <button
                type="button"
                onClick={() => setDateCalendarOpen(o => !o)}
                className="w-full flex items-center justify-between rounded-md border bg-background px-3 min-h-11 text-sm"
              >
                {form.date ? format(new Date(`${form.date}T00:00:00`), 'yyyy年M月d日(E)', { locale: ja }) : '日付を選択'}
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${dateCalendarOpen ? 'rotate-180' : ''}`} />
              </button>
              {dateCalendarOpen && (
                <div className="rounded-md border p-2">
                  <ShiftCalendar
                    shifts={[]}
                    selectedDates={form.date ? new Set([form.date]) : undefined}
                    onDayClick={d => { setForm({ ...form, date: format(d, 'yyyy-MM-dd') }); setDateCalendarOpen(false) }}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>開始</Label><TimeSelect value={form.start_time} onChange={v => setForm({ ...form, start_time: v })} maxHour={23} /></div>
              <div className="space-y-1.5">
                <Label>終了{form.end_time < form.start_time && <span className="text-muted-foreground font-normal">（翌日）</span>}</Label>
                <TimeSelect value={form.end_time} onChange={v => setForm({ ...form, end_time: v })} maxHour={23} />
              </div>
            </div>
            {form.start_time === form.end_time && (
              <p className="text-xs text-destructive">開始時刻と終了時刻に同じ時刻は指定できません</p>
            )}
            <div className="space-y-1.5">
              <Label>募集人数</Label>
              <Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} />
              {selectedRoom?.capacity != null && (
                <p className="text-xs text-muted-foreground">この{roomLabel}の定員は{selectedRoom.capacity}人です</p>
              )}
            </div>
            {(locationMode === 'area_only' || locationMode === 'area_and_room') && areas.length > 0 && (
              <div className="space-y-1.5">
                <Label>{areaLabel}</Label>
                <Select value={form.area_id || 'none'} onValueChange={v => setForm({ ...form, area_id: v === 'none' ? '' : (v ?? ''), room_id: '' })}>
                  <SelectTrigger>
                    <SelectValue placeholder={areaLabel}>
                      {form.area_id ? (areas.find(a => a.id === form.area_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(locationMode === 'room' || (locationMode === 'area_and_room' && form.area_id)) && filteredRooms.length > 0 && (
              <div className="space-y-1.5">
                <Label>{roomLabel}</Label>
                <Select value={form.room_id || 'none'} onValueChange={v => setForm({ ...form, room_id: v === 'none' ? '' : (v ?? '') })}>
                  <SelectTrigger>
                    <SelectValue placeholder="選択（任意）">
                      {form.room_id ? filteredRooms.find(r => r.id === form.room_id)?.name : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {filteredRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5"><Label>備考</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button onClick={handleCreate} disabled={!form.date || form.start_time === form.end_time || creating}>
                {creating && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}登録
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
