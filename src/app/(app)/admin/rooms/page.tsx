import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { RoomList } from '@/components/rooms/room-list'

export default async function RoomsPage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
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
