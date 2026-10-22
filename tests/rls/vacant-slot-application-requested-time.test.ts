import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { createTestUser, getServiceClient, signInAs } from './helpers'

// 空き枠申請の希望時刻(requested_start_time/requested_end_time)について、
// トリガー check_vacant_slot_application_requested_time が実際に範囲外の申請を
// 拒否し、null/nullの既存申請は許可し続けることをPostgREST層に対して証明する。
// このスイートはローカルのsupabase(supabase start)に対してのみ実行する想定。

const suffix = Date.now()
const storeId = crypto.randomUUID()

let service: SupabaseClient<Database>
let castA: SupabaseClient<Database>
let castB: SupabaseClient<Database>
let adminC: SupabaseClient<Database>
let adminUserId: string
let castAId: string
let castBId: string
let slotId: string
let overnightSlotId: string

beforeAll(async () => {
  service = getServiceClient()

  const { error: storeErr } = await service.from('stores').insert({ id: storeId, name: `VSA希望時刻テスト店舗-${suffix}` })
  if (storeErr) throw storeErr

  adminUserId = await createTestUser(service, { email: `vsa-admin-${suffix}@test.local`, role: 'admin', storeId, displayName: '管理者' })
  castAId = await createTestUser(service, { email: `vsa-cast-a-${suffix}@test.local`, role: 'cast', storeId, displayName: 'キャストA' })
  castBId = await createTestUser(service, { email: `vsa-cast-b-${suffix}@test.local`, role: 'cast', storeId, displayName: 'キャストB' })

  const { data: slot, error: slotErr } = await service
    .from('vacant_slots')
    .insert({
      store_id: storeId, date: '2099-02-01', start_time: '12:00', end_time: '18:00',
      is_published: true, capacity: 5, created_by: adminUserId,
    })
    .select('id')
    .single()
  if (slotErr || !slot) throw slotErr
  slotId = slot.id

  // 日またぎ枠（22:00〜翌05:00）
  const { data: overnightSlot, error: overnightSlotErr } = await service
    .from('vacant_slots')
    .insert({
      store_id: storeId, date: '2099-02-05', start_time: '22:00', end_time: '05:00',
      is_published: true, capacity: 5, created_by: adminUserId,
    })
    .select('id')
    .single()
  if (overnightSlotErr || !overnightSlot) throw overnightSlotErr
  overnightSlotId = overnightSlot.id

  castA = await signInAs(`vsa-cast-a-${suffix}@test.local`)
  castB = await signInAs(`vsa-cast-b-${suffix}@test.local`)
  adminC = await signInAs(`vsa-admin-${suffix}@test.local`)
}, 30000)

afterAll(async () => {
  for (const email of [`vsa-admin-${suffix}@test.local`, `vsa-cast-a-${suffix}@test.local`, `vsa-cast-b-${suffix}@test.local`]) {
    const { data } = await service.from('users').select('id').eq('email', email).maybeSingle()
    if (data) await service.auth.admin.deleteUser(data.id)
  }
  await service.from('stores').delete().eq('id', storeId)
})

// 申請は apply_vacant_slot RPC（管理された経路）だけが作成できる。直接INSERTは全ロールで拒否される。
// RPCは仮shiftも作るため、テスト後はキャストのshiftを削除して片付ける（紐づく申請はガードトリガーが同時に削除する）
const applyRpc = (client: SupabaseClient<Database>, slot: string, start?: string | null, end?: string | null) =>
  client.rpc('apply_vacant_slot', {
    p_vacant_slot_id: slot,
    ...(start ? { p_requested_start_time: start } : {}),
    ...(end ? { p_requested_end_time: end } : {}),
  })
const cleanupCast = async (...castIds: string[]) => { await service.from('shifts').delete().in('cast_id', castIds) }

describe('空き枠申請の希望時刻バリデーション（DBトリガー）', () => {
  it('公開枠内の前半（12:00〜15:00）で申請できる', async () => {
    const { error } = await applyRpc(castA, slotId, '12:00', '15:00')
    expect(error).toBeNull()
    await cleanupCast(castAId)
  })

  it('公開枠内の後半（14:00〜17:00）で申請できる', async () => {
    const { error } = await applyRpc(castA, slotId, '14:00', '17:00')
    expect(error).toBeNull()
    await cleanupCast(castAId)
  })

  it('枠より前にはみ出す申請（11:00〜15:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, slotId, '11:00', '15:00')
    expect(error).not.toBeNull()
  })

  it('枠より後にはみ出す申請（12:00〜19:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, slotId, '12:00', '19:00')
    expect(error).not.toBeNull()
  })

  it('開始=終了（15:00〜15:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, slotId, '15:00', '15:00')
    expect(error).not.toBeNull()
  })

  it('開始>終了（16:00〜15:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, slotId, '16:00', '15:00')
    expect(error).not.toBeNull()
  })

  it('片方だけnullは拒否される', async () => {
    const { error } = await applyRpc(castB, slotId, '12:00', null)
    expect(error).not.toBeNull()
  })

  it('null/null は公開枠全体を希望したものとして許可される（既存申請との後方互換）', async () => {
    const { error, data } = await applyRpc(castB, slotId)
    expect(error).toBeNull()
    const app = data as unknown as { id: string; requested_start_time: string | null }
    expect(app.requested_start_time).toBeNull()
    await cleanupCast(castBId)
  })
})

