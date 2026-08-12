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

describe('ダブルブッキング防止（DB制約）', () => {
  it('同じ店舗・同じルーム・重なる時間帯の確定シフトは作成できない', async () => {
    await service.from('shifts').update({ status: 'confirmed' }).eq('id', shiftA1Id) // 18:00-23:00 2099-01-01
    const { error } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, room_id: roomAId,
      date: '2099-01-01', start_time: '20:00', end_time: '22:00', status: 'confirmed',
    })
    expect(error?.code).toBe('23P01')
  })

  it('時間帯が重ならなければ同じルームでも作成できる（23:00〜翌01:00、日またぎ）', async () => {
    const { error } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, room_id: roomAId,
      date: '2099-01-01', start_time: '23:00', end_time: '01:00', status: 'confirmed',
    })
    expect(error).toBeNull()
  })
})
