'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { TimeSelect } from '@/components/ui/time-select'
import { Loader2 } from 'lucide-react'
import { dispatchPush } from '@/lib/push'
import { describeOperationPushResult } from '@/lib/push-dispatch'
import { isValidRequestedRange, formatTimeRange } from '@/lib/vacant-slot-request-time'
import { isVacantSlotEnded, vacantSlotQueryFromDate } from '@/lib/vacant-slot-window'
import { vacantSlotsChannelName, VACANT_SLOTS_CHANGED_EVENT } from '@/lib/vacant-slot-broadcast'
import { vacantSlotRpcErrorMessage } from '@/lib/vacant-slot-errors'
import { nowJST } from '@/lib/jst'

interface Slot {
  id: string; date: string; start_time: string; end_time: string; notes: string | null
  room_id: string | null; area_id: string | null; capacity: number; approved_count: number
  rooms: { name: string } | null; areas: { name: string } | null
}
interface Application { id: string; vacant_slot_id: string; status: string; shift_id: string | null }

interface Props {
  slots: Slot[]
  myApplications: Application[]
  castId: string
  storeId: string
  locationMode: string
  areaLabel: string
  roomLabel: string
}

export function CastVacantSlots({ slots: initialSlots, myApplications: initial, castId, storeId, locationMode, areaLabel, roomLabel }: Props) {
  const [slots, setSlots] = useState(initialSlots)
  const [applications, setApplications] = useState(initial)
  const [applyTarget, setApplyTarget] = useState<Slot | null>(null)
  const [requestStart, setRequestStart] = useState('')
  const [requestEnd, setRequestEnd] = useState('')
  const [applying, setApplying] = useState(false)
  // 日をまたいで進行中の枠が終了した時点で一覧から外せるよう、現在時刻（日本時間）を1分ごとに更新する
  const [now, setNow] = useState(() => nowJST())
  const supabase = createClient()

  useEffect(() => {
    const timer = setInterval(() => setNow(nowJST()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // 日付・開始時刻の順に並べる（Realtimeで追加された枠も、初期表示と同じ並びで表示する）
  const sortSlots = (list: Slot[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))

  // 一覧と自分の申請を、RLSで絞られた最新の状態（rooms/areasのJOIN付き）に取り直す。
  // Realtimeのpayloadは表示状態の根拠にしない（次の理由）:
  //  ・rooms(name)/areas(name)のJOIN結果が含まれない
  //  ・非公開化＝キャストのRLSでは行が見えなくなる更新は、届かない・遅れて古いイベントとして届くことがある
  //    （再公開の直前に古い「非公開」イベントが届いて、表示済みの枠を消してしまう競合が実際に起きた）
  // そのため、イベントは「取り直す合図」として使い、状態は常にこの取得結果から作る。
  const resync = useCallback(async () => {
    const now = nowJST()
    const [{ data: freshSlots }, { data: freshApps }] = await Promise.all([
      supabase.from('vacant_slots').select('*, rooms(name), areas(name)')
        .eq('store_id', storeId).eq('is_published', true).gte('date', vacantSlotQueryFromDate(now)).order('date'),
      supabase.from('vacant_slot_applications').select('id, vacant_slot_id, status, shift_id').eq('cast_id', castId),
    ])
    if (freshSlots) setSlots(sortSlots(freshSlots.filter(slot => !isVacantSlotEnded(slot, now))))
    if (freshApps) setApplications(freshApps)
  }, [supabase, storeId, castId])

  // 連続して届くイベント（1回の操作で複数のUPDATEが発生する）をまとめて、1回だけ取り直す
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleResync = useCallback(() => {
    if (resyncTimer.current) clearTimeout(resyncTimer.current)
    resyncTimer.current = setTimeout(() => { resyncTimer.current = null; void resync() }, 250)
  }, [resync])

  // 管理者側で追加・定員変更・非公開化・再公開・削除された空き枠と、自分の申請の承認・取消をリロードなしで反映する
  useEffect(() => {
    // ① 空き枠の変更と、管理者からの「一覧が変わった」ブロードキャスト（非公開化は下のpostgres_changesでは確実に届かない）
    const slotsChannel = supabase
      .channel(vacantSlotsChannelName(storeId))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vacant_slots', filter: `store_id=eq.${storeId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            // 削除は取り消せないので即座に消す（その後の取り直しでも同じ結果になる）
            const oldRow = payload.old as { id: string }
            setSlots(prev => prev.filter(s => s.id !== oldRow.id))
          }
          scheduleResync()
        }
      )
      .on('broadcast', { event: VACANT_SLOTS_CHANGED_EVENT }, () => scheduleResync())
      // 購読が確立（再接続を含む）した時点で一度取り直し、初期表示〜購読確立の間・切断中の取りこぼしを回収する
      .subscribe(status => { if (status === 'SUBSCRIBED') scheduleResync() })

    // ② 自分の申請の状態変化（承認・承認取消・不承認・取消）。RLSにより本人の申請だけが届く
    const applicationsChannel = supabase
      .channel(`cast-vacant-slot-applications-${castId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vacant_slot_applications', filter: `cast_id=eq.${castId}` },
        () => scheduleResync()
      )
      .subscribe()

    // ③ 保険: 60秒ごと・タブへ戻ったときに取り直す（イベントの取りこぼしに備える）
    const timer = setInterval(() => { void resync() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void resync() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      if (resyncTimer.current) clearTimeout(resyncTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(slotsChannel)
      supabase.removeChannel(applicationsChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, castId])

  function getStatus(slotId: string) {
    return applications.find(a => a.vacant_slot_id === slotId)?.status ?? null
  }

  async function cancelApplication(slotId: string) {
    const app = applications.find(a => a.vacant_slot_id === slotId)
    if (!app) return
    // 申請の削除と仮予定shiftの削除は1つのDB関数（単一トランザクション）で行う。
    // shiftの削除に失敗した場合は申請の削除も取り消され、片方だけ残ることはない
    const { error } = await supabase.rpc('cancel_vacant_slot_application', { p_application_id: app.id })
    if (error) { toast.error(vacantSlotRpcErrorMessage(error, '取消に失敗しました')); return }
    setApplications(prev => prev.filter(a => a.vacant_slot_id !== slotId))
    toast.success('申請を取り消しました')
  }

  function openApplyDialog(slot: Slot) {
    if (isFull(slot)) { toast.error('この空き枠は満員です'); return }
    setApplyTarget(slot)
    setRequestStart(slot.start_time.slice(0, 5))
    setRequestEnd(slot.end_time.slice(0, 5))
  }

  async function submitApplication() {
    const slot = applyTarget
    if (!slot || applying) return
    if (isFull(slot)) { toast.error('この空き枠は満員です'); setApplyTarget(null); return }
    if (isVacantSlotEnded(slot, nowJST())) {
      toast.error('この空き枠は終了しています')
      setSlots(prev => prev.filter(s => s.id !== slot.id))
      setApplyTarget(null)
      return
    }
    // 24:00以上・不正形式もここで弾く（DBのtime型へ送らない）
    if (!isValidRequestedRange(slot, requestStart, requestEnd)) {
      toast.error('公開されている時間の範囲内で、開始時刻より後の終了時刻を指定してください')
      return
    }

    setApplying(true)
    try {
      // 申請した時点でキャストのカレンダーにも仮予定（提出済み扱い）として反映する。
      // 希望した部分時間帯のみをshiftへ反映し（希望開始が公開枠の開始時刻より前=翌日側ならshiftの日付も翌日へ補正）、
      // shift作成→申請作成は1つのDB関数（単一トランザクション）で行う。途中で失敗しても孤立したshiftは残らない
      // 申請・shift作成・同店舗の管理者へのアプリ内通知は、すべて同じDB関数の同一トランザクション内で行われる
      // （キャストはRLSにより同店舗の管理者をusersから検索できないため、通知の宛先もDB関数が決める）
      const { data, error } = await supabase.rpc('apply_vacant_slot', {
        p_vacant_slot_id: slot.id, p_requested_start_time: requestStart, p_requested_end_time: requestEnd,
      })
      if (error) {
        toast.error(error.code === '23505' ? 'この空き枠には既に申請しています' : vacantSlotRpcErrorMessage(error, '申請に失敗しました'))
        return
      }
      if (!data) { toast.error('申請に失敗しました'); return }
      const app = data as unknown as { id: string; shift_id: string | null }
      setApplications(prev => [...prev.filter(a => a.vacant_slot_id !== slot.id), { id: app.id, vacant_slot_id: slot.id, status: 'pending', shift_id: app.shift_id }])
      setApplyTarget(null)

      // Web Push（外部処理）だけをコミット後に送る。宛先・文面はブラウザに渡さず、サーバーが「自分が作成した未送信の通知」を送る。
      // 申請は既に完了しているため、まず結果を表示し、Push配信の結果が分かり次第、同じトースト（id指定）を
      // 更新する（別々のポップアップを連続表示しない）
      const successMessage = '申請しました'
      let dismissed = false
      const toastId = toast.success(successMessage, { duration: 5000, onDismiss: () => { dismissed = true } })
      const push = await dispatchPush()
      if (!dismissed) {
        const result = describeOperationPushResult(successMessage, push)
        if (result.level === 'warning') toast.warning(result.message, { id: toastId, duration: 5000 })
        else toast.success(result.message, { id: toastId, duration: 5000 })
      }
    } finally {
      setApplying(false)
    }
  }

  function isFull(slot: Slot): boolean {
    return slot.approved_count >= slot.capacity
  }

  function locationText(slot: Slot): string {
    if (locationMode === 'area_only') return slot.areas?.name ?? `${areaLabel}未指定`
    if (locationMode === 'area_and_room') return [slot.areas?.name, slot.rooms?.name].filter(Boolean).join(' / ') || `${roomLabel}未指定`
    return slot.rooms?.name ?? `${roomLabel}未指定`
  }

  // 定員に達した空き枠は、既に自分が申請済みのもの以外は一覧から除外する
  // 終了済みの空き枠は募集一覧から除外する（日またぎ枠は翌日の終了時刻まで残る）
  const visibleSlots = slots.filter(slot => !isVacantSlotEnded(slot, now) && (!isFull(slot) || getStatus(slot.id) !== null))

  function StatusControl({ slot, block }: { slot: Slot; block?: boolean }) {
    const status = getStatus(slot.id)
    if (status === 'approved') return <Badge>承認済み</Badge>
    if (status === 'rejected') return <Badge variant="destructive">不承認</Badge>
    if (status === 'pending') {
      return (
        <div className={`flex items-center gap-2 ${block ? 'w-full' : 'justify-end'}`}>
          <Badge variant="secondary">申請中</Badge>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => cancelApplication(slot.id)}>
            取消
          </Button>
        </div>
      )
    }
    if (isFull(slot)) return <Badge variant="outline">満員</Badge>
    return (
      <Button size="sm" variant="tonal" className={block ? 'w-full' : undefined} onClick={() => openApplyDialog(slot)}>
        申請する
      </Button>
    )
  }

  const applyRangeValid = applyTarget ? isValidRequestedRange(applyTarget, requestStart, requestEnd) : false

  return (
    <Card elevated className="rounded-none border-x-0 md:rounded-lg md:border-x">
      <CardHeader className="px-4 md:px-6"><CardTitle>空き枠一覧</CardTitle></CardHeader>
      <CardContent className="px-0 md:px-6">
        {visibleSlots.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">公開中の空き枠はありません</p>
        )}

        {/* モバイル: カードレイアウト */}
        {visibleSlots.length > 0 && (
          <div className="md:hidden space-y-2 px-4">
            {visibleSlots.map(slot => (
              <div key={slot.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{format(new Date(slot.date), 'M月d日(E)', { locale: ja })}</span>
                  <span className="text-sm text-muted-foreground">{formatTimeRange(slot.start_time, slot.start_time, slot.end_time)}</span>
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span>{locationText(slot)}</span>
                  {slot.capacity > 1 && (
                    <>
                      <span>・</span>
                      <span>募集{slot.capacity}人</span>
                    </>
                  )}
                  {slot.notes && (
                    <>
                      <span>・</span>
                      <span>{slot.notes}</span>
                    </>
                  )}
                </div>
                <div className="pt-1">
                  <StatusControl slot={slot} block />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* デスクトップ: テーブル */}
        {visibleSlots.length > 0 && (
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>時間</TableHead>
                <TableHead>{locationMode === 'area_only' ? areaLabel : locationMode === 'area_and_room' ? `${areaLabel}/${roomLabel}` : roomLabel}</TableHead>
                <TableHead>募集人数</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="text-right">申請</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSlots.map(slot => (
                <TableRow key={slot.id}>
                  <TableCell>{format(new Date(slot.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{formatTimeRange(slot.start_time, slot.start_time, slot.end_time)}</TableCell>
                  <TableCell>{locationText(slot)}</TableCell>
                  <TableCell>{slot.capacity}人</TableCell>
                  <TableCell>{slot.notes ?? '—'}</TableCell>
                  <TableCell className="text-right"><StatusControl slot={slot} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!applyTarget} onOpenChange={o => { if (!o && !applying) setApplyTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>空き枠へ申請</DialogTitle></DialogHeader>
          {applyTarget && (
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                公開時間: {formatTimeRange(applyTarget.start_time, applyTarget.start_time, applyTarget.end_time)}
                <br />この範囲内で、希望する開始・終了時刻を選択してください。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>開始{requestStart < applyTarget.start_time.slice(0, 5) && <span className="text-muted-foreground font-normal">（翌日）</span>}</Label>
                  <TimeSelect value={requestStart} onChange={setRequestStart} maxHour={23} />
                </div>
                <div className="space-y-1.5">
                  <Label>終了{requestEnd < applyTarget.start_time.slice(0, 5) && <span className="text-muted-foreground font-normal">（翌日）</span>}</Label>
                  <TimeSelect value={requestEnd} onChange={setRequestEnd} maxHour={23} />
                </div>
              </div>
              {!applyRangeValid && (
                <p className="text-xs text-destructive">公開時間の範囲内で、開始時刻より後の終了時刻を指定してください</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setApplyTarget(null)} disabled={applying}>キャンセル</Button>
                <Button onClick={submitApplication} disabled={!applyRangeValid || applying}>
                  {applying && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}申請する
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
