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

interface Slot { id: string; date: string; start_time: string; end_time: string; notes: string | null; rooms: { name: string } | null }
interface Application { vacant_slot_id: string; status: string }

interface Props {
  slots: Slot[]
  myApplications: Application[]
  castId: string
  storeId: string
}

export function CastVacantSlots({ slots, myApplications: initial, castId, storeId }: Props) {
  const [applications, setApplications] = useState(initial)
  const supabase = createClient()

  function getStatus(slotId: string) {
    return applications.find(a => a.vacant_slot_id === slotId)?.status ?? null
  }

  async function apply(slotId: string) {
    const { error } = await supabase.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castId })
    if (error) { toast.error('申請に失敗しました'); return }
    setApplications([...applications, { vacant_slot_id: slotId, status: 'pending' }])
    toast.success('申請しました')
    const slot = slots.find(s => s.id === slotId)
    const { data: admins } = await supabase.from('users').select('id').eq('store_id', storeId).eq('role', 'admin')
    if (admins?.length && slot) {
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          title: '空き枠申請が届きました',
          body: `${format(new Date(slot.date), 'M/d(E)', { locale: ja })} ${slot.start_time.slice(0, 5)}〜${slot.end_time.slice(0, 5)} への申請`,
          link: '/admin/vacant-slots',
        }))
      )
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>空き枠一覧</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>時間</TableHead>
              <TableHead>ルーム</TableHead>
              <TableHead>備考</TableHead>
              <TableHead className="text-right">申請</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">公開中の空き枠はありません</TableCell></TableRow>
            )}
            {slots.map(slot => {
              const status = getStatus(slot.id)
              return (
                <TableRow key={slot.id}>
                  <TableCell>{format(new Date(slot.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{slot.start_time.slice(0, 5)} 〜 {slot.end_time.slice(0, 5)}</TableCell>
                  <TableCell>{slot.rooms?.name ?? '—'}</TableCell>
                  <TableCell>{slot.notes ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {status === 'approved' && <Badge>承認済み</Badge>}
                    {status === 'rejected' && <Badge variant="destructive">却下</Badge>}
                    {status === 'pending' && <Badge variant="secondary">申請中</Badge>}
                    {!status && <Button size="sm" onClick={() => apply(slot.id)}>申請する</Button>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
