'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { sendPushNotification } from '@/lib/push'
import type { Database } from '@/lib/supabase/database.types'

interface Slot {
  id: string; date: string; start_time: string; end_time: string; notes: string | null
  room_id: string | null; area_id: string | null; capacity: number
  rooms: { name: string } | null; areas: { name: string } | null
  vacant_slot_applications: { status: string }[]
}
interface Application { vacant_slot_id: string; status: string; shift_id: string | null }

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
  const supabase = createClient()

  // 管理者側で定員変更・非公開化された空き枠を、リロードなしにリアルタイムで反映する
  useEffect(() => {
    const channel = supabase
      .channel(`cast-vacant-slots-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vacant_slots', filter: `store_id=eq.${storeId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string }
            setSlots(prev => prev.filter(s => s.id !== oldRow.id))
            return
          }
          const row = payload.new as Database['public']['Tables']['vacant_slots']['Row']
          const today = format(new Date(), 'yyyy-MM-dd')
          if (!row.is_published || row.date < today) {
            setSlots(prev => prev.filter(s => s.id !== row.id))
            return
          }
          setSlots(prev => {
            const existing = prev.find(s => s.id === row.id)
            if (!existing) {
              return [...prev, {
                id: row.id, date: row.date, start_time: row.start_time, end_time: row.end_time,
                notes: row.notes, room_id: row.room_id, area_id: row.area_id, capacity: row.capacity,
                rooms: null, areas: null, vacant_slot_applications: [],
              }]
            }
            return prev.map(s => s.id === row.id ? {
              ...s, date: row.date, start_time: row.start_time, end_time: row.end_time,
              notes: row.notes, room_id: row.room_id, capacity: row.capacity,
            } : s)
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  function getStatus(slotId: string) {
    return applications.find(a => a.vacant_slot_id === slotId)?.status ?? null
  }

  async function cancelApplication(slotId: string) {
    const app = applications.find(a => a.vacant_slot_id === slotId)
    const { error } = await supabase.from('vacant_slot_applications').delete()
      .eq('vacant_slot_id', slotId).eq('cast_id', castId)
    if (error) { toast.error('取消に失敗しました'); return }
    if (app?.shift_id) await supabase.from('shifts').delete().eq('id', app.shift_id)
    setApplications(applications.filter(a => a.vacant_slot_id !== slotId))
    toast.success('申請を取り消しました')
  }

  async function apply(slotId: string) {
    const slot = slots.find(s => s.id === slotId)
    if (!slot) return
    if (isFull(slot)) { toast.error('この空き枠は満員です'); return }

    // 申請した時点でキャストのカレンダーにも仮予定（提出済み扱い）として反映する
    const { data: shift, error: shiftError } = await supabase.from('shifts').insert({
      cast_id: castId, store_id: storeId, room_id: slot.room_id ?? null,
      date: slot.date, start_time: slot.start_time, end_time: slot.end_time,
      status: 'submitted', notes: '空き枠への応募',
    }).select('id').single()
    if (shiftError) { toast.error('申請に失敗しました'); return }

    const { error } = await supabase.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castId, shift_id: shift.id })
    if (error) { toast.error('申請に失敗しました'); await supabase.from('shifts').delete().eq('id', shift.id); return }
    setApplications([...applications, { vacant_slot_id: slotId, status: 'pending', shift_id: shift.id }])
    toast.success('申請しました')
    const { data: admins } = await supabase.from('users').select('id').eq('store_id', storeId).eq('role', 'admin')
    if (admins?.length && slot) {
      const title = '空き枠申請が届きました'
      const body = `${format(new Date(slot.date), 'M/d(E)', { locale: ja })} ${slot.start_time.slice(0, 5)}〜${slot.end_time.slice(0, 5)} への申請`
      await supabase.from('notifications').insert(
        admins.map(a => ({ user_id: a.id, title, body, link: '/admin/vacant-slots' }))
      )
      admins.forEach(a => sendPushNotification(a.id, title, body, '/admin/vacant-slots'))
    }
  }

  function isFull(slot: Slot): boolean {
    return slot.vacant_slot_applications.filter(a => a.status === 'approved').length >= slot.capacity
  }

  function locationText(slot: Slot): string {
    if (locationMode === 'area_only') return slot.areas?.name ?? `${areaLabel}未指定`
    if (locationMode === 'area_and_room') return [slot.areas?.name, slot.rooms?.name].filter(Boolean).join(' / ') || `${roomLabel}未指定`
    return slot.rooms?.name ?? `${roomLabel}未指定`
  }

  // 定員に達した空き枠は、既に自分が申請済みのもの以外は一覧から除外する
  const visibleSlots = slots.filter(slot => !isFull(slot) || getStatus(slot.id) !== null)

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
      <Button size="sm" variant="tonal" className={block ? 'w-full' : undefined} onClick={() => apply(slot.id)}>
        申請する
      </Button>
    )
  }

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
                  <span className="text-sm text-muted-foreground">{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</span>
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
                  <TableCell>{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</TableCell>
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
    </Card>
  )
}
