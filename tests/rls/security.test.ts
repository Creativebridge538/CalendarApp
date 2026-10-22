import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createTestUser, getServiceClient, signInAs } from './helpers'

// このスイートはローカルのsupabase(supabase start)に対してのみ実行する想定。
// RLSポリシー・トリガーが「越権アクセスを実際に防いでいる」ことを、UIを介さず
// PostgREST層に対して直接証明する。判定はコード目視ではなくここでのpass/failが根拠になる。

const suffix = Date.now()
const storeAId = crypto.randomUUID()
const storeBId = crypto.randomUUID()

let service: SupabaseClient<Database>
let adminA: SupabaseClient<Database>
let castA1: SupabaseClient<Database>
let castA2: SupabaseClient<Database>
let adminB: SupabaseClient<Database>

let castA1Id: string
let castA2Id: string
let roomAId: string
let shiftA1Id: string
let smrA1Id: string

beforeAll(async () => {
  service = getServiceClient()

  const { error: storeErr } = await service.from('stores').insert([
    { id: storeAId, name: `RLSテスト店舗A-${suffix}` },
    { id: storeBId, name: `RLSテスト店舗B-${suffix}` },
  ])
  if (storeErr) throw storeErr

  await createTestUser(service, { email: `admin-a-${suffix}@test.local`, role: 'admin', storeId: storeAId, displayName: '管理者A' })
  castA1Id = await createTestUser(service, { email: `cast-a1-${suffix}@test.local`, role: 'cast', storeId: storeAId, displayName: 'キャストA1' })
  castA2Id = await createTestUser(service, { email: `cast-a2-${suffix}@test.local`, role: 'cast', storeId: storeAId, displayName: 'キャストA2' })
  await createTestUser(service, { email: `admin-b-${suffix}@test.local`, role: 'admin', storeId: storeBId, displayName: '管理者B' })

  const { data: room, error: roomErr } = await service
    .from('rooms')
    .insert({ store_id: storeAId, name: `テストルーム-${suffix}` })
    .select('id')
    .single()
  if (roomErr || !room) throw roomErr
  roomAId = room.id

  const { data: shift, error: shiftErr } = await service
    .from('shifts')
    .insert({
      cast_id: castA1Id, store_id: storeAId, room_id: roomAId,
      date: '2099-01-01', start_time: '18:00', end_time: '23:00', status: 'submitted',
    })
    .select('id')
    .single()
  if (shiftErr || !shift) throw shiftErr
  shiftA1Id = shift.id

  const { data: smr, error: smrErr } = await service
    .from('shift_modification_requests')
    .insert({ shift_id: shiftA1Id, requested_by: castA1Id, new_start_time: '19:00', new_end_time: '24:00', reason: 'テスト' })
    .select('id')
    .single()
  if (smrErr || !smr) throw smrErr
  smrA1Id = smr.id

  await service.from('sales').insert({ cast_id: castA1Id, store_id: storeAId, date: '2099-01-01', platform: 'manual', amount: 10000 })

  adminA = await signInAs(`admin-a-${suffix}@test.local`)
  castA1 = await signInAs(`cast-a1-${suffix}@test.local`)
  castA2 = await signInAs(`cast-a2-${suffix}@test.local`)
  adminB = await signInAs(`admin-b-${suffix}@test.local`)
}, 30000)

afterAll(async () => {
  for (const email of [`admin-a-${suffix}@test.local`, `cast-a1-${suffix}@test.local`, `cast-a2-${suffix}@test.local`, `admin-b-${suffix}@test.local`]) {
    const { data } = await service.from('users').select('id').eq('email', email).maybeSingle()
    if (data) await service.auth.admin.deleteUser(data.id)
  }
  await service.from('stores').delete().in('id', [storeAId, storeBId])
})