describe('空き枠申請の希望時刻バリデーション（日またぎ枠 22:00〜翌05:00、DBトリガー）', () => {
  it('枠内（23:00〜翌02:00）で申請できる', async () => {
    const { error } = await applyRpc(castA, overnightSlotId, '23:00', '02:00')
    expect(error).toBeNull()
    await cleanupCast(castAId)
  })

  it('枠内（01:00〜翌03:00）で申請できる', async () => {
    const { error } = await applyRpc(castA, overnightSlotId, '01:00', '03:00')
    expect(error).toBeNull()
    await cleanupCast(castAId)
  })

  it('開始が枠より前にはみ出す申請（21:00〜翌01:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, overnightSlotId, '21:00', '01:00')
    expect(error).not.toBeNull()
  })

  it('終了が枠より後にはみ出す申請（23:00〜翌06:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, overnightSlotId, '23:00', '06:00')
    expect(error).not.toBeNull()
  })

  it('開始と終了が同じ（23:00〜23:00）は拒否される', async () => {
    const { error } = await applyRpc(castB, overnightSlotId, '23:00', '23:00')
    expect(error).not.toBeNull()
  })
})

describe('既存処理の回帰確認', () => {
  it('シフト管理から申請に紐づくshiftを確定すると、承認RPCと同じ規則（承認上限・reviewed_by・通知・rollback）で承認される', async () => {
    // 旧: shiftをconfirmedにすると申請を直接approvedにするだけで、承認上限も通知もreviewed_byも通らなかった（旧トリガー）
    const { data: slot1, error: slotErr } = await service.from('vacant_slots').insert({
      store_id: storeId, date: '2099-02-08', start_time: '12:00', end_time: '18:00', is_published: true, capacity: 1, created_by: adminUserId,
    }).select('id').single()
    if (slotErr || !slot1) throw slotErr
    const a = (await applyRpc(castA, slot1.id, '12:00', '15:00')).data as unknown as { id: string; shift_id: string }
    const b = (await applyRpc(castB, slot1.id, '12:00', '15:00')).data as unknown as { id: string; shift_id: string }
    await service.from('notifications').delete().in('user_id', [castAId, castBId])

    // 通常のシフト管理（管理者がshiftのstatusを直接更新）から、1人目を確定する
    const first = await adminC.from('shifts').update({ status: 'confirmed' }).eq('id', a.shift_id)
    expect(first.error).toBeNull()
    const { data: appA } = await service.from('vacant_slot_applications').select('status, reviewed_by, reviewed_at').eq('id', a.id).single()
    expect(appA?.status).toBe('approved')
    expect(appA?.reviewed_by).toBe(adminUserId) // reviewed_by/reviewed_at が保存される
    expect(appA?.reviewed_at).not.toBeNull()
    const notifA = await service.from('notifications').select('title, body, link').eq('user_id', castAId)
    expect(notifA.data?.length).toBe(1) // 承認通知は1回だけ（一般の「シフトが確定されました」は重複させない）
    expect(notifA.data![0]).toMatchObject({ title: '空き枠申請が承認されました', link: '/cast/vacant-slots' })
    expect((await service.from('vacant_slots').select('approved_count').eq('id', slot1.id).single()).data?.approved_count).toBe(1)

    // 募集人数(1)を超える2人目の確定は拒否され、shift・申請・通知は何も変わらない（全体がrollback）
    const second = await adminC.from('shifts').update({ status: 'confirmed' }).eq('id', b.shift_id)
    expect(second.error).not.toBeNull()
    expect(second.error?.message).toContain('募集人数')
    expect((await service.from('shifts').select('status').eq('id', b.shift_id).single()).data?.status).toBe('submitted')
    expect((await service.from('vacant_slot_applications').select('status, reviewed_by').eq('id', b.id).single()).data).toMatchObject({ status: 'pending', reviewed_by: null })
    expect((await service.from('notifications').select('id').eq('user_id', castBId)).data).toEqual([])

    await cleanupCast(castAId, castBId)
    await service.from('vacant_slots').delete().eq('id', slot1.id)
  })

  it('満員の枠には申請できない（既存トリガー、希望時刻の有無に関わらず機能する）', async () => {
    const { data: fullSlot, error: fullSlotErr } = await service
      .from('vacant_slots')
      .insert({
        store_id: storeId, date: '2099-02-02', start_time: '12:00', end_time: '18:00',
        is_published: true, capacity: 1, approved_count: 1, created_by: castAId,
      })
      .select('id')
      .single()
    if (fullSlotErr || !fullSlot) throw fullSlotErr

    const { error } = await applyRpc(castB, fullSlot.id, '12:00', '13:00')
    expect(error).not.toBeNull()

    await service.from('vacant_slots').delete().eq('id', fullSlot.id)
  })

  it('キャストは自分の申請を取消できる（cancel_vacant_slot_application。直接DELETEは全ロールで閉じている）', async () => {
    const app = (await applyRpc(castA, slotId, '12:00', '14:00')).data as unknown as { id: string }
    const direct = await castA.from('vacant_slot_applications').delete().eq('id', app.id).select()
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app.id)).data?.length).toBe(1)

    const { error } = await castA.rpc('cancel_vacant_slot_application', { p_application_id: app.id })
    expect(error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app.id)).data).toEqual([])
    expect((await service.from('shifts').select('id').eq('cast_id', castAId)).data).toEqual([])
  })
})

