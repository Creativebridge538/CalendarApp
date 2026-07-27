// ダミーデータ投入スクリプト
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function addDays(base, n) {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

const today = new Date().toISOString().split('T')[0]

;(async () => {
  // 1. 店舗作成
  console.log('店舗作成...')
  const { data: store, error: storeErr } = await supabase
    .from('stores').insert({ name: 'Club Stella' }).select().single()
  if (storeErr) { console.error(storeErr); process.exit(1) }
  console.log('  店舗ID:', store.id)

  // 2. 店舗設定
  await supabase.from('store_settings').insert({
    store_id: store.id, deadline_type: 'monthly', deadline_day: 25, require_approval_after_deadline: true
  })

  // 3. 管理者アカウント作成
  console.log('管理者作成...')
  const { data: adminAuth } = await supabase.auth.admin.createUser({
    email: 'admin@stella.com', password: 'password123', email_confirm: true
  })
  await supabase.from('users').update({
    role: 'admin', store_id: store.id, display_name: '店長', is_active: true, login_id: 'admin'
  }).eq('id', adminAuth.user.id)
  console.log('  admin@stella.com / password123 (ユーザーID: admin)')

  // 4. キャスト5人作成
  console.log('キャスト作成...')
  const castData = [
    { email: 'rin@stella.com',    login_id: 'rin',    display_name: 'りん',   real_name: '田中里奈',   phone: '090-1111-2222', reward_rate: 0.40 },
    { email: 'mia@stella.com',    login_id: 'mia',    display_name: 'みあ',   real_name: '鈴木美亜',   phone: '090-3333-4444', reward_rate: 0.42 },
    { email: 'saki@stella.com',   login_id: 'saki',   display_name: 'さき',   real_name: '佐藤咲希',   phone: '090-5555-6666', reward_rate: 0.38 },
    { email: 'hana@stella.com',   login_id: 'hana',   display_name: 'はな',   real_name: '山田花那',   phone: '090-7777-8888', reward_rate: 0.45 },
    { email: 'kotone@stella.com', login_id: 'kotone', display_name: 'ことね', real_name: '伊藤琴音',   phone: '090-9999-0000', reward_rate: 0.40 },
  ]
  const castIds = []
  for (const c of castData) {
    const { data: au } = await supabase.auth.admin.createUser({
      email: c.email, password: 'password123', email_confirm: true
    })
    await supabase.from('users').update({
      role: 'cast', store_id: store.id,
      display_name: c.display_name, real_name: c.real_name,
      phone: c.phone, reward_rate: c.reward_rate, is_active: true, login_id: c.login_id
    }).eq('id', au.user.id)
    castIds.push(au.user.id)
    console.log(`  ${c.display_name} (${c.email} / ID: ${c.login_id})`)
  }

  // 5. ルーム作成
  console.log('ルーム作成...')
  const { data: rooms } = await supabase.from('rooms').insert([
    { store_id: store.id, name: 'VIPルーム A', capacity: 6, is_active: true },
    { store_id: store.id, name: 'VIPルーム B', capacity: 4, is_active: true },
    { store_id: store.id, name: 'カウンター',   capacity: 8, is_active: true },
  ]).select()
  console.log('  ', rooms.map(r => r.name).join(', '))

  // 6. シフト投入（過去2週間〜今後2週間）
  console.log('シフト投入...')
  const shifts = []
  const statuses = ['confirmed', 'confirmed', 'confirmed', 'submitted', 'draft']
  for (let day = -14; day <= 14; day++) {
    const date = addDays(today, day)
    // 各日にランダムで2〜4人のキャストをシフト
    const shuffled = [...castIds].sort(() => Math.random() - 0.5).slice(0, 2 + (day % 3 === 0 ? 2 : 1))
    shuffled.forEach((castId, i) => {
      const roomId = rooms[i % rooms.length].id
      const status = day < 0 ? 'confirmed' : statuses[Math.floor(Math.random() * statuses.length)]
      shifts.push({
        cast_id: castId, store_id: store.id, room_id: roomId,
        date, start_time: '18:00:00', end_time: '23:00:00',
        status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
      })
    })
  }
  const { error: shiftErr } = await supabase.from('shifts').insert(shifts)
  if (shiftErr) console.error('シフトエラー:', shiftErr.message)
  else console.log(`  ${shifts.length}件投入`)

  // 7. 売上データ（過去30日）
  console.log('売上データ投入...')
  const sales = []
  for (let day = -30; day <= 0; day++) {
    const date = addDays(today, day)
    castIds.forEach(castId => {
      if (Math.random() > 0.4) {
        sales.push({
          cast_id: castId, store_id: store.id, date,
          amount: Math.floor((50000 + Math.random() * 150000) / 1000) * 1000,
          created_by: adminAuth.user.id,
        })
      }
    })
  }
  const { error: salesErr } = await supabase.from('sales').insert(sales)
  if (salesErr) console.error('売上エラー:', salesErr.message)
  else console.log(`  ${sales.length}件投入`)

  // 8. 空き枠
  console.log('空き枠投入...')
  const slots = []
  for (let day = 1; day <= 7; day++) {
    slots.push({
      store_id: store.id, room_id: rooms[0].id,
      date: addDays(today, day),
      start_time: '20:00:00', end_time: '23:00:00',
      is_published: true, created_by: adminAuth.user.id,
      notes: '急募：ヘルプ募集中',
    })
  }
  const { error: slotErr } = await supabase.from('vacant_slots').insert(slots)
  if (slotErr) console.error('空き枠エラー:', slotErr.message)
  else console.log(`  ${slots.length}件投入`)

  console.log('\n完了！')
  console.log('ログイン: ユーザーID admin / password123')
  console.log('キャスト: ユーザーID rin 〜 kotone / password123')
})()
