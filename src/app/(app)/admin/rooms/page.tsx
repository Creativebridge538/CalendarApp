import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RoomList } from '@/components/rooms/room-list'

export default async function RoomsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('role, store_id').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!

  const [{ data: rooms }, { data: areas }, { data: settings }] = await Promise.all([
    supabase.from('rooms').select('*').eq('store_id', storeId).order('name'),
    supabase.from('areas').select('*').eq('store_id', storeId).order('sort_order'),
    supabase.from('store_settings').select('area_label, room_label').eq('store_id', storeId).single(),
  ])

  return (
    <div className="p-6">
      <RoomList
        rooms={rooms ?? []}
        storeId={storeId}
        areas={areas ?? []}
        areaLabel={settings?.area_label ?? 'エリア'}
        roomLabel={settings?.room_label ?? 'ルーム'}
      />
    </div>
  )
}