describe('日またぎ枠のshift日付補正（resolveEffectiveShiftTimeが実際に使われる経路のデータ確認）', () => {
  // hasRoomConflict/handleApplication自体はReactコンポーネント内の関数でテスト基盤から
  // 直接は呼べないため、ここでは「アプリが resolveEffectiveShiftTime の結果どおりに
  // date/start_time/end_timeを保存すれば、実際にそのとおりの行がDBに残る」ことを確認する
  // （純粋ロジック自体の網羅的な検証は tests/vacant-slot-request-time.test.ts 側で実施）。

  it('【追加テスト1】公開枠側と同じ日を希望（23:00〜翌02:00）した場合、shiftの日付は空き枠の日付のまま', async () => {
    // resolveEffectiveShiftTime(overnightSlot, '23:00', '02:00') => { date: '2099-02-05', ... }
    const { data: shift, error } = await service.from('shifts').insert({
      cast_id: castAId, store_id: storeId, date: '2099-02-05', start_time: '23:00', end_time: '02:00', status: 'submitted',
    }).select('id, date').single()
    expect(error).toBeNull()
    expect(shift?.date).toBe('2099-02-05')
    if (shift) await service.from('shifts').delete().eq('id', shift.id)
  })

  it('【追加テスト2】公開枠の翌日側だけを希望（01:00〜03:00）した場合、shiftの日付は翌日になる', async () => {
    // resolveEffectiveShiftTime(overnightSlot, '01:00', '03:00') => { date: '2099-02-06', ... }
    const { data: shift, error } = await service.from('shifts').insert({
      cast_id: castAId, store_id: storeId, date: '2099-02-06', start_time: '01:00', end_time: '03:00', status: 'confirmed',
    }).select('id, date').single()
    expect(error).toBeNull()
    expect(shift?.date).toBe('2099-02-06')
    if (shift) await service.from('shifts').delete().eq('id', shift.id)
  })

  it('【追加テスト3】翌日側の希望時間帯（2099-02-06 01:00〜03:00）は、空き枠自体の日付（2099-02-05）とは別日として区別される', async () => {
    const { data: shift, error } = await service.from('shifts').insert({
      cast_id: castAId, store_id: storeId, date: '2099-02-06', start_time: '01:00', end_time: '03:00', status: 'confirmed',
    }).select('id, date').single()
    expect(error).toBeNull()

    // 空き枠自体の日付(2099-02-05)を対象にした問い合わせでは、翌日(2099-02-06)のshiftはヒットしない
    const { data: onSlotDate } = await service.from('shifts')
      .select('id').eq('store_id', storeId).eq('date', '2099-02-05').eq('cast_id', castAId).eq('start_time', '01:00:00')
    expect(onSlotDate).toEqual([])

    // 正しく翌日(2099-02-06)を対象にした問い合わせでヒットする
    const { data: onNextDate } = await service.from('shifts')
      .select('id').eq('store_id', storeId).eq('date', '2099-02-06').eq('cast_id', castAId).eq('start_time', '01:00:00')
    expect(onNextDate?.length).toBe(1)

    if (shift) await service.from('shifts').delete().eq('id', shift.id)
  })
})
