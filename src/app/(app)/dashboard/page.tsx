import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, FileEdit } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') {
    return <AdminDashboard storeId={profile.store_id!} />
  }

  return <CastDashboard userId={user.id} />
}

async function AdminDashboard({ storeId }: { storeId: string }) {
  const supabase = await createClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const [{ count: pendingShifts }, { count: pendingRequests }, { data: todayShifts }] =
    await Promise.all([
      supabase.from('shifts').select('*', { count: 'exact', head: true })
        .eq('store_id', storeId).eq('status', 'submitted'),
      supabase.from('shift_modification_requests').select('shifts!inner(store_id)', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('shifts.store_id', storeId),
      supabase.from('shifts')
        .select('*, cast:users!shifts_cast_id_fkey(display_name), rooms(name)')
        .eq('store_id', storeId)
        .eq('date', today)
        .eq('status', 'confirmed')
        .order('start_time'),
    ])

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">未確定シフト</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingShifts ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">要確認</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">修正申請</CardTitle>
            <FileEdit className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pendingRequests ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">未処理</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">本日のシフト</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{todayShifts?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">確定済み</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            本日のシフト — {format(new Date(), 'M月d日(E)', { locale: ja })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!todayShifts?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">本日のシフトはありません</p>
          ) : (
            <div className="space-y-2">
              {todayShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">
                      {(shift.cast as { display_name: string | null } | null)?.display_name ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}
                      {shift.rooms && ` ／ ${(shift.rooms as { name: string }).name}`}
                    </p>
                  </div>
                  <Badge variant="outline">確定</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

async function CastDashboard({ userId }: { userId: string }) {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, store_id')
    .eq('id', userId)
    .single()

  const now = new Date()

  const [{ data: upcomingShifts }, { data: reward }] = profile?.store_id
    ? await Promise.all([
        supabase.from('shifts')
          .select('*, rooms(name)')
          .eq('cast_id', userId)
          .gte('date', format(now, 'yyyy-MM-dd'))
          .in('status', ['submitted', 'confirmed'])
          .order('date')
          .limit(5),
        supabase.from('reward_calculations')
          .select('total_reward, is_finalized')
          .eq('cast_id', userId)
          .eq('period_year', now.getFullYear())
          .eq('period_month', now.getMonth() + 1)
          .single(),
      ])
    : [{ data: null }, { data: null }]

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">
        こんにちは、{profile?.display_name ?? 'さん'}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今月の報酬</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {reward ? `¥${Number(reward.total_reward).toLocaleString()}` : '未計算'}
            </div>
            {reward && (
              <Badge variant={reward.is_finalized ? 'default' : 'secondary'} className="mt-1">
                {reward.is_finalized ? '確定済み' : '暫定'}
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">直近のシフト</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{upcomingShifts?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">件</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">直近のシフト</CardTitle>
        </CardHeader>
        <CardContent>
          {!upcomingShifts?.length ? (
            <p className="text-sm text-muted-foreground text-center py-6">シフトがありません</p>
          ) : (
            <div className="space-y-2">
              {upcomingShifts.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">
                      {format(new Date(shift.date), 'M月d日(E)', { locale: ja })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}
                      {shift.rooms && ` ／ ${(shift.rooms as { name: string }).name}`}
                    </p>
                  </div>
                  <Badge variant={shift.status === 'confirmed' ? 'default' : 'secondary'}>
                    {shift.status === 'confirmed' ? '確定' : '提出済み'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