describe('cast同士のデータ分離', () => {
  it('キャストA1は同じ店舗のキャストA2のシフトを読めない', async () => {
    const { data } = await castA1.from('shifts').select('id').eq('cast_id', castA2Id)
    expect(data).toEqual([])
  })

  it('キャストA1は自分のシフトは読める', async () => {
    const { data } = await castA1.from('shifts').select('id').eq('id', shiftA1Id)
    expect(data?.length).toBe(1)
  })

  it('キャストA2はキャストA1の報酬明細を読めない', async () => {
    const { data: reward } = await service.from('reward_calculations').insert({
      cast_id: castA1Id, store_id: storeAId, period_year: 2099, period_month: 1, reward_rate: 0.4, total_reward: 100000,
    }).select('id').single()
    const { data } = await castA2.from('reward_calculations').select('id').eq('id', reward!.id)
    expect(data).toEqual([])
  })

  it('キャストA1はキャストA2のシフトを更新できない（0件ヒット）', async () => {
    const { data: a2shifts } = await service.from('shifts').select('id').eq('cast_id', castA2Id)
    // A2のシフトはまだ無いので直接作る
    const { data: shift } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, room_id: roomAId,
      date: '2099-01-02', start_time: '18:00', end_time: '23:00', status: 'submitted',
    }).select('id').single()
    const { data: updated } = await castA1.from('shifts').update({ notes: 'hacked' }).eq('id', shift!.id).select()
    expect(updated).toEqual([])
    void a2shifts
  })

  it('キャストA1はキャストA2の売上を読めない', async () => {
    await service.from('sales').insert({ cast_id: castA2Id, store_id: storeAId, date: '2099-01-01', platform: 'manual', amount: 5000 })
    const { data } = await castA1.from('sales').select('id').eq('cast_id', castA2Id)
    expect(data).toEqual([])
  })
})

describe('店舗（テナント）をまたいだ分離', () => {
  it('店舗Bの管理者は店舗Aのシフトを読めない', async () => {
    const { data } = await adminB.from('shifts').select('id').eq('store_id', storeAId)
    expect(data).toEqual([])
  })

  it('店舗Bの管理者は店舗Aのユーザー一覧を読めない', async () => {
    const { data } = await adminB.from('users').select('id').eq('store_id', storeAId)
    expect(data).toEqual([])
  })

  it('キャストA1は店舗Bのシフトを読めない', async () => {
    const { data } = await castA1.from('shifts').select('id').eq('store_id', storeBId)
    expect(data).toEqual([])
  })
})

describe('権限昇格の防止', () => {
  it('キャストは直接APIで自分のroleをadminに書き換えられない', async () => {
    await castA1.from('users').update({ role: 'admin' }).eq('id', castA1Id)
    const { data } = await service.from('users').select('role').eq('id', castA1Id).single()
    expect(data?.role).toBe('cast')
  })

  it('キャストは直接APIで自分のstore_idを他店舗に書き換えられない', async () => {
    await castA1.from('users').update({ store_id: storeBId }).eq('id', castA1Id)
    const { data } = await service.from('users').select('store_id').eq('id', castA1Id).single()
    expect(data?.store_id).toBe(storeAId)
  })

  it('キャストは自分のシフトを直接確定(confirmed)にできない', async () => {
    const { error } = await castA1.from('shifts').update({ status: 'confirmed' }).eq('id', shiftA1Id)
    const { data } = await service.from('shifts').select('status').eq('id', shiftA1Id).single()
    expect(data?.status).not.toBe('confirmed')
    void error
  })

  it('キャストは自分の修正申請を直接approved扱いにできない', async () => {
    await castA1.from('shift_modification_requests').update({ status: 'approved' }).eq('id', smrA1Id)
    const { data } = await service.from('shift_modification_requests').select('status').eq('id', smrA1Id).single()
    expect(data?.status).toBe('pending')
  })

  it('管理者は自店舗の他ユーザーのreward_rateを正常に変更できる（回帰確認）', async () => {
    const { error } = await adminA.from('users').update({ reward_rate: 0.5 }).eq('id', castA1Id)
    expect(error).toBeNull()
    const { data } = await service.from('users').select('reward_rate').eq('id', castA1Id).single()
    expect(Number(data?.reward_rate)).toBe(0.5)
  })
})

