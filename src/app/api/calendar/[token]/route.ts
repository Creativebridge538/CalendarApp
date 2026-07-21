import { NextResponse } from 'next/server'
import { format, addDays, subDays } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildIcsCalendar } from '@/lib/ics'

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) return NextResponse.json({ error: 'invalid token' }, { status: 400 })

  const admin = createAdminClient()

  const { data: user } = await admin.from('users')
    .select('id, display_name, store_id')
    .eq('calendar_token', token)
    .single()

  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: store } = await admin.from('stores').select('name').eq('id', user.store_id ?? '').maybeSingle()

  const today = new Date()
  const from = format(subDays(today, 30), 'yyyy-MM-dd')
  const to = format(addDays(today, 180), 'yyyy-MM-dd')

  const { data: shifts } = await admin.from('shifts')
    .select('id, date, start_time, end_time, status, notes, rooms(name), areas(name)')
    .eq('cast_id', user.id)
    .in('status', ['submitted', 'confirmed'])
    .gte('date', from)
    .lte('date', to)
    .order('date')

  const ics = buildIcsCalendar(
    `${store?.name ?? 'シフト'}（${user.display_name ?? ''}）`,
    (shifts ?? []).map(s => {
      const room = (s.rooms as { name: string } | null)?.name
      const area = (s.areas as { name: string } | null)?.name
      const location = [area, room].filter(Boolean).join(' / ') || undefined
      return {
        uid: s.id,
        date: s.date,
        startTime: s.start_time,
        endTime: s.end_time,
        summary: `${store?.name ?? ''}シフト（${STATUS_LABEL[s.status] ?? s.status}）`,
        description: s.notes ?? undefined,
        location,
      }
    })
  )

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="shifts.ics"',
      'Cache-Control': 'no-cache',
    },
  })
}
