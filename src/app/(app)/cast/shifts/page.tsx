import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CastShiftView } from '@/components/shifts/cast-shift-view'
import { Badge } from '@/components/ui/badge'

export default async function CastShiftsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id, display_name, calendar_token').eq('id', user.id).single()
  if (!profile?.store_id) {
    return <div className="p-6 text-sm text-muted-foreground">店舗が割り当てられていません。管理者にお問い合わせください。</div>
  }

  const now = new Date()

  const [{ data: shifts }, { data: rooms }, { data: areas }, { data: settings }, { data: checklistItems }, { data: reward }] = await Promise.all([
    supabase.from('shifts').select('*, rooms(name), areas(name)').eq('cast_id', user.id).order('date', { ascending: false }).limit(60),
    supabase.from('rooms').select('id, name, area_id').eq('store_id', profile.store_id).eq('is_active', true),
    supabase.from('areas').select('id, name').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('store_settings').select('*').eq('store_id', profile.store_id).single(),
    supabase.from('shift_checklist_items').select('id, label, item_type, options').eq('store_id', profile.store_id).eq('is_active', true).order('sort_order'),
    supabase.from('reward_calculations').select('total_reward, is_finalized')
      .eq('cast_id', user.id).eq('period_year', now.getFullYear()).eq('period_month', now.getMonth() + 1).single(),
  ])

  return (
    <div className="px-0 py-2 md:p-6 space-y-2">
      <div className="px-4 md:px-0 flex items-center justify-between">
        <h1 className="text-base font-bold">こんにちは、{profile.display_name ?? 'さん'}</h1>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">今月の報酬</span>
          <span className="font-bold">{reward ? `¥${Number(reward.total_reward).toLocaleString()}` : '未計算'}</span>
          {reward && <Badge variant={reward.is_finalized ? 'default' : 'secondary'}>{reward.is_finalized ? '確定' : '暫定'}</Badge>}
        </div>
      </div>
      <CastShiftView
        shifts={(shifts ?? []).map(s => ({ ...s, checklist_answers: (s.checklist_answers ?? {}) as Record<string, boolean | string> }))}
        rooms={rooms ?? []}
        areas={areas ?? []}
        castId={user.id}
        storeId={profile.store_id}
        settings={settings}
        userId={user.id}
        checklistItems={checklistItems ?? []}
        calendarToken={profile.calendar_token}
      />
    </div>
  )
}