// 同じルーム・同じ時間帯の確定シフトの重複は、ルームの収容人数(rooms.capacity)で判定される
// （migration 20260819070000。収容人数が設定されていればその人数まで重複して確定でき、超えると拒否。
//   収容人数が未設定(NULL)のルームは人数無制限＝重複を許可。店舗設定画面の説明文・シフト管理画面の
//   競合表示も同じ仕様）。そのため、重複を拒否するテストは収容人数を設定したルームで行う。
describe('ダブルブッキング防止（DB制約・ルームの収容人数）', () => {
  async function makeRoom(capacity: number | null) {
    const { data, error } = await service
      .from('rooms')
      .insert({ store_id: storeAId, name: `収容人数テストルーム-${capacity ?? 'null'}-${suffix}`, capacity })
      .select('id')
      .single()
    if (error || !data) throw error
    return data.id
  }
  const confirmedShift = (castId: string, roomId: string, date: string, start: string, end: string) =>
    service.from('shifts').insert({
      cast_id: castId, store_id: storeAId, room_id: roomId, date, start_time: start, end_time: end, status: 'confirmed',
    })

  it('同じ店舗・同じルーム・重なる時間帯の確定シフトは、収容人数を超える場合は作成できない（収容人数1）', async () => {
    const roomId = await makeRoom(1)
    const first = await confirmedShift(castA1Id, roomId, '2099-01-15', '18:00', '23:00')
    expect(first.error).toBeNull()
    const { error } = await confirmedShift(castA2Id, roomId, '2099-01-15', '20:00', '22:00')
    expect(error?.code).toBe('23P01')
  })

  it('収容人数2のルームは2人まで重複して確定でき、3人目は拒否される', async () => {
    const roomId = await makeRoom(2)
    expect((await confirmedShift(castA1Id, roomId, '2099-01-16', '18:00', '23:00')).error).toBeNull()
    expect((await confirmedShift(castA2Id, roomId, '2099-01-16', '19:00', '22:00')).error).toBeNull()
    // 3人目（同一キャストの時間帯重複は別制約(shifts_no_self_overlap)なので、別ユーザーとして店舗の管理者アカウントを使う）
    const { data: adminA } = await service.from('users').select('id').eq('email', `admin-a-${suffix}@test.local`).single()
    const third = await confirmedShift(adminA!.id, roomId, '2099-01-16', '20:00', '21:00')
    expect(third.error?.code).toBe('23P01')
  })

  it('収容人数が未設定(NULL)のルームは人数無制限で、重なる時間帯でも確定シフトを作成できる（正式仕様）', async () => {
    const roomId = await makeRoom(null)
    expect((await confirmedShift(castA1Id, roomId, '2099-01-17', '18:00', '23:00')).error).toBeNull()
    expect((await confirmedShift(castA2Id, roomId, '2099-01-17', '20:00', '22:00')).error).toBeNull()
  })

  it('時間帯が重ならなければ、収容人数1のルームでも作成できる（23:00〜翌01:00、日またぎ）', async () => {
    const roomId = await makeRoom(1)
    expect((await confirmedShift(castA1Id, roomId, '2099-01-18', '18:00', '23:00')).error).toBeNull()
    expect((await confirmedShift(castA2Id, roomId, '2099-01-18', '23:00', '01:00')).error).toBeNull()
  })

  it('日またぎ（23:00〜翌01:00）の確定シフトと、翌日側（00:00〜02:00）の確定シフトの重なりも、収容人数1では拒否される', async () => {
    const roomId = await makeRoom(1)
    expect((await confirmedShift(castA1Id, roomId, '2099-01-19', '23:00', '01:00')).error).toBeNull()
    const { error } = await confirmedShift(castA2Id, roomId, '2099-01-20', '00:00', '02:00')
    expect(error?.code).toBe('23P01')
  })
})
