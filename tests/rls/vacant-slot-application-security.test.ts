import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { spawn } from 'node:child_process'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { formatTimeRange } from '@/lib/vacant-slot-request-time'
import { createTestUser, getAnonClient, getServiceClient, holdSlotAdvisoryLock, localDbAvailable, runLocalSql, signInAs } from './helpers'

// 空き枠申請のRLS（キャストの用途別ポリシー）と、申請・承認・却下・承認取消・公開切替・削除の
// RPC（単一トランザクション）が、実際にPostgREST層で意図どおり動くことを証明する。
// このスイートはローカルのsupabase(supabase start)に対してのみ実行する想定
// （helpers.tsがローカル以外のURLを拒否する）。

type SlotInsert = Database['public']['Tables']['vacant_slots']['Insert']

const suffix = Date.now()
const storeAId = crypto.randomUUID()
const storeBId = crypto.randomUUID()

let service: SupabaseClient<Database>
let adminA: SupabaseClient<Database>
let adminB: SupabaseClient<Database>
let castA1: SupabaseClient<Database>
let castA2: SupabaseClient<Database>
let castB1: SupabaseClient<Database>
let ownerA: SupabaseClient<Database>
let adminAId: string
let adminA2Id: string
let adminBId: string
let castA1Id: string
let castA2Id: string
let castB1Id: string
let castInactiveId: string

/** 日本時間の今日を基準にoffset日ずらした 'yyyy-MM-dd' */
function jstDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + offsetDays * 86400000))
}

async function makeSlot(over: Partial<SlotInsert> & { store?: 'A' | 'B' } = {}): Promise<string> {
  const { store = 'A', ...rest } = over
  const { data, error } = await service.from('vacant_slots').insert({
    store_id: store === 'A' ? storeAId : storeBId,
    created_by: store === 'A' ? adminAId : adminBId,
    date: '2099-03-01', start_time: '12:00', end_time: '18:00', is_published: true, capacity: 5,
    ...rest,
  }).select('id').single()
  if (error || !data) throw error
  return data.id
}

type ApplicationRow = Database['public']['Tables']['vacant_slot_applications']['Row']
// apply_vacant_slot / review_vacant_slot_application は、申請行の全列に、通知に関する
// notified_count（通知を作成した人数。宛先のuuidは返さない）を加えたjsonbを返す
type NotifyingResult = ApplicationRow & {
  notified_count: number
}

/** キャストがRPCで申請する（アプリと同じ経路）。戻り値のdataは申請行＋通知情報 */
async function applyAs(client: SupabaseClient<Database>, slotId: string, start: string | null = null, end: string | null = null) {
  const { data, error } = await client.rpc('apply_vacant_slot', {
    p_vacant_slot_id: slotId,
    ...(start ? { p_requested_start_time: start } : {}),
    ...(end ? { p_requested_end_time: end } : {}),
  })
  return { data: data as unknown as NotifyingResult | null, error }
}

/** 管理者がRPCで承認・不承認・承認取消する（アプリと同じ経路）。戻り値のdataは申請行＋通知情報 */
async function reviewAs(client: SupabaseClient<Database>, appId: string, status: 'approved' | 'rejected' | 'pending') {
  const { data, error } = await client.rpc('review_vacant_slot_application', { p_application_id: appId, p_next_status: status })
  return { data: data as unknown as NotifyingResult | null, error }
}

async function getApp(id: string) {
  const { data, error } = await service.from('vacant_slot_applications').select('*').eq('id', id).single()
  if (error || !data) throw error
  return data
}

async function shiftsOf(castId: string) {
  const { data } = await service.from('shifts').select('*').eq('cast_id', castId).order('date').order('start_time')
  return data ?? []
}

// ---------------------------------------------------------------------------
// 通知の期待文面。SQL側の整形（to_char / 曜日配列 / 「翌」付与）が、画面表示に使うクライアント側の整形
// （date-fns 'M/d(E)' ja と formatTimeRange）と一致することを、同じ関数で期待値を作って確かめる
// ---------------------------------------------------------------------------
const dateLabel = (d: string) => format(new Date(`${d}T00:00:00`), 'M/d(E)', { locale: ja })
const applyBody = (slotDate: string, slotStart: string, start: string, end: string) => `${dateLabel(slotDate)} ${formatTimeRange(slotStart, start, end)} への申請`
const reviewBody = (slotDate: string, slotStart: string, start: string, end: string) => `${dateLabel(slotDate)} ${formatTimeRange(slotStart, start, end)} の空き枠`
const notifsOf = async (userIds: string[], title?: string) => {
  let q = service.from('notifications').select('user_id, title, body, link').in('user_id', userIds).order('created_at')
  if (title) q = q.eq('title', title)
  return (await q).data ?? []
}

beforeAll(async () => {
  service = getServiceClient()
  const { error: storeErr } = await service.from('stores').insert([
    { id: storeAId, name: `VSAセキュリティ店舗A-${suffix}` },
    { id: storeBId, name: `VSAセキュリティ店舗B-${suffix}` },
  ])
  if (storeErr) throw storeErr

  adminAId = await createTestUser(service, { email: `vss-admin-a-${suffix}@test.local`, role: 'admin', storeId: storeAId, displayName: '管理者A' })
  adminA2Id = await createTestUser(service, { email: `vss-admin-a2-${suffix}@test.local`, role: 'admin', storeId: storeAId, displayName: '管理者A2' })
  adminBId = await createTestUser(service, { email: `vss-admin-b-${suffix}@test.local`, role: 'admin', storeId: storeBId, displayName: '管理者B' })
  castA1Id = await createTestUser(service, { email: `vss-cast-a1-${suffix}@test.local`, role: 'cast', storeId: storeAId, displayName: 'キャストA1' })
  castA2Id = await createTestUser(service, { email: `vss-cast-a2-${suffix}@test.local`, role: 'cast', storeId: storeAId, displayName: 'キャストA2' })
  castInactiveId = await createTestUser(service, { email: `vss-cast-x-${suffix}@test.local`, role: 'cast', storeId: storeAId, displayName: '無効キャスト' })
  await service.from('users').update({ is_active: false }).eq('id', castInactiveId)
  await createTestUser(service, { email: `vss-owner-a-${suffix}@test.local`, role: 'owner', storeId: storeAId, displayName: 'オーナーA' })
  castB1Id = await createTestUser(service, { email: `vss-cast-b1-${suffix}@test.local`, role: 'cast', storeId: storeBId, displayName: 'キャストB1' })

  adminA = await signInAs(`vss-admin-a-${suffix}@test.local`)
  adminB = await signInAs(`vss-admin-b-${suffix}@test.local`)
  castA1 = await signInAs(`vss-cast-a1-${suffix}@test.local`)
  castA2 = await signInAs(`vss-cast-a2-${suffix}@test.local`)
  castB1 = await signInAs(`vss-cast-b1-${suffix}@test.local`)
  ownerA = await signInAs(`vss-owner-a-${suffix}@test.local`)
}, 60000)

// テストごとに、両店舗のシフト・空き枠（申請はカスケード）・ルームを片付けて、他テストへ影響を残さない
afterEach(async () => {
  await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id, castB1Id, castInactiveId, adminAId, adminA2Id, adminBId])
  await service.from('shifts').delete().in('store_id', [storeAId, storeBId])
  await service.from('vacant_slots').delete().in('store_id', [storeAId, storeBId])
  await service.from('rooms').delete().in('store_id', [storeAId, storeBId])
})

afterAll(async () => {
  for (const email of ['admin-a', 'admin-a2', 'admin-b', 'cast-a1', 'cast-a2', 'cast-b1', 'owner-a', 'cast-x'].map(n => `vss-${n}-${suffix}@test.local`)) {
    const { data } = await service.from('users').select('id').eq('email', email).maybeSingle()
    if (data) await service.auth.admin.deleteUser(data.id)
  }
  await service.from('stores').delete().in('id', [storeAId, storeBId])
})

describe('キャストのRLS: 自分の申請を直接書き換えられない', () => {
  it('自分の申請をapprovedへ変更できない（自己承認の拒否）', async () => {
    const slotId = await makeSlot()
    const { data: app, error } = await applyAs(castA1, slotId, '12:00', '15:00')
    expect(error).toBeNull()

    const { data, error: updateErr } = await castA1.from('vacant_slot_applications')
      .update({ status: 'approved' }).eq('id', app!.id).select()
    expect(updateErr !== null || (data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).status).toBe('pending')
  })

  it('requested_start_time/end_time を後から変更できない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')

    const { data, error } = await castA1.from('vacant_slot_applications')
      .update({ requested_start_time: '12:00', requested_end_time: '18:00' }).eq('id', app!.id).select()
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    const after = await getApp(app!.id)
    expect(after.requested_start_time).toBe('12:00:00')
    expect(after.requested_end_time).toBe('15:00:00')
  })

  it('vacant_slot_id を別の枠へ変更できない', async () => {
    const slotId = await makeSlot()
    const otherSlotId = await makeSlot({ date: '2099-03-02' })
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')

    const { data, error } = await castA1.from('vacant_slot_applications')
      .update({ vacant_slot_id: otherSlotId }).eq('id', app!.id).select()
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).vacant_slot_id).toBe(slotId)
  })

  it('shift_id を書き換えられない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data, error } = await castA1.from('vacant_slot_applications')
      .update({ shift_id: null }).eq('id', app!.id).select()
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).shift_id).toBe(app!.shift_id)
  })

  it('status=approvedで直接INSERTして自己承認することもできない', async () => {
    const slotId = await makeSlot()
    const { error } = await castA1.from('vacant_slot_applications').insert({
      vacant_slot_id: slotId, cast_id: castA1Id, status: 'approved',
    })
    expect(error).not.toBeNull()
    const { data } = await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)
    expect(data).toEqual([])
  })

  it('他人名義（cast_id違い）や他人のshiftに紐づけた申請をINSERTできない', async () => {
    const slotId = await makeSlot()
    const { error: asOther } = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castA2Id })
    expect(asOther).not.toBeNull()

    const { data: othersShift } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, date: '2099-03-01', start_time: '12:00', end_time: '13:00', status: 'submitted',
    }).select('id').single()
    const { error: withOthersShift } = await castA1.from('vacant_slot_applications').insert({
      vacant_slot_id: slotId, cast_id: castA1Id, shift_id: othersShift!.id,
    })
    expect(withOthersShift).not.toBeNull()
  })
})

describe('キャストのRLS: 申請できる空き枠の制限', () => {
  it('他店舗の枠へは直接INSERTもRPCも申請できない', async () => {
    const otherStoreSlotId = await makeSlot({ store: 'B' })
    const { error: direct } = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: otherStoreSlotId, cast_id: castA1Id })
    expect(direct).not.toBeNull()
    const { error: viaRpc } = await applyAs(castA1, otherStoreSlotId, '12:00', '15:00')
    expect(viaRpc).not.toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
    const { data } = await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', otherStoreSlotId)
    expect(data).toEqual([])
  })

  it('非公開の枠へは直接INSERTもRPCも申請できない', async () => {
    const unpublishedId = await makeSlot({ is_published: false })
    const { error: direct } = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: unpublishedId, cast_id: castA1Id })
    expect(direct).not.toBeNull()
    const { error: viaRpc } = await applyAs(castA1, unpublishedId, '12:00', '15:00')
    expect(viaRpc).not.toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('他店舗のキャストが、店舗Aの公開中の枠へ申請することもできない', async () => {
    const slotId = await makeSlot({ store: 'A' })
    const { error: direct } = await castB1.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castB1Id })
    expect(direct).not.toBeNull()
    expect((await applyAs(castB1, slotId, '12:00', '15:00')).error).not.toBeNull()
  })

  it('同じ店舗の公開中の枠へは、RPC(apply_vacant_slot)で申請できる。申請テーブルへの直接INSERTは（自店舗・公開中でも）拒否される', async () => {
    const slotId = await makeSlot()
    const direct = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castA1Id })
    expect(direct.error).not.toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
    expect((await applyAs(castA1, slotId, '12:00', '15:00')).error).toBeNull()
  })

  it('他のキャストの申請は参照できない（SELECTは自分の申請のみ）', async () => {
    const slotId = await makeSlot()
    await applyAs(castA2, slotId, '12:00', '15:00')
    const { data } = await castA1.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)
    expect(data).toEqual([])
  })
})

describe('申請の直接DELETE/UPDATE/INSERTは全ロールで閉じ、取消・承認は管理されたRPCだけ', () => {
  it('キャストは自分のpending申請を直接DELETEできない。cancel_vacant_slot_applicationでは申請と仮shiftが同時に消える', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const direct = await castA1.from('vacant_slot_applications').delete().eq('id', app!.id).select()
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).status).toBe('pending')
    expect((await shiftsOf(castA1Id)).length).toBe(1)

    expect((await castA1.rpc('cancel_vacant_slot_application', { p_application_id: app!.id })).error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app!.id)).data).toEqual([])
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('管理者も申請を直接DELETEできない（approved申請を消してconfirmed shiftだけが残る状態を作れない）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await reviewAs(adminA, app!.id, 'approved')
    const direct = await adminA.from('vacant_slot_applications').delete().eq('id', app!.id).select()
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).status).toBe('approved')
    expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['confirmed'])
  })

  it('approvedの申請はキャストがRPCでも取り消せない（申請もshiftも残る）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await reviewAs(adminA, app!.id, 'approved')
    expect((await castA1.rpc('cancel_vacant_slot_application', { p_application_id: app!.id })).error).not.toBeNull()
    expect((await getApp(app!.id)).status).toBe('approved')
    expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['confirmed'])
  })

  it('他のキャストの申請は直接DELETEもRPCでの取消もできない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA2, slotId, '12:00', '15:00')
    const { data } = await castA1.from('vacant_slot_applications').delete().eq('id', app!.id).select()
    expect(data ?? []).toEqual([])
    expect((await castA1.rpc('cancel_vacant_slot_application', { p_application_id: app!.id })).error).not.toBeNull()
    expect((await getApp(app!.id)).status).toBe('pending')
  })

  it('applicationのstatus・shift_id・reviewed_by・希望時刻などの重要列は、管理者・キャストの直接UPDATEでは一切変更できない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const patches: Record<string, unknown>[] = [
      { status: 'rejected' }, { status: 'approved' }, { shift_id: null }, { reviewed_by: adminAId }, { requested_start_time: '13:00' }, { vacant_slot_id: slotId },
    ]
    for (const client of [adminA, castA1, ownerA]) {
      for (const patch of patches) {
        const { data, error } = await client.from('vacant_slot_applications').update(patch as never).eq('id', app!.id).select()
        expect(error !== null || (data ?? []).length === 0).toBe(true)
      }
    }
    expect(await getApp(app!.id)).toMatchObject({ status: 'pending', shift_id: app!.shift_id, reviewed_by: null, requested_start_time: '12:00:00' })
  })

  it('直接申請（applicationのINSERT）は、管理者通知を迂回する形でも作れない（自己承認・他人名義・shift紐づけ付きも含め、すべて拒否される）', async () => {
    const slotId = await makeSlot()
    const attempts: Database['public']['Tables']['vacant_slot_applications']['Insert'][] = [
      { vacant_slot_id: slotId, cast_id: castA1Id },
      { vacant_slot_id: slotId, cast_id: castA1Id, status: 'approved' },
      { vacant_slot_id: slotId, cast_id: castA2Id },
    ]
    for (const client of [castA1, adminA, ownerA]) {
      for (const row of attempts) expect((await client.from('vacant_slot_applications').insert(row)).error).not.toBeNull()
    }
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
    expect((await notifsOf([adminAId, adminA2Id])).length).toBe(0)
  })
})

describe('管理者: 自店舗の申請のみ承認・却下できる', () => {
  it('自店舗の申請を承認でき、shiftがconfirmedになり、reviewed_by/reviewed_atが記録される', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: approved, error } = await reviewAs(adminA, app!.id, 'approved')
    expect(error).toBeNull()
    expect(approved?.status).toBe('approved')
    expect(approved?.shift_id).toBe(app!.shift_id)

    const row = await getApp(app!.id)
    expect(row.status).toBe('approved')
    expect(row.reviewed_by).toBe(adminAId)
    expect(row.reviewed_at).not.toBeNull()
    const { data: shift } = await service.from('shifts').select('status').eq('id', app!.shift_id!).single()
    expect(shift?.status).toBe('confirmed')
  })

  it('自店舗の申請を却下でき、仮予定shiftが消え、申請のshift_idはnullになる', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })
    expect(error).toBeNull()
    const row = await getApp(app!.id)
    expect(row.status).toBe('rejected')
    expect(row.shift_id).toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('管理者でも、申請の直接UPDATE（statusを直接rejectedにするなど）はできない。承認・却下はRPCだけ', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data, error } = await adminA.from('vacant_slot_applications').update({ status: 'rejected' }).eq('id', app!.id).select()
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    expect((await getApp(app!.id)).status).toBe('pending')
    expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['submitted'])
    expect((await reviewAs(adminA, app!.id, 'rejected')).error).toBeNull()
  })

  it('他店舗の管理者は、承認・却下（RPC・直接UPDATE）とも自店舗外の申請に対してできない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')

    const { error: rpcErr } = await adminB.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    expect(rpcErr).not.toBeNull()
    const { data } = await adminB.from('vacant_slot_applications').update({ status: 'approved' }).eq('id', app!.id).select()
    expect(data ?? []).toEqual([])
    expect((await getApp(app!.id)).status).toBe('pending')
  })

  it('キャストは承認RPC・公開切替RPC・削除RPCを実行できない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    expect((await castA1.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })).error).not.toBeNull()
    expect((await castA1.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })).error).not.toBeNull()
    expect((await castA1.rpc('delete_vacant_slot', { p_slot_id: slotId })).error).not.toBeNull()
    expect((await getApp(app!.id)).status).toBe('pending')
  })
})

describe('申請（通常の同日・日またぎ・終了後・不正値）', () => {
  it('【通常の同日部分申請】希望時間だけがshiftに反映され、日付は空き枠の日付のまま', async () => {
    const slotId = await makeSlot()
    const { data: app, error } = await applyAs(castA1, slotId, '13:00', '16:00')
    expect(error).toBeNull()
    expect(app?.requested_start_time).toBe('13:00:00')
    const [shift] = await shiftsOf(castA1Id)
    expect(shift).toMatchObject({ date: '2099-03-01', start_time: '13:00:00', end_time: '16:00:00', status: 'submitted' })
    expect(app?.shift_id).toBe(shift.id)
  })

  it('【日またぎ部分申請】22:00〜翌05:00の枠に23:00〜翌02:00で申請 → shiftは空き枠の日付・日をまたぐ時刻', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { error } = await applyAs(castA1, slotId, '23:00', '02:00')
    expect(error).toBeNull()
    const [shift] = await shiftsOf(castA1Id)
    expect(shift).toMatchObject({ date: '2099-03-01', start_time: '23:00:00', end_time: '02:00:00' })
  })

  it('【日またぎ部分申請】翌日側だけ（01:00〜03:00）を希望 → shiftの日付は翌日', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { error } = await applyAs(castA1, slotId, '01:00', '03:00')
    expect(error).toBeNull()
    const [shift] = await shiftsOf(castA1Id)
    expect(shift).toMatchObject({ date: '2099-03-02', start_time: '01:00:00', end_time: '03:00:00' })
  })

  it('範囲外・開始=終了・片方のみの希望は拒否され、孤立したshiftも残らない', async () => {
    const slotId = await makeSlot()
    expect((await applyAs(castA1, slotId, '11:00', '15:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, '15:00', '15:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, '12:00', null)).error).not.toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
  })

  it('【25:00等の不正値拒否】25:00・24:00・不正形式はDB側でも拒否され、shiftが残らない', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    expect((await applyAs(castA1, slotId, '22:00', '25:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, '23:00', '24:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, '99:99', '02:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, 'abc', '02:00')).error).not.toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('【終了後は申請不可】終了済みの同日枠へは、RPCも直接INSERTも拒否される', async () => {
    const endedId = await makeSlot({ date: '2020-01-01' })
    const { error } = await applyAs(castA1, endedId, '12:00', '15:00')
    expect(error).not.toBeNull()
    const { error: direct } = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: endedId, cast_id: castA1Id })
    expect(direct).not.toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('【0時を過ぎても進行中の日またぎ枠】前日の日付・翌日の終了時刻までの枠には申請できる', async () => {
    // 昨日(JST)の23:59〜(今日の)23:58 の日またぎ枠。日本時間の23:58〜24:00の2分間だけ終了済みになるため、その間は実行しない
    const inProgressId = await makeSlot({ date: jstDate(-1), start_time: '23:59', end_time: '23:58' })
    const { error } = await applyAs(castA1, inProgressId, '23:59', '00:30')
    expect(error).toBeNull()
  })

  it('【終了後は申請不可】日またぎ枠でも、翌日の終了時刻を過ぎたら拒否される（一昨日始まり）', async () => {
    const endedOvernightId = await makeSlot({ date: jstDate(-2), start_time: '22:00', end_time: '05:00' })
    const { error } = await applyAs(castA1, endedOvernightId, '23:00', '02:00')
    expect(error).not.toBeNull()
  })

  it('二重申請は拒否される', async () => {
    const slotId = await makeSlot()
    expect((await applyAs(castA1, slotId, '12:00', '15:00')).error).toBeNull()
    expect((await applyAs(castA1, slotId, '15:00', '18:00')).error).not.toBeNull()
    expect((await shiftsOf(castA1Id)).length).toBe(1)
  })

  it('【既存null/null申請の後方互換】希望時刻なしのRPC申請は公開枠全体のshiftになる', async () => {
    const slotId = await makeSlot()
    const { data: app, error } = await applyAs(castA1, slotId)
    expect(error).toBeNull()
    expect(app?.requested_start_time).toBeNull()
    expect(app?.requested_end_time).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ date: '2099-03-01', start_time: '12:00:00', end_time: '18:00:00' })
  })

  it('希望時刻の検証は、参照先の空き枠を付け替えるUPDATEでも必ず再実行される', async () => {
    const wideSlotId = await makeSlot()
    const narrowSlotId = await makeSlot({ date: '2099-03-02', start_time: '12:00', end_time: '13:00' })
    const { data: app } = await applyAs(castA1, wideSlotId, '14:00', '17:00')
    // service_roleでもトリガーは発火する。希望14:00〜17:00は12:00〜13:00の枠に収まらないため拒否される
    const { error } = await service.from('vacant_slot_applications').update({ vacant_slot_id: narrowSlotId }).eq('id', app!.id)
    expect(error).not.toBeNull()
    expect((await getApp(app!.id)).vacant_slot_id).toBe(wideSlotId)
  })
})

describe('承認・却下・承認取消の整合性', () => {
  it('【フォールバック】shift_idの無い申請を承認すると、confirmed shiftを新規作成し、そのIDが申請.shift_idへ保存される', async () => {
    const slotId = await makeSlot()
    const { data: legacy } = await service.from('vacant_slot_applications')
      .insert({ vacant_slot_id: slotId, cast_id: castA1Id, requested_start_time: '13:00', requested_end_time: '16:00' })
      .select('id').single()

    const { data: approved, error } = await reviewAs(adminA, legacy!.id, 'approved')
    expect(error).toBeNull()
    expect(approved?.shift_id).not.toBeNull()

    const row = await getApp(legacy!.id)
    expect(row.status).toBe('approved')
    expect(row.shift_id).toBe(approved!.shift_id)
    const [shift] = await shiftsOf(castA1Id)
    expect(shift).toMatchObject({ id: row.shift_id, status: 'confirmed', date: '2099-03-01', start_time: '13:00:00', end_time: '16:00:00' })
  })

  it('【既存null/null申請の後方互換】希望時刻もshift_idも無い既存申請を承認 → 公開枠全体のconfirmed shiftが作られる', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { data: legacy } = await service.from('vacant_slot_applications')
      .insert({ vacant_slot_id: slotId, cast_id: castA1Id }).select('id').single()
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: legacy!.id, p_next_status: 'approved' })
    expect(error).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ date: '2099-03-01', start_time: '22:00:00', end_time: '05:00:00', status: 'confirmed' })
    expect((await getApp(legacy!.id)).shift_id).not.toBeNull()
  })

  it('【フォールバックの翌日補正】日またぎ枠の翌日側希望（01:00〜03:00）は、翌日付のconfirmed shiftになる', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { data: legacy } = await service.from('vacant_slot_applications')
      .insert({ vacant_slot_id: slotId, cast_id: castA1Id, requested_start_time: '01:00', requested_end_time: '03:00' })
      .select('id').single()
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: legacy!.id, p_next_status: 'approved' })
    expect(error).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ date: '2099-03-02', start_time: '01:00:00', end_time: '03:00:00', status: 'confirmed' })
  })

  it('【承認失敗時に申請だけapprovedにならない】同じルームに重なる確定シフトがあると承認は失敗し、申請もshiftも元のまま', async () => {
    const { data: room } = await service.from('rooms').insert({ store_id: storeAId, name: `重複ルーム-${suffix}` }).select('id').single()
    const slotId = await makeSlot({ room_id: room!.id })
    const { data: app } = await applyAs(castA1, slotId, '13:00', '16:00')
    // 別キャストの確定シフトが同じルーム・時間帯に既にある
    await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, room_id: room!.id, date: '2099-03-01', start_time: '14:00', end_time: '15:00', status: 'confirmed',
    })

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23P01')

    const row = await getApp(app!.id)
    expect(row.status).toBe('pending')
    expect(row.reviewed_at).toBeNull()
    expect((await shiftsOf(castA1Id)).map(s => s.status)).toEqual(['submitted'])
  })

  it('【承認失敗時に申請だけapprovedにならない】フォールバックのshift作成が重複で失敗しても、申請はpendingのまま・shiftも作られない', async () => {
    const slotId = await makeSlot()
    const { data: legacy } = await service.from('vacant_slot_applications')
      .insert({ vacant_slot_id: slotId, cast_id: castA1Id, requested_start_time: '13:00', requested_end_time: '16:00' })
      .select('id').single()
    // 同じキャストに、同時間帯の別シフト（本人の重複は禁止）
    await service.from('shifts').insert({
      cast_id: castA1Id, store_id: storeAId, date: '2099-03-01', start_time: '14:00', end_time: '15:00', status: 'submitted',
    })

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: legacy!.id, p_next_status: 'approved' })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23P01')

    const row = await getApp(legacy!.id)
    expect(row.status).toBe('pending')
    expect(row.shift_id).toBeNull()
    expect((await shiftsOf(castA1Id)).length).toBe(1)
  })

  it('【承認上限】募集人数に達している枠は、DB側でも承認できない', async () => {
    const slotId = await makeSlot({ capacity: 1 })
    const { data: app1 } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: app2 } = await applyAs(castA2, slotId, '12:00', '15:00')
    expect((await adminA.rpc('review_vacant_slot_application', { p_application_id: app1!.id, p_next_status: 'approved' })).error).toBeNull()

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app2!.id, p_next_status: 'approved' })
    expect(error).not.toBeNull()
    expect((await getApp(app2!.id)).status).toBe('pending')
    const { data: slot } = await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()
    expect(slot?.approved_count).toBe(1)
  })

  it('【承認上限の同時実行対策】募集1人の枠への2件の同時承認は、必ず1件だけ成功する', async () => {
    const slotId = await makeSlot({ capacity: 1 })
    const { data: app1 } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: app2 } = await applyAs(castA2, slotId, '12:00', '15:00')

    const results = await Promise.all([
      adminA.rpc('review_vacant_slot_application', { p_application_id: app1!.id, p_next_status: 'approved' }),
      adminA.rpc('review_vacant_slot_application', { p_application_id: app2!.id, p_next_status: 'approved' }),
    ])
    expect(results.filter(r => r.error === null).length).toBe(1)
    expect(results.filter(r => r.error !== null).length).toBe(1)

    const { data: approved } = await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId).eq('status', 'approved')
    expect(approved?.length).toBe(1)
    const { data: confirmed } = await service.from('shifts').select('id').eq('store_id', storeAId).eq('status', 'confirmed')
    expect(confirmed?.length).toBe(1)
  })

  it('【承認取消】approved → pending でshiftはsubmittedへ戻り、reviewed_*も消える', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'pending' })
    expect(error).toBeNull()
    const row = await getApp(app!.id)
    expect(row).toMatchObject({ status: 'pending', reviewed_at: null, reviewed_by: null, shift_id: app!.shift_id })
    expect((await shiftsOf(castA1Id)).map(s => s.status)).toEqual(['submitted'])
  })

  it('【承認済みの却下】approved → rejected でconfirmed shiftも消え、申請とshiftが食い違わない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })
    expect(error).toBeNull()
    expect(await getApp(app!.id)).toMatchObject({ status: 'rejected', shift_id: null })
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('【却下後の再承認】rejected → approved でshiftが再作成され、shift_idが保存される', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    expect(error).toBeNull()
    const row = await getApp(app!.id)
    expect(row.status).toBe('approved')
    expect(row.shift_id).not.toBeNull()
    expect((await shiftsOf(castA1Id)).map(s => s.id)).toEqual([row.shift_id])
  })

  it('同じ状態への再送は冪等（二重クリックで壊れない）で、許可されない遷移は拒否される', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    expect((await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'pending' })).error).toBeNull()
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })
    expect((await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })).error).toBeNull()
    // rejected → pending は提供しない遷移
    expect((await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'pending' })).error).not.toBeNull()
  })
})

describe('公開切替・削除の整合性', () => {
  it('【非公開→再公開】仮予定shiftが消えて申請は残り、再公開で同じ内容（希望時刻・翌日補正）のshiftが復元されshift_idも保存される', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { data: pending } = await applyAs(castA1, slotId, '01:00', '03:00')
    const { data: approvedApp } = await applyAs(castA2, slotId, '23:00', '02:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: approvedApp!.id, p_next_status: 'approved' })

    const { error: hideErr } = await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })
    expect(hideErr).toBeNull()
    expect((await service.from('vacant_slots').select('is_published').eq('id', slotId).single()).data?.is_published).toBe(false)
    expect((await getApp(pending!.id)).shift_id).toBeNull()
    expect((await getApp(approvedApp!.id)).shift_id).toBeNull()
    expect((await getApp(pending!.id)).status).toBe('pending')
    expect(await shiftsOf(castA1Id)).toEqual([])
    expect(await shiftsOf(castA2Id)).toEqual([])

    const { error: showErr } = await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: true })
    expect(showErr).toBeNull()
    const pendingRow = await getApp(pending!.id)
    const approvedRow = await getApp(approvedApp!.id)
    expect(pendingRow.shift_id).not.toBeNull()
    expect(approvedRow.shift_id).not.toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ id: pendingRow.shift_id, status: 'submitted', date: '2099-03-02', start_time: '01:00:00', end_time: '03:00:00' })
    expect((await shiftsOf(castA2Id))[0]).toMatchObject({ id: approvedRow.shift_id, status: 'confirmed', date: '2099-03-01', start_time: '23:00:00', end_time: '02:00:00' })
  })

  it('【再公開時にapproved申請のshift復元が失敗】RPC全体がロールバックされ、空き枠は非公開のまま・申請とshiftの状態も元のまま（一部のshiftだけ復元されることもない）', async () => {
    const slotId = await makeSlot()
    // 先に作った保留中の申請（復元は成功する側）と、後から作って承認した申請（復元が失敗する側）
    const { data: pendingApp } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: approvedApp } = await applyAs(castA2, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: approvedApp!.id, p_next_status: 'approved' })
    expect((await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })).error).toBeNull()
    // 非公開の間に、castA2が承認済みの時間帯と重なる別シフトを入れた → 再公開時にapprovedのshiftを復元できない
    await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '14:00', status: 'submitted',
    })

    const { error } = await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: true })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23P01')
    expect(error?.message).toContain('公開に戻せませんでした')

    // 公開状態は変わらず非公開のまま
    expect((await service.from('vacant_slots').select('is_published').eq('id', slotId).single()).data?.is_published).toBe(false)
    // approved申請は承認のまま（元の状態）で、shift_idはnull（非公開中の状態）。公開中なのにshiftが無い状態にはなっていない
    expect(await getApp(approvedApp!.id)).toMatchObject({ status: 'approved', shift_id: null })
    // 復元できた側（保留中の申請）もロールバックされ、一部のshiftだけ復元されることはない
    expect(await getApp(pendingApp!.id)).toMatchObject({ status: 'pending', shift_id: null })
    expect(await shiftsOf(castA1Id)).toEqual([])
    // castA2のshiftは、非公開中に入れた別シフトのみ（confirmedは作られていない）
    expect((await shiftsOf(castA2Id)).map(x => x.status)).toEqual(['submitted'])
  })

  it('【再公開時にpending申請のshift復元が失敗】同じく全体がロールバックされ、成功扱いにならない', async () => {
    const slotId = await makeSlot()
    const { data: appOk } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: appConflict } = await applyAs(castA2, slotId, '12:00', '15:00')
    await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })
    await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '14:00', status: 'submitted',
    })

    const { error } = await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: true })
    expect(error).not.toBeNull()
    expect((await getApp(appOk!.id)).shift_id).toBeNull()
    expect((await getApp(appConflict!.id)).shift_id).toBeNull()
    expect((await service.from('vacant_slots').select('is_published').eq('id', slotId).single()).data?.is_published).toBe(false)
  })

  it('復元の競合が解消されれば、同じ空き枠を再公開できる（ロールバック後に壊れた状態が残っていない）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA2, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })
    const { data: blocker } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '14:00', status: 'submitted',
    }).select('id').single()
    expect((await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: true })).error).not.toBeNull()

    await service.from('shifts').delete().eq('id', blocker!.id)
    expect((await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: true })).error).toBeNull()
    const row = await getApp(app!.id)
    expect(row).toMatchObject({ status: 'approved' })
    expect(row.shift_id).not.toBeNull()
    expect((await shiftsOf(castA2Id)).map(x => x.status)).toEqual(['confirmed'])
  })

  it('他店舗の管理者は公開切替・削除できない', async () => {
    const slotId = await makeSlot()
    expect((await adminB.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })).error).not.toBeNull()
    expect((await adminB.rpc('delete_vacant_slot', { p_slot_id: slotId })).error).not.toBeNull()
    expect((await service.from('vacant_slots').select('is_published').eq('id', slotId).single()).data?.is_published).toBe(true)
  })

  it('【空き枠削除】保留中の仮予定shiftは空き枠と一緒に消え、承認済みの確定shiftは残る', async () => {
    const slotId = await makeSlot()
    await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: approvedApp } = await applyAs(castA2, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: approvedApp!.id, p_next_status: 'approved' })

    const { error } = await adminA.rpc('delete_vacant_slot', { p_slot_id: slotId })
    expect(error).toBeNull()
    expect((await service.from('vacant_slots').select('id').eq('id', slotId)).data).toEqual([])
    expect(await shiftsOf(castA1Id)).toEqual([])
    expect((await shiftsOf(castA2Id)).map(s => s.status)).toEqual(['confirmed'])
  })
})

describe('申請に紐づくshiftの内容検証（無関係な自分のshiftを紐づけて承認させられない）', () => {
  // 空き枠: 2099-03-01 12:00〜18:00（ルームなし）。希望 13:00〜16:00 のshiftだけが正しい紐づけ
  async function castShift(over: Partial<Database['public']['Tables']['shifts']['Insert']> = {}) {
    // キャスト自身がAPIで作成する（RLS: 自分のshift作成）
    const { data, error } = await castA1.from('shifts').insert({
      cast_id: castA1Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '16:00', status: 'submitted', ...over,
    }).select('id').single()
    if (error || !data) throw error
    return data.id
  }
  // 申請テーブルへの直接INSERTは全ロールで拒否される（RPCだけが作成できる）ため、紐づくshiftの内容検証（DBトリガー）は
  // service_role（サーバー側の信頼された書き込み）で直接INSERTして確認する。トリガーはservice_roleにも発火する
  const link = (slotId: string, shiftId: string, start: string | null = '13:00', end: string | null = '16:00') =>
    service.from('vacant_slot_applications').insert({
      vacant_slot_id: slotId, cast_id: castA1Id, shift_id: shiftId, requested_start_time: start, requested_end_time: end,
    })

  it('別の日付の自分のshiftは紐づけられない', async () => {
    const slotId = await makeSlot()
    const otherDay = await castShift({ date: '2099-04-10' })
    const { error } = await link(slotId, otherDay)
    expect(error).not.toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
  })

  it('同じ日でも別の時間帯の自分のshiftは紐づけられない', async () => {
    const slotId = await makeSlot()
    const otherTime = await castShift({ start_time: '17:00', end_time: '18:00' })
    expect((await link(slotId, otherTime)).error).not.toBeNull()
  })

  it('別ルームの自分のshiftは紐づけられない', async () => {
    const { data: room } = await service.from('rooms').insert({ store_id: storeAId, name: `紐づけ検証ルーム-${suffix}` }).select('id').single()
    const slotId = await makeSlot()
    const otherRoom = await castShift({ room_id: room!.id })
    expect((await link(slotId, otherRoom)).error).not.toBeNull()
  })

  it('確定済み(confirmed)のshiftは、内容が一致していても紐づけられない（提出済みのみ）', async () => {
    const slotId = await makeSlot()
    const { data: confirmed } = await service.from('shifts').insert({
      cast_id: castA1Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '16:00', status: 'confirmed',
    }).select('id').single()
    expect((await link(slotId, confirmed!.id)).error).not.toBeNull()
  })

  it('他人のshift・他店舗のshiftは紐づけられない', async () => {
    const slotId = await makeSlot()
    const { data: othersShift } = await service.from('shifts').insert({
      cast_id: castA2Id, store_id: storeAId, date: '2099-03-01', start_time: '13:00', end_time: '16:00', status: 'submitted',
    }).select('id').single()
    expect((await link(slotId, othersShift!.id)).error).not.toBeNull()
  })

  it('空き枠と希望時刻に一致する自分のshift（提出済み）は紐づけられる（従来経路との互換）', async () => {
    const slotId = await makeSlot()
    const good = await castShift()
    const { error } = await link(slotId, good)
    expect(error).toBeNull()
  })

  it('希望時刻なし(null/null)の申請は、公開枠全体と一致するshiftのみ紐づけられる', async () => {
    const slotId = await makeSlot()
    const partial = await castShift() // 13:00〜16:00（公開枠全体ではない）
    expect((await link(slotId, partial, null, null)).error).not.toBeNull()
    // 同じキャストの時間帯が重なるshiftは同時に作れないため、部分shiftを消してから公開枠全体のshiftを作る
    await castA1.from('shifts').delete().eq('id', partial)
    const whole = await castShift({ start_time: '12:00', end_time: '18:00' })
    expect((await link(slotId, whole, null, null)).error).toBeNull()
  })

  it('1つのshiftを別の空き枠（同内容）の2つ目の申請に紐づけることはできない', async () => {
    const slotId = await makeSlot()
    const sameContentSlotId = await makeSlot()
    const good = await castShift()
    expect((await link(slotId, good)).error).toBeNull()
    expect((await link(sameContentSlotId, good)).error).not.toBeNull()
  })

  it('紐づけ後のUPDATEで別のshiftへ差し替えることもできない（cast向けUPDATEポリシーが無い＋管理者/service_roleでもトリガーが検証する）', async () => {
    const slotId = await makeSlot()
    const good = await castShift()
    const { data: app } = await link(slotId, good).select('id').single()
    const unrelated = await castShift({ date: '2099-04-10' })
    const { data } = await castA1.from('vacant_slot_applications').update({ shift_id: unrelated }).eq('id', app!.id).select()
    expect(data ?? []).toEqual([])
    const { error } = await service.from('vacant_slot_applications').update({ shift_id: unrelated }).eq('id', app!.id)
    expect(error).not.toBeNull()
    expect((await getApp(app!.id)).shift_id).toBe(good)
  })

  it('【承認時の矯正】申請後にキャストが自分のshiftを別の日時・別ルームへ書き換えても、承認すると空き枠内容へ矯正されてconfirmedになる（無関係な内容のまま確定されない）', async () => {
    const { data: room } = await service.from('rooms').insert({ store_id: storeAId, name: `矯正検証ルーム-${suffix}` }).select('id').single()
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '13:00', '16:00')
    // 申請後に、キャストが直接APIで自分のshiftを無関係な日時・ルームへ書き換える（提出済みshiftの更新はRLS上許可されている）
    const { data: edited, error: editErr } = await castA1.from('shifts')
      .update({ date: '2099-05-05', start_time: '01:00', end_time: '02:00', room_id: room!.id }).eq('id', app!.shift_id!).select()
    expect(editErr).toBeNull()
    expect(edited?.length).toBe(1)

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    expect(error).toBeNull()
    const [shift] = await shiftsOf(castA1Id)
    expect(shift).toMatchObject({
      id: app!.shift_id, status: 'confirmed', date: '2099-03-01', start_time: '13:00:00', end_time: '16:00:00', room_id: null, store_id: storeAId,
    })
    expect((await shiftsOf(castA1Id)).length).toBe(1)
  })

  it('【承認時の矯正】日またぎ枠の翌日側希望でも、書き換えられたshiftは翌日付の正しい内容へ矯正される', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { data: app } = await applyAs(castA1, slotId, '01:00', '03:00')
    await castA1.from('shifts').update({ date: '2099-06-01', start_time: '10:00', end_time: '11:00' }).eq('id', app!.shift_id!)
    expect((await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })).error).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ date: '2099-03-02', start_time: '01:00:00', end_time: '03:00:00', status: 'confirmed' })
  })

  it('【承認時の検証】shiftの所有者(cast_id)が申請者と食い違っている場合は、矯正せず承認を拒否し、何も変更されない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '13:00', '16:00')
    await service.from('shifts').update({ cast_id: castA2Id }).eq('id', app!.shift_id!)
    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    expect(error).not.toBeNull()
    expect(await getApp(app!.id)).toMatchObject({ status: 'pending', shift_id: app!.shift_id })
    expect((await shiftsOf(castA2Id)).map(x => x.status)).toEqual(['submitted'])
  })
})

describe('通常のシフト操作（シフト管理・修正申請・キャスト画面）と空き枠申請の整合性（shiftsのガードトリガー）', () => {
  // 申請（pending）に紐づく仮shiftを作る。capacityは空き枠ごとに指定できる
  async function pendingLinked(cast: SupabaseClient<Database>, slotOver: Partial<SlotInsert> = {}, start = '12:00', end = '15:00') {
    const slotId = await makeSlot({ capacity: 5, ...slotOver })
    const { data: app, error } = await applyAs(cast, slotId, start, end)
    expect(error).toBeNull()
    await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id, adminAId, adminA2Id])
    return { slotId, app: app! }
  }
  // キャストがRPCで修正申請を作る（アプリと同じ経路。shiftのstatus変更・申請の作成・管理者通知が1トランザクション）
  async function requestModAs(cast: SupabaseClient<Database>, shiftId: string, over: { new_date?: string; new_start_time?: string; new_end_time?: string; reason?: string } = {}) {
    return cast.rpc('create_shift_modification_request', {
      p_shift_id: shiftId,
      p_new_date: over.new_date,
      p_new_start_time: over.new_start_time,
      p_new_end_time: over.new_end_time,
      p_reason: over.reason ?? 'テスト',
    })
  }
  const approvedCount = async (slotId: string) => (await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()).data?.approved_count
  const shiftStatus = async (id: string) => (await service.from('shifts').select('status').eq('id', id).maybeSingle()).data?.status ?? null
  const castNotifs = async (castId: string) => (await notifsOf([castId])).map(n => n.title)

  it('【確定】シフト管理からlinked shiftを確定すると、承認RPCと同じ規則で承認される（reviewed_by/reviewed_at・承認通知1回・approved_count・shift内容）', async () => {
    const { slotId, app } = await pendingLinked(castA1, { capacity: 1 })
    const { error } = await adminA.from('shifts').update({ status: 'confirmed', admin_note: 'ok' }).eq('id', app.shift_id!)
    expect(error).toBeNull()
    expect(await getApp(app.id)).toMatchObject({ status: 'approved', reviewed_by: adminAId, shift_id: app.shift_id })
    expect((await getApp(app.id)).reviewed_at).not.toBeNull()
    expect(await notifsOf([castA1Id])).toEqual([{ user_id: castA1Id, title: '空き枠申請が承認されました', body: reviewBody('2099-03-01', '12:00', '12:00', '15:00'), link: '/cast/vacant-slots' }])
    expect(await approvedCount(slotId)).toBe(1)
  })

  it('【確定・矯正】キャストが申請後にshiftを別日時へ書き換えていても、シフト管理から確定すると空き枠の内容へ矯正される', async () => {
    const { app } = await pendingLinked(castA1)
    await castA1.from('shifts').update({ date: '2099-05-05', start_time: '01:00', end_time: '02:00' }).eq('id', app.shift_id!)
    expect((await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app.shift_id!)).error).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ status: 'confirmed', date: '2099-03-01', start_time: '12:00:00', end_time: '15:00:00' })
  })

  it('【承認上限・同時実行】募集1人の枠に2件のpending申請があり、シフト管理から2件を同時に確定しても、1件しか承認されない', async () => {
    for (let i = 0; i < 6; i++) {
      const date = `2099-11-${String(i + 1).padStart(2, '0')}`
      const slotId = await makeSlot({ date, capacity: 1 })
      const a = (await applyAs(castA1, slotId, '12:00', '15:00')).data!
      const b = (await applyAs(castA2, slotId, '12:00', '15:00')).data!
      await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id])

      const results = await Promise.all([a, b].map(x => adminA.from('shifts').update({ status: 'confirmed' }).eq('id', x.shift_id!)))
      expect(results.filter(r => r.error === null).length).toBe(1)
      const failure = results.find(r => r.error !== null)!
      expect(failure.error?.message).toContain('募集人数')

      expect(await approvedCount(slotId)).toBe(1)
      const { data: apps } = await service.from('vacant_slot_applications').select('status, shift_id').eq('vacant_slot_id', slotId)
      expect(apps!.filter(x => x.status === 'approved').length).toBe(1)
      // 承認された申請のshiftだけがconfirmed。もう一方は提出済みのまま（申請とshiftが食い違わない）
      for (const x of apps!) expect(await shiftStatus(x.shift_id!)).toBe(x.status === 'approved' ? 'confirmed' : 'submitted')
      expect((await notifsOf([castA1Id, castA2Id], '空き枠申請が承認されました')).length).toBe(1)

      await service.from('shifts').delete().eq('store_id', storeAId)
      await service.from('vacant_slots').delete().eq('id', slotId)
    }
  })

  it('【確定取消】シフト管理でconfirmedを取り消すと、申請はpendingへ戻る（approvedなのにshiftがsubmitted、にならない）。再度確定もできる', async () => {
    const { slotId, app } = await pendingLinked(castA1, { capacity: 1 })
    await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app.shift_id!)
    expect(await approvedCount(slotId)).toBe(1)

    expect((await adminA.from('shifts').update({ status: 'submitted' }).eq('id', app.shift_id!)).error).toBeNull()
    expect(await getApp(app.id)).toMatchObject({ status: 'pending', reviewed_by: null, reviewed_at: null, shift_id: app.shift_id })
    expect(await shiftStatus(app.shift_id!)).toBe('submitted')
    expect(await approvedCount(slotId)).toBe(0)
    expect((await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app.shift_id!)).error).toBeNull()
    expect((await getApp(app.id)).status).toBe('approved')
  })

  it('【差し戻し】pendingの仮shiftを差し戻すと、申請はrejected・shift_id=nullになり、不承認通知が1回作られる（shift自体は差し戻し状態で残る）', async () => {
    const { app } = await pendingLinked(castA1)
    expect((await adminA.from('shifts').update({ status: 'rejected', admin_note: '時間を直してください' }).eq('id', app.shift_id!)).error).toBeNull()
    expect(await getApp(app.id)).toMatchObject({ status: 'rejected', shift_id: null, reviewed_by: adminAId })
    expect(await shiftStatus(app.shift_id!)).toBe('rejected')
    expect(await castNotifs(castA1Id)).toEqual(['空き枠申請が不承認になりました'])
  })

  it('【差し戻し】approved（確定済み）のshiftを差し戻すと、申請はrejectedになりapproved_countが減る（空き枠が再び空く）', async () => {
    const { slotId, app } = await pendingLinked(castA1, { capacity: 1 })
    await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app.shift_id!)
    expect(await approvedCount(slotId)).toBe(1)
    expect((await adminA.from('shifts').update({ status: 'rejected' }).eq('id', app.shift_id!)).error).toBeNull()
    expect(await getApp(app.id)).toMatchObject({ status: 'rejected', shift_id: null })
    expect(await approvedCount(slotId)).toBe(0)
    // 別のキャストが申請でき、承認もできる
    const other = (await applyAs(castA2, slotId, '12:00', '15:00')).data!
    expect((await reviewAs(adminA, other.id, 'approved')).error).toBeNull()
  })

  it('【不正な遷移】linked shiftを draft など、申請と食い違う状態へは変更できない（変更は何も残らない）', async () => {
    const { app } = await pendingLinked(castA1)
    const { error } = await adminA.from('shifts').update({ status: 'draft' }).eq('id', app.shift_id!)
    expect(error).not.toBeNull()
    expect(await shiftStatus(app.shift_id!)).toBe('submitted')
    expect((await getApp(app.id)).status).toBe('pending')
  })

  it('【直接削除】キャストがpendingの仮shiftをシフト画面から直接削除すると、申請も同時に消える（pendingなのにshiftだけ無い状態にならない）', async () => {
    const { app } = await pendingLinked(castA1)
    expect((await castA1.from('shifts').delete().eq('id', app.shift_id!)).error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app.id)).data).toEqual([])
    expect(await shiftsOf(castA1Id)).toEqual([])
  })

  it('【直接削除】管理者がpendingの仮shiftを直接削除しても、申請だけが残らない', async () => {
    const { app } = await pendingLinked(castA1)
    expect((await adminA.from('shifts').delete().eq('id', app.shift_id!)).error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app.id)).data).toEqual([])
  })

  it('【直接削除】管理者がapproved（確定済み）のshiftを直接削除すると、申請も同時に消えapproved_countが減る（approvedなのにshiftが無い状態にならない）', async () => {
    const { slotId, app } = await pendingLinked(castA1, { capacity: 1 })
    await reviewAs(adminA, app.id, 'approved')
    expect(await approvedCount(slotId)).toBe(1)
    await service.from('notifications').delete().eq('user_id', castA1Id) // 承認通知は除いて、削除通知だけを確認する
    expect((await adminA.from('shifts').delete().eq('id', app.shift_id!)).error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('id', app.id)).data).toEqual([])
    expect(await approvedCount(slotId)).toBe(0)
    // 削除通知はシフト管理の削除として1回だけ
    expect(await castNotifs(castA1Id)).toEqual(['シフトが削除されました'])
  })

  it('【修正申請】approvedのlinked shiftへのキャストの修正申請→管理者の却下・承認・キャンセルのどれでも、申請とshiftが食い違わず、通知は1回だけ', async () => {
    // 却下: shiftはconfirmedへ戻り、申請はapprovedのまま
    const first = await pendingLinked(castA1, { capacity: 3 }, '12:00', '15:00')
    await reviewAs(adminA, first.app.id, 'approved')
    await service.from('notifications').delete().in('user_id', [castA1Id, adminAId, adminA2Id])
    const { data: req1, error: reqError1 } = await requestModAs(castA1, first.app.shift_id!, { new_date: '2099-03-01', new_start_time: '13:00', new_end_time: '16:00' })
    expect(reqError1).toBeNull()
    expect(await shiftStatus(first.app.shift_id!)).toBe('modification_requested')
    expect((await notifsOf([adminAId, adminA2Id], 'シフト修正申請が届きました')).length).toBe(2) // キャストのブラウザがusersを検索せずに、管理者へ届く
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req1!.id, p_action: 'reject', p_reject_reason: '無理です' })).error).toBeNull()
    expect(await shiftStatus(first.app.shift_id!)).toBe('confirmed')
    expect((await getApp(first.app.id)).status).toBe('approved')
    expect(await notifsOf([castA1Id])).toEqual([{ user_id: castA1Id, title: 'シフト修正申請が却下されました', body: '却下理由: 無理です', link: '/cast/shifts' }])

    // 承認: 新しい日時で確定。申請はapprovedのまま
    await service.from('notifications').delete().eq('user_id', castA1Id)
    const { data: req2, error: reqError2 } = await requestModAs(castA1, first.app.shift_id!, { reason: 'テスト2' })
    expect(reqError2).toBeNull()
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req2!.id, p_action: 'approve', p_date: '2099-03-01', p_start_time: '13:00', p_end_time: '16:00' })).error).toBeNull()
    expect((await shiftsOf(castA1Id))[0]).toMatchObject({ status: 'confirmed', start_time: '13:00:00', end_time: '16:00:00' })
    expect((await getApp(first.app.id)).status).toBe('approved')
    expect((await castNotifs(castA1Id))).toEqual(['シフト修正申請が承認されました'])

    // 承認してキャンセル: shiftが削除され、申請も同時に消える。通知は「キャンセルされました」1回だけ（「削除されました」は出ない）
    await service.from('notifications').delete().eq('user_id', castA1Id)
    const { data: req3, error: reqError3 } = await requestModAs(castA1, first.app.shift_id!, { reason: 'キャンセルしたい' })
    expect(reqError3).toBeNull()
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req3!.id, p_action: 'approve_cancel' })).error).toBeNull()
    expect(await shiftsOf(castA1Id)).toEqual([])
    expect((await service.from('vacant_slot_applications').select('id').eq('id', first.app.id)).data).toEqual([])
    expect(await approvedCount(first.slotId)).toBe(0)
    expect(await castNotifs(castA1Id)).toEqual(['シフトがキャンセルされました'])
  })

  it('【修正申請RPCの認可】他店舗の管理者・キャストは修正申請を処理できない。処理済みの申請の再処理も拒否される', async () => {
    const { app } = await pendingLinked(castA1)
    await reviewAs(adminA, app.id, 'approved')
    const { data: req } = await requestModAs(castA1, app.shift_id!)
    expect((await adminB.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: 'x' })).error).not.toBeNull()
    expect((await castA1.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: 'x' })).error).not.toBeNull()
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: '' })).error).not.toBeNull()
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: 'ok' })).error).toBeNull()
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: 'ok' })).error).not.toBeNull()
  })

  // ---- 空き枠に紐づかない通常のシフトの通知（従来はブラウザが直接INSERTしていたものを、DBトリガーが作成する）
  async function plainShift(over: Partial<Database['public']['Tables']['shifts']['Insert']> = {}) {
    const { data, error } = await castA1.from('shifts').insert({
      cast_id: castA1Id, store_id: storeAId, date: '2099-12-01', start_time: '18:00', end_time: '23:00', status: 'submitted', ...over,
    }).select('id').single()
    if (error || !data) throw error
    await service.from('notifications').delete().in('user_id', [castA1Id, adminAId, adminA2Id])
    return data.id
  }
  const plainBody = (date: string, s: string, e: string) => `${dateLabel(date)} ${s}〜${e} のシフト`

  it('【通常シフト】管理者の 確定・差し戻し・確定取消 で、そのキャストへ1件ずつ通知が作られる（宛先・文面はDBが決める）', async () => {
    const id = await plainShift()
    await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', id)
    expect(await notifsOf([castA1Id])).toEqual([{ user_id: castA1Id, title: 'シフトが確定されました', body: plainBody('2099-12-01', '18:00', '23:00'), link: '/cast/shifts' }])
    await service.from('notifications').delete().eq('user_id', castA1Id)
    await adminA.from('shifts').update({ status: 'submitted' }).eq('id', id)
    expect(await castNotifs(castA1Id)).toEqual(['シフトの確定が取り消されました'])
    await service.from('notifications').delete().eq('user_id', castA1Id)
    await adminA.from('shifts').update({ status: 'rejected' }).eq('id', id)
    expect(await castNotifs(castA1Id)).toEqual(['シフトが差し戻されました'])
  })

  it('【通常シフト】管理者の日時・ルーム変更（シフト内容の変更）と削除で、そのキャストへ通知が作られる', async () => {
    const id = await plainShift()
    const { data: room } = await service.from('rooms').insert({ store_id: storeAId, name: `通知ルーム-${suffix}` }).select('id').single()
    await adminA.from('shifts').update({ date: '2099-12-02', start_time: '19:00', end_time: '23:30', room_id: room!.id }).eq('id', id)
    const n = await notifsOf([castA1Id])
    expect(n.map(x => x.title)).toEqual(['シフト内容が変更されました'])
    expect(n[0].body).toBe(`${dateLabel('2099-12-01')} 18:00〜23:00 から ${dateLabel('2099-12-02')} 19:00〜23:30（通知ルーム-${suffix}） に変更されました`)
    await service.from('notifications').delete().eq('user_id', castA1Id)
    await adminA.from('shifts').delete().eq('id', id)
    const d = await notifsOf([castA1Id])
    expect(d).toEqual([{ user_id: castA1Id, title: 'シフトが削除されました', body: `${dateLabel('2099-12-02')} 19:00〜23:30 のシフトが管理者によって削除されました`, link: '/cast/shifts' }])
  })

  it('【通常シフト】キャストが差し戻されたシフトを再提出すると、同店舗の有効な管理者全員へ通知が作られる（キャストがusersを検索しなくても届く）。他店舗の管理者・キャストの通常編集では作られない', async () => {
    const id = await plainShift({ status: 'rejected' })
    expect((await castA1.from('shifts').update({ status: 'submitted', start_time: '19:00' }).eq('id', id)).error).toBeNull()
    const rows = await notifsOf([adminAId, adminA2Id, adminBId])
    expect(rows.map(r => r.user_id).sort()).toEqual([adminAId, adminA2Id].sort())
    expect(rows.every(r => r.title === 'シフトが再提出されました' && r.link === '/admin/shifts' && r.body === `キャストA1 ／ ${dateLabel('2099-12-01')} 19:00〜23:00`)).toBe(true)
    await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id])
    await castA1.from('shifts').update({ start_time: '20:00' }).eq('id', id) // 通常の編集（再提出ではない）
    expect((await notifsOf([adminAId, adminA2Id])).length).toBe(0)
  })

  it('【通常シフト】他店舗の管理者は、店舗Aのシフトを変更できず、通知も作られない', async () => {
    const id = await plainShift()
    const { data } = await adminB.from('shifts').update({ status: 'confirmed' }).eq('id', id).select()
    expect(data ?? []).toEqual([])
    expect((await notifsOf([castA1Id])).length).toBe(0)
  })

  // 実ブラウザ確認で発見: 既存の check_shift_double_booking() が search_path 未指定で `rooms` を修飾なしに参照しており、
  // 管理RPC(search_path='')の中でルーム付きshiftをconfirmedにすると relation "rooms" does not exist になっていた。
  it('【ルーム付き】ルームのある空き枠の承認RPC・シフト管理からの確定・修正申請の承認が、ルーム重複トリガーを含めてすべて成功する', async () => {
    const { data: room } = await service.from('rooms').insert({ store_id: storeAId, name: `ルーム付き-${suffix}`, capacity: 2 }).select('id').single()
    // 承認RPC
    const viaRpc = await pendingLinked(castA1, { capacity: 5, room_id: room!.id }, '12:00', '15:00')
    const approved = await reviewAs(adminA, viaRpc.app.id, 'approved')
    expect(approved.error).toBeNull()
    expect(approved.data?.status).toBe('approved')
    expect(await shiftStatus(viaRpc.app.shift_id!)).toBe('confirmed')
    // シフト管理からの確定（同じルームの重ならない時間帯。空き枠の承認は同じルームの重複を常に禁止する仕様）
    const viaShift = await pendingLinked(castA2, { capacity: 5, room_id: room!.id }, '15:00', '16:00')
    expect((await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', viaShift.app.shift_id!)).error).toBeNull()
    expect((await getApp(viaShift.app.id)).status).toBe('approved')
    // 修正申請の承認（RPC内でルーム付きshiftを更新して確定）
    const { data: req } = await requestModAs(castA1, viaRpc.app.shift_id!)
    const approve = await adminA.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'approve', p_date: '2099-03-01', p_start_time: '16:00', p_end_time: '17:00' })
    expect(approve.error).toBeNull()
    expect((await shiftsOf(castA1Id)).find(s => s.id === viaRpc.app.shift_id)).toMatchObject({ status: 'confirmed', start_time: '16:00:00', end_time: '17:00:00' })
  })
})

describe('shift_modification_requests: 直接DMLの拒否と create_shift_modification_request の認可', () => {
  async function confirmedShift(castId: string, storeId: string, over: Partial<Database['public']['Tables']['shifts']['Insert']> = {}) {
    const { data, error } = await service.from('shifts').insert({
      cast_id: castId, store_id: storeId, date: '2099-12-05', start_time: '18:00', end_time: '23:00', status: 'confirmed', ...over,
    }).select('id').single()
    if (error || !data) throw error
    await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id, adminAId, adminA2Id])
    return data.id
  }
  const shiftStatus = async (id: string) => (await service.from('shifts').select('status').eq('id', id).maybeSingle()).data?.status ?? null

  it('キャストは shift_modification_requests を直接INSERT/UPDATE/DELETEできない（SELECTのみ）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await castA1.from('shift_modification_requests').insert({ shift_id: shiftId, requested_by: castA1Id, reason: 'x' })).error).not.toBeNull()
    const { data: req } = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'テスト' })
    expect((await castA1.from('shift_modification_requests').update({ status: 'approved' }).eq('id', req!.id)).error).not.toBeNull()
    expect((await castA1.from('shift_modification_requests').delete().eq('id', req!.id)).error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('status').eq('id', req!.id).single()).data?.status).toBe('pending')
  })

  it('管理者も shift_modification_requests を直接UPDATE/DELETEできない（承認・却下・キャンセルは review_shift_modification_request 経由のみ）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { data: req } = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'テスト' })
    expect((await adminA.from('shift_modification_requests').update({ status: 'approved', reviewed_by: adminAId }).eq('id', req!.id)).error).not.toBeNull()
    expect((await adminA.from('shift_modification_requests').delete().eq('id', req!.id)).error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('status').eq('id', req!.id).single()).data?.status).toBe('pending')
  })

  it('作成が成功すると、shiftのstatus変更・申請の作成・管理者通知が同時に成立する（片方だけ成立しない）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { data: req, error } = await castA1.rpc('create_shift_modification_request', {
      p_shift_id: shiftId, p_new_date: '2099-12-06', p_new_start_time: '19:00', p_new_end_time: '22:00', p_reason: 'テスト',
    })
    expect(error).toBeNull()
    expect(req).toMatchObject({ shift_id: shiftId, requested_by: castA1Id, status: 'pending', new_date: '2099-12-06', new_start_time: '19:00:00', new_end_time: '22:00:00' })
    expect((await service.from('shifts').select('status').eq('id', shiftId).single()).data?.status).toBe('modification_requested')
    expect((await notifsOf([adminAId, adminA2Id], 'シフト修正申請が届きました')).length).toBe(2)
  })

  it('自分以外のキャストの確定シフトへは修正申請を作成できない', async () => {
    const shiftId = await confirmedShift(castA2Id, storeAId)
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('id').eq('shift_id', shiftId)).data).toEqual([])
    expect(await shiftStatus(shiftId)).toBe('confirmed')
  })

  it('cast_idは本人でも store_id が自店舗と異なるシフトへは修正申請を作成できない（データ不整合の防御）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeBId) // 通常起こり得ない組み合わせだが、DB側の明示チェックを確認する
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('id').eq('shift_id', shiftId)).data).toEqual([])
  })

  it('確定(confirmed)以外の状態のシフトへは修正申請を作成できない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId, { status: 'submitted' })
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('id').eq('shift_id', shiftId)).data).toEqual([])
  })

  it('既にpendingの修正申請があるシフトへは重複して作成できない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const first = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: '1回目' })
    expect(first.error).toBeNull()
    const second = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: '2回目' })
    expect(second.error).not.toBeNull()
    expect((await service.from('shift_modification_requests').select('id').eq('shift_id', shiftId)).data).toHaveLength(1)
    // 1件目が却下されて申請が pending でなくなれば、同じshiftへ新しい申請を再度作れる
    expect((await adminA.rpc('review_shift_modification_request', { p_request_id: first.data!.id, p_action: 'reject', p_reject_reason: 'だめ' })).error).toBeNull()
    const third = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: '3回目' })
    expect(third.error).toBeNull()
  })

  it('理由が空・未指定なら作成できない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: '' })).error).not.toBeNull()
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: '   ' })).error).not.toBeNull()
  })

  it('管理者・ownerロールでは呼び出せない（キャストのみ作成できる）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await adminA.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).not.toBeNull()
  })
})

// v7レビューで指摘: shiftsの既存ポリシー「shifts: cast が確定シフトに修正申請」（20260819080000）が残っていると、
// キャストがshifts.statusを直接confirmed→modification_requestedへUPDATEでき、create_shift_modification_requestを
// 迂回して「shiftはmodification_requestedだが申請が無い・管理者通知も無い」不整合を作れた。また管理者の既存の
// 全操作ポリシーにより、pendingの修正申請があるshiftを直接confirmed/rejected/submitted等へ変更・削除すると
// 「申請はpendingのまま・shiftだけ変わる／消える」不整合も作れた。この節はその迂回経路が閉じられていることを確認する。
describe('修正申請RPCを迂回する直接shifts操作の拒否（guard_linked_modification_request_status/delete）', () => {
  async function confirmedShift(castId: string, storeId: string, over: Partial<Database['public']['Tables']['shifts']['Insert']> = {}) {
    const { data, error } = await service.from('shifts').insert({
      cast_id: castId, store_id: storeId, date: '2099-12-08', start_time: '18:00', end_time: '23:00', status: 'confirmed', ...over,
    }).select('id').single()
    if (error || !data) throw error
    await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id, adminAId, adminA2Id])
    return data.id
  }
  const shiftStatus = async (id: string) => (await service.from('shifts').select('status').eq('id', id).maybeSingle()).data?.status ?? null
  const shiftExists = async (id: string) => (await service.from('shifts').select('id').eq('id', id)).data!.length > 0
  const pendingReqOf = async (shiftId: string) => (await service.from('shift_modification_requests').select('id, status').eq('shift_id', shiftId).eq('status', 'pending')).data ?? []

  it('キャストは shifts.status を直接 confirmed→modification_requested へUPDATEできない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { data, error } = await castA1.from('shifts').update({ status: 'modification_requested' }).eq('id', shiftId).select()
    // RLSにより対象行が無くなり、エラーにはならず0件更新で返る（既存の「未確定シフト更新」ポリシーの挙動と同じ）
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('直接変更の試みが失敗した後も、shiftはconfirmedのまま・修正申請は0件のまま', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    await castA1.from('shifts').update({ status: 'modification_requested' }).eq('id', shiftId)
    expect(await shiftStatus(shiftId)).toBe('confirmed')
    expect(await pendingReqOf(shiftId)).toEqual([])
  })

  it('pending修正申請があるシフトを、管理者が直接 confirmed/rejected/submitted へ変更できない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).toBeNull()
    for (const status of ['confirmed', 'rejected', 'submitted'] as const) {
      const { error } = await adminA.from('shifts').update({ status }).eq('id', shiftId)
      expect(error, status).not.toBeNull()
      expect(error?.code, status).toBe('22023')
    }
    // shiftはmodification_requestedのまま、申請もpendingのまま（食い違わない）
    expect(await shiftStatus(shiftId)).toBe('modification_requested')
    expect(await pendingReqOf(shiftId)).toHaveLength(1)
  })

  it('pending修正申請があるシフトを、管理者が直接削除できない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).toBeNull()
    const { error } = await adminA.from('shifts').delete().eq('id', shiftId)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('22023')
    expect(await shiftExists(shiftId)).toBe(true)
    expect(await pendingReqOf(shiftId)).toHaveLength(1)
  })

  it('pendingの修正申請が無いシフトは、管理者が通常どおり直接confirmed/rejected等へ変更・削除できる（ガードが無関係なシフトまで塞がない）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await adminA.from('shifts').update({ status: 'rejected' }).eq('id', shiftId)).error).toBeNull()
    expect(await shiftStatus(shiftId)).toBe('rejected')
    expect((await adminA.from('shifts').delete().eq('id', shiftId)).error).toBeNull()
    expect(await shiftExists(shiftId)).toBe(false)
  })

  it('create_shift_modification_request経由の作成は成功し、shiftのstatus変更・申請の作成が同時に成立する', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { error } = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })
    expect(error).toBeNull()
    expect(await shiftStatus(shiftId)).toBe('modification_requested')
    expect(await pendingReqOf(shiftId)).toHaveLength(1)
  })

  it('review_shift_modification_request経由の承認・却下・承認してキャンセルはすべて成功する（ガードに阻まれない）', async () => {
    // 承認（他の2件と時間帯が重ならないよう、それぞれ別の時間帯のシフトを使う。同時に複数のconfirmedシフトを
    // 同じキャストへ重ねて作れないため）
    const s1 = await confirmedShift(castA1Id, storeAId, { start_time: '10:00', end_time: '12:00' })
    const r1 = await castA1.rpc('create_shift_modification_request', { p_shift_id: s1, p_reason: 'x' })
    const approve = await adminA.rpc('review_shift_modification_request', { p_request_id: r1.data!.id, p_action: 'approve', p_date: '2099-12-08', p_start_time: '19:00', p_end_time: '22:00' })
    expect(approve.error).toBeNull()
    expect(await shiftStatus(s1)).toBe('confirmed')
    expect(await pendingReqOf(s1)).toEqual([])

    // 却下
    const s2 = await confirmedShift(castA1Id, storeAId, { start_time: '13:00', end_time: '15:00' })
    const r2 = await castA1.rpc('create_shift_modification_request', { p_shift_id: s2, p_reason: 'x' })
    const reject = await adminA.rpc('review_shift_modification_request', { p_request_id: r2.data!.id, p_action: 'reject', p_reject_reason: 'だめ' })
    expect(reject.error).toBeNull()
    expect(await shiftStatus(s2)).toBe('confirmed')
    expect(await pendingReqOf(s2)).toEqual([])

    // 承認してキャンセル
    const s3 = await confirmedShift(castA1Id, storeAId, { start_time: '16:00', end_time: '18:00' })
    const r3 = await castA1.rpc('create_shift_modification_request', { p_shift_id: s3, p_reason: 'x' })
    const cancel = await adminA.rpc('review_shift_modification_request', { p_request_id: r3.data!.id, p_action: 'approve_cancel' })
    expect(cancel.error).toBeNull()
    expect(await shiftExists(s3)).toBe(false)
  })

  it('service_role（サーバーAPI・管理用スクリプト）は、pendingの修正申請があるシフトも直接操作できる（RLSと同じ信頼境界）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    expect((await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })).error).toBeNull()
    expect((await service.from('shifts').update({ status: 'confirmed' }).eq('id', shiftId)).error).toBeNull()
    expect((await service.from('shifts').delete().eq('id', shiftId)).error).toBeNull()
  })

  // v7レビューで指摘: 承認画面（modification-request-list.tsx）のTimeSelectはデフォルトで24:00〜29:45も選べるため、
  // 開始=終了の時刻をそのまま渡せてしまう。開始=終了は空き枠(create_vacant_slot)と同じ規則で「入力ミス」として拒否し、
  // 24時間勤務の表現には使わない（vacant-slot-window.tsの「開始=終了は24時間枠として扱わない」という既存の規約と同じ）
  it('承認(approve)で開始時刻=終了時刻を指定すると拒否され、shift・申請とも変更されない', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { data: req } = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })
    const { error } = await adminA.rpc('review_shift_modification_request', {
      p_request_id: req!.id, p_action: 'approve', p_date: '2099-12-08', p_start_time: '20:00', p_end_time: '20:00',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
    expect(await shiftStatus(shiftId)).toBe('modification_requested')
    expect(await pendingReqOf(shiftId)).toHaveLength(1)
  })

  it('承認(approve)は24:00以上の時刻（例: 25:00）を型変換の段階で拒否する（正規化せずに渡すとDBのtime型で失敗する）', async () => {
    const shiftId = await confirmedShift(castA1Id, storeAId)
    const { data: req } = await castA1.rpc('create_shift_modification_request', { p_shift_id: shiftId, p_reason: 'x' })
    const { error } = await adminA.rpc('review_shift_modification_request', {
      p_request_id: req!.id, p_action: 'approve', p_date: '2099-12-08', p_start_time: '25:00', p_end_time: '26:00',
    })
    expect(error).not.toBeNull()
    // 画面側はnormalizeTime()で00:00〜23:45へ正規化してから渡すため、実運用でこのエラーには到達しない
    expect(await shiftStatus(shiftId)).toBe('modification_requested')
  })
})

describe('却下・承認取消でshift操作が0件なら、申請の状態も変更されない', () => {
  it('【却下】紐づくshiftを削除できない（shiftの店舗が食い違う）場合は例外で全体ロールバックされ、申請はpendingのまま', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await service.from('shifts').update({ store_id: storeBId }).eq('id', app!.shift_id!)

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'rejected' })
    expect(error).not.toBeNull()
    expect(await getApp(app!.id)).toMatchObject({ status: 'pending', shift_id: app!.shift_id, reviewed_at: null, reviewed_by: null })
    expect((await service.from('shifts').select('id').eq('id', app!.shift_id!)).data?.length).toBe(1)
  })

  it('【承認取消】紐づくshiftを更新できない場合は例外で全体ロールバックされ、申請はapprovedのまま', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'approved' })
    await service.from('shifts').update({ store_id: storeBId }).eq('id', app!.shift_id!)

    const { error } = await adminA.rpc('review_vacant_slot_application', { p_application_id: app!.id, p_next_status: 'pending' })
    expect(error).not.toBeNull()
    const row = await getApp(app!.id)
    expect(row).toMatchObject({ status: 'approved', shift_id: app!.shift_id })
    expect(row.reviewed_by).toBe(adminAId)
  })

  it('【非公開化】対象shiftを削除できない場合は例外で全体ロールバックされ、空き枠は公開のまま', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    // shiftを別店舗へ移して、管理者(店舗A)からは削除できない状態にする
    await service.from('shifts').update({ store_id: storeBId }).eq('id', app!.shift_id!)
    const { error } = await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })
    expect(error).not.toBeNull()
    expect((await service.from('vacant_slots').select('is_published').eq('id', slotId).single()).data?.is_published).toBe(true)
    expect((await getApp(app!.id)).shift_id).toBe(app!.shift_id)
  })
})

describe('キャスト用RPCのロール確認（管理者・ownerは実行できない）', () => {
  it('管理者は apply_vacant_slot を実行できず、shiftも申請も作られない', async () => {
    const slotId = await makeSlot()
    const { error } = await applyAs(adminA, slotId, '12:00', '15:00')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect((await service.from('shifts').select('id').eq('store_id', storeAId)).data).toEqual([])
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
  })

  it('ownerは apply_vacant_slot を実行できない', async () => {
    const slotId = await makeSlot()
    const { error } = await applyAs(ownerA, slotId, '12:00', '15:00')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect((await service.from('shifts').select('id').eq('store_id', storeAId)).data).toEqual([])
  })

  it('管理者・ownerは cancel_vacant_slot_application を実行できず、キャストの申請は残る', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    for (const client of [adminA, ownerA]) {
      const { error } = await client.rpc('cancel_vacant_slot_application', { p_application_id: app!.id })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
    }
    expect((await getApp(app!.id)).status).toBe('pending')
    expect((await shiftsOf(castA1Id)).length).toBe(1)
  })

  it('キャストは他のキャストの申請を cancel_vacant_slot_application で取り消せない', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA2, slotId, '12:00', '15:00')
    expect((await castA1.rpc('cancel_vacant_slot_application', { p_application_id: app!.id })).error).not.toBeNull()
    expect((await getApp(app!.id)).status).toBe('pending')
  })
})

describe('申請と非公開化の同時実行（空き枠単位のロック）', () => {
  it('申請(apply_vacant_slot)と非公開化(set_vacant_slot_published)を同時に走らせても、「非公開枠に申請とshiftだけが残る」状態にならない', async () => {
    const ROUNDS = 12
    let appliedFirst = 0
    let hiddenFirst = 0
    for (let i = 0; i < ROUNDS; i++) {
      const date = `2099-07-${String(i + 1).padStart(2, '0')}`
      const slotId = await makeSlot({ date })
      const [applyRes, hideRes] = await Promise.all([
        applyAs(castA1, slotId, '12:00', '15:00'),
        adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false }),
      ])
      expect(hideRes.error).toBeNull()

      const { data: slot } = await service.from('vacant_slots').select('is_published').eq('id', slotId).single()
      expect(slot?.is_published).toBe(false)
      const { data: apps } = await service.from('vacant_slot_applications').select('id, shift_id').eq('vacant_slot_id', slotId)
      // 非公開になった枠の申請には、仮予定shiftが紐づいていない（管理者側の削除を取りこぼした申請とshiftだけが残る状態にならない）
      expect((apps ?? []).every(a => a.shift_id === null)).toBe(true)
      // キャストのshiftも残っていない
      expect((await shiftsOf(castA1Id)).filter(sh => sh.date === date)).toEqual([])
      // 申請が先に通った場合は申請行だけが残り(shiftなし)、非公開が先なら申請自体が拒否されている
      if (applyRes.error === null) { appliedFirst++; expect(apps?.length).toBe(1) } else { hiddenFirst++; expect(apps?.length).toBe(0) }

      await service.from('shifts').delete().eq('store_id', storeAId)
      await service.from('vacant_slots').delete().eq('id', slotId)
    }
    // どちらの順序になったかは実行ごとに異なる。不変条件（上記）が毎回満たされることが要件
    console.log(`[concurrency] rounds=${ROUNDS} apply-first=${appliedFirst} hide-first=${hiddenFirst}`)
  })

  it('直接INSERTで申請しようとしても、非公開化済みの枠には申請できない（トリガーのロック後の再確認）', async () => {
    const slotId = await makeSlot()
    await adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false })
    const { error } = await castA1.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castA1Id })
    expect(error).not.toBeNull()
  })
})

describe('空き枠作成と通知の登録（create_vacant_slot・同一トランザクション。宛先・文面・リンクはDBが決める）', () => {
  const create = (client: SupabaseClient<Database>, over: Record<string, unknown> = {}) =>
    client.rpc('create_vacant_slot', { p_date: '2099-08-10', p_start_time: '18:00', p_end_time: '23:00', p_capacity: 1, ...over })
  const createdBody = (date: string, start: string, end: string) => `${dateLabel(date)} ${formatTimeRange(start, start, end)} の空き枠`
  const notificationsFor = async (title = '空き枠が追加されました') =>
    (await service.from('notifications').select('user_id, title, body, link, created_by, store_id').in('user_id', [castA1Id, castA2Id, castB1Id, castInactiveId]).eq('title', title)).data ?? []

  it('【通常枠】公開中の空き枠が作られ、同店舗の有効なキャスト全員にだけ、DBが決めた文面・リンクの通知が作成される（他店舗・無効なキャストには作られない）', async () => {
    const { data, error } = await create(adminA)
    expect(error).toBeNull()
    const result = data as { slot_id: string; notified_count: number }
    const { data: slot } = await service.from('vacant_slots').select('*').eq('id', result.slot_id).single()
    expect(slot).toMatchObject({ store_id: storeAId, created_by: adminAId, is_published: true, capacity: 1, date: '2099-08-10', start_time: '18:00:00', end_time: '23:00:00' })

    const rows = await notificationsFor()
    expect(rows.map(r => r.user_id).sort()).toEqual([castA1Id, castA2Id].sort())
    expect(result.notified_count).toBe(2)
    expect(rows.every(r => r.body === createdBody('2099-08-10', '18:00', '23:00') && r.link === '/cast/vacant-slots' && r.created_by === adminAId && r.store_id === storeAId)).toBe(true)
    expect(rows.some(r => r.user_id === castB1Id || r.user_id === castInactiveId)).toBe(false)
  })

  it('【日またぎ枠】通知の文面に日付・時間・「翌」表記が入る（22:00〜翌05:00）', async () => {
    const { error } = await create(adminA, { p_date: '2099-08-11', p_start_time: '22:00', p_end_time: '05:00' })
    expect(error).toBeNull()
    const rows = await notificationsFor()
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.body === createdBody('2099-08-11', '22:00', '05:00') && r.body!.includes('22:00〜翌05:00'))).toBe(true)
  })

  it('通知のタイトル・本文・リンクは呼び出し側から指定できない（旧引数を渡すと関数が見つからず拒否され、空き枠も通知も作られない）', async () => {
    const { error } = await create(adminA, { p_notification_title: 'x', p_notification_body: 'y', p_notification_link: 'https://evil.example/' })
    expect(error).not.toBeNull()
    expect((await service.from('vacant_slots').select('id').eq('store_id', storeAId)).data).toEqual([])
    expect(await notificationsFor()).toEqual([])
  })

  it('キャスト・ownerは実行できず、何も作られない（管理者のみ）', async () => {
    expect((await create(castA1)).error?.code).toBe('42501')
    expect((await create(ownerA)).error?.code).toBe('42501')
    expect((await service.from('vacant_slots').select('id').eq('store_id', storeAId)).data).toEqual([])
    expect(await notificationsFor()).toEqual([])
  })

  it('他店舗の管理者が実行しても、通知は自店舗（店舗B）のキャストにだけ作られ、店舗Aのキャストには作られない', async () => {
    const { data, error } = await create(adminB)
    expect(error).toBeNull()
    expect((await notificationsFor()).map(r => r.user_id)).toEqual([castB1Id])
    const { data: slot } = await service.from('vacant_slots').select('store_id').eq('id', (data as { slot_id: string }).slot_id).single()
    expect(slot?.store_id).toBe(storeBId)
  })

  it('他店舗のルーム・エリアは指定できず、不正な入力（開始=終了・24:00・募集人数0・ルーム定員超過）は拒否されて何も作られない', async () => {
    const { data: roomB } = await service.from('rooms').insert({ store_id: storeBId, name: `他店舗ルーム-${suffix}` }).select('id').single()
    const { data: areaB } = await service.from('areas').insert({ store_id: storeBId, name: `他店舗エリア-${suffix}` }).select('id').single()
    const { data: roomA } = await service.from('rooms').insert({ store_id: storeAId, name: `定員2ルーム-${suffix}`, capacity: 2 }).select('id').single()
    expect((await create(adminA, { p_room_id: roomB!.id })).error).not.toBeNull()
    expect((await create(adminA, { p_area_id: areaB!.id })).error).not.toBeNull()
    expect((await create(adminA, { p_start_time: '18:00', p_end_time: '18:00' })).error).not.toBeNull()
    expect((await create(adminA, { p_end_time: '24:00' })).error).not.toBeNull()
    expect((await create(adminA, { p_capacity: 0 })).error).not.toBeNull()
    expect((await create(adminA, { p_room_id: roomA!.id, p_capacity: 3 })).error).not.toBeNull()
    expect((await service.from('vacant_slots').select('id').eq('store_id', storeAId)).data).toEqual([])
    expect(await notificationsFor()).toEqual([])
    expect((await create(adminA, { p_room_id: roomA!.id, p_capacity: 2 })).error).toBeNull()
  })

  it('呼んだ回数だけ空き枠と通知が作られ、既存の枠は変更されない（Push失敗後の再操作を含む）', async () => {
    expect((await create(adminA)).error).toBeNull()
    expect((await create(adminA, { p_date: '2099-08-12' })).error).toBeNull()
    expect((await service.from('vacant_slots').select('id').eq('store_id', storeAId)).data?.length).toBe(2)
    expect((await notificationsFor()).length).toBe(4)
  })
})

describe('キャスト申請時の管理者通知（apply_vacant_slot・同一トランザクション。管理者のuuidは返さない）', () => {
  it('【通常枠】キャストが申請すると、同店舗のadmin全員へ通知が作成され、他店舗のadmin・キャスト・ownerには作成されない', async () => {
    const slotId = await makeSlot()
    const { data: app, error } = await applyAs(castA1, slotId, '13:00', '16:00')
    expect(error).toBeNull()

    const rows = await notifsOf([adminAId, adminA2Id, adminBId, castA1Id, castA2Id, castB1Id], '空き枠申請が届きました')
    expect(rows.map(r => r.user_id).sort()).toEqual([adminAId, adminA2Id].sort())
    expect(rows.every(r => r.body === applyBody('2099-03-01', '12:00', '13:00', '16:00') && r.link === '/admin/vacant-slots')).toBe(true)
    expect(app!.notified_count).toBe(2)
    expect(app).toMatchObject({ status: 'pending', requested_start_time: '13:00:00', requested_end_time: '16:00:00', cast_id: castA1Id })
    // キャストのブラウザへ返る内容に、管理者のuuidは含まれない
    const serialized = JSON.stringify(app)
    expect(serialized).not.toContain(adminAId)
    expect(serialized).not.toContain(adminA2Id)
  })

  it('【日またぎ枠】希望時間の「翌」表記が通知に入る（22:00〜翌05:00の枠に、翌日側の01:00〜03:00を希望）', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    await applyAs(castA1, slotId, '01:00', '03:00')
    const expected = applyBody('2099-03-01', '22:00', '01:00', '03:00')
    expect(expected).toContain('翌01:00〜翌03:00')
    expect((await notifsOf([adminAId, adminA2Id], '空き枠申請が届きました')).every(r => r.body === expected)).toBe(true)

    const slot2 = await makeSlot({ date: '2099-03-05', start_time: '22:00', end_time: '05:00' })
    await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id])
    await applyAs(castA2, slot2, '23:00', '02:00')
    const bodies = (await notifsOf([adminAId, adminA2Id], '空き枠申請が届きました')).map(r => r.body)
    expect(bodies.every(b => b === applyBody('2099-03-05', '22:00', '23:00', '02:00') && b!.includes('23:00〜翌02:00'))).toBe(true)
  })

  it('希望時刻なし(null/null)の申請は、公開枠全体の時間で通知される', async () => {
    const slotId = await makeSlot()
    await applyAs(castA1, slotId)
    expect((await notifsOf([adminAId], '空き枠申請が届きました'))[0].body).toBe(applyBody('2099-03-01', '12:00', '12:00', '18:00'))
  })

  it('他店舗のキャストが自店舗の枠へ申請した場合は、その店舗（B）のadminだけに通知される（Aのadminには届かない）', async () => {
    const slotB = await makeSlot({ store: 'B' })
    const { data: app, error } = await applyAs(castB1, slotB, '12:00', '15:00')
    expect(error).toBeNull()
    expect(app!.notified_count).toBe(1)
    expect((await notifsOf([adminBId], '空き枠申請が届きました')).length).toBe(1)
    expect((await notifsOf([adminAId, adminA2Id])).length).toBe(0)
  })

  it('キャスト側はRLSにより同店舗のadminをusersから検索できない（0件）。それでも申請すると、DB関数が管理者を特定して通知を作成する', async () => {
    const { data: adminsSeenByCast } = await castA1.from('users').select('id').eq('store_id', storeAId).eq('role', 'admin')
    expect(adminsSeenByCast ?? []).toEqual([])
    const slotId = await makeSlot()
    expect((await applyAs(castA1, slotId, '12:00', '15:00')).error).toBeNull()
    expect((await notifsOf([adminAId, adminA2Id], '空き枠申請が届きました')).length).toBe(2)
  })

  it('管理者uuid一覧を返す関数（旧 my_store_admin_ids）は存在しない', async () => {
    expect((await castA1.rpc('my_store_admin_ids' as never)).error).not.toBeNull()
  })

  it('二重申請・範囲外などで申請自体が失敗した場合は、通知も作成されない', async () => {
    const slotId = await makeSlot()
    expect((await applyAs(castA1, slotId, '11:00', '15:00')).error).not.toBeNull()
    expect((await applyAs(castA1, slotId, '12:00', '15:00')).error).toBeNull()
    await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id])
    expect((await applyAs(castA1, slotId, '15:00', '18:00')).error).not.toBeNull() // 二重申請
    expect((await notifsOf([adminAId, adminA2Id])).length).toBe(0)
  })
})

describe('承認・不承認のキャスト通知（review_vacant_slot_application・同一トランザクション）', () => {
  it('【承認】申請したキャスト本人にだけ、正しい文面の通知が作成される（戻り値は通知した人数のみで、宛先のuuidは返さない）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '13:00', '16:00')
    await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id])

    const { data, error } = await reviewAs(adminA, app!.id, 'approved')
    expect(error).toBeNull()
    const rows = await notifsOf([castA1Id, castA2Id, castB1Id, adminAId, adminA2Id])
    expect(rows).toEqual([{ user_id: castA1Id, title: '空き枠申請が承認されました', body: reviewBody('2099-03-01', '12:00', '13:00', '16:00'), link: '/cast/vacant-slots' }])
    expect(data!.notified_count).toBe(1)
    expect(data).toMatchObject({ status: 'approved', shift_id: app!.shift_id })
  })

  it('【不承認】申請したキャスト本人にだけ、不承認の通知が作成される', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data, error } = await reviewAs(adminA, app!.id, 'rejected')
    expect(error).toBeNull()
    expect(await notifsOf([castA1Id, castA2Id], '空き枠申請が不承認になりました')).toEqual([
      { user_id: castA1Id, title: '空き枠申請が不承認になりました', body: reviewBody('2099-03-01', '12:00', '12:00', '15:00'), link: '/cast/vacant-slots' },
    ])
    expect(data!.notified_count).toBe(1)
    expect((await notifsOf([castA1Id], '空き枠申請が承認されました')).length).toBe(0)
  })

  it('【日またぎ枠】通知の時間に「翌」表記が入る（承認・不承認とも）', async () => {
    const slotId = await makeSlot({ start_time: '22:00', end_time: '05:00' })
    const { data: a1 } = await applyAs(castA1, slotId, '23:00', '02:00')
    const { data: a2 } = await applyAs(castA2, slotId, '01:00', '03:00')
    await reviewAs(adminA, a1!.id, 'approved')
    await reviewAs(adminA, a2!.id, 'rejected')
    const n1 = (await notifsOf([castA1Id], '空き枠申請が承認されました'))[0]
    const n2 = (await notifsOf([castA2Id], '空き枠申請が不承認になりました'))[0]
    expect(n1.body).toBe(reviewBody('2099-03-01', '22:00', '23:00', '02:00'))
    expect(n1.body).toContain('23:00〜翌02:00')
    expect(n2.body).toBe(reviewBody('2099-03-01', '22:00', '01:00', '03:00'))
    expect(n2.body).toContain('翌01:00〜翌03:00')
  })

  it('承認取消（approved→pending）では通知しない（既存仕様）。同じ状態への再送でも通知は増えない（冪等）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await reviewAs(adminA, app!.id, 'approved')
    expect((await notifsOf([castA1Id])).length).toBe(1)

    const { data: cancelled } = await reviewAs(adminA, app!.id, 'pending')
    expect(cancelled!.notified_count).toBe(0)
    expect((await notifsOf([castA1Id])).length).toBe(1)

    await reviewAs(adminA, app!.id, 'approved') // 再承認 → 2件目
    const { data: again } = await reviewAs(adminA, app!.id, 'approved') // 冪等
    expect(again!.notified_count).toBe(0)
    expect((await notifsOf([castA1Id])).length).toBe(2)
  })

  it('他店舗の管理者は通知を作れない（承認・不承認とも拒否され、キャストへの通知は0件）', async () => {
    const slotId = await makeSlot()
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    expect((await reviewAs(adminB, app!.id, 'approved')).error).not.toBeNull()
    expect((await reviewAs(adminB, app!.id, 'rejected')).error).not.toBeNull()
    expect((await notifsOf([castA1Id])).length).toBe(0)
    expect((await getApp(app!.id)).status).toBe('pending')
  })

  it('承認が失敗した場合（募集人数超過・ルーム重複）は通知も作成されない', async () => {
    const slotId = await makeSlot({ capacity: 1 })
    const { data: a1 } = await applyAs(castA1, slotId, '12:00', '15:00')
    const { data: a2 } = await applyAs(castA2, slotId, '12:00', '15:00')
    await reviewAs(adminA, a1!.id, 'approved')
    expect((await reviewAs(adminA, a2!.id, 'approved')).error).not.toBeNull()
    expect(await notifsOf([castA2Id], '空き枠申請が承認されました')).toEqual([])
  })
})

describe('shift_idの一意性（同時INSERTでも1つのshiftを複数の申請へ紐づけられない）', () => {
  it('【同時実行】同じshiftを、同内容の2つの空き枠への申請へ同時に紐づけても、必ず片方だけが成功し、もう片方は拒否される', async () => {
    const ROUNDS = 8
    for (let i = 0; i < ROUNDS; i++) {
      const date = `2099-09-${String(i + 1).padStart(2, '0')}`
      const slot1 = await makeSlot({ date })
      const slot2 = await makeSlot({ date }) // 同じ日付・時間・ルームなし＝同内容の別枠
      const { data: shift } = await service.from('shifts').insert({
        cast_id: castA1Id, store_id: storeAId, date, start_time: '12:00', end_time: '18:00', status: 'submitted',
      }).select('id').single()

      const results = await Promise.all([slot1, slot2].map(slot =>
        service.from('vacant_slot_applications').insert({ vacant_slot_id: slot, cast_id: castA1Id, shift_id: shift!.id }).select('id')))
      const successes = results.filter(r => r.error === null).length
      expect(successes).toBe(1)
      const failure = results.find(r => r.error !== null)!
      expect(failure.error?.code).toBe('23505')
      expect((await service.from('vacant_slot_applications').select('id').eq('shift_id', shift!.id)).data?.length).toBe(1)

      await service.from('shifts').delete().eq('store_id', storeAId)
      await service.from('vacant_slots').delete().in('id', [slot1, slot2])
    }
  })

  it('shift_idがnullの申請は何件でも作成できる（一意インデックスは shift_id is not null の行だけが対象）', async () => {
    const slotId = await makeSlot()
    expect((await service.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castA1Id })).error).toBeNull()
    expect((await service.from('vacant_slot_applications').insert({ vacant_slot_id: slotId, cast_id: castA2Id })).error).toBeNull()
    expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId).is('shift_id', null)).data?.length).toBe(2)
  })
})

describe('申請と最終承認の同時実行（空き枠単位のロックで直列化）', () => {
  it('募集1人の枠で、最後の1人の承認と新規申請を同時に走らせても、定員超過・孤立したshift/通知が残らない', async () => {
    const ROUNDS = 10
    let appliedFirst = 0
    let approvedFirst = 0
    for (let i = 0; i < ROUNDS; i++) {
      const date = `2099-10-${String(i + 1).padStart(2, '0')}`
      const slotId = await makeSlot({ date, capacity: 1 })
      const { data: pending } = await applyAs(castA2, slotId, '12:00', '15:00') // 承認される側（既存のpending）
      await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id, castA2Id])

      const [approveRes, applyRes] = await Promise.all([
        reviewAs(adminA, pending!.id, 'approved'),
        applyAs(castA1, slotId, '12:00', '15:00'),
      ])
      expect(approveRes.error).toBeNull()

      // 定員（1）を超えて承認されていない
      const { data: approvedApps } = await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId).eq('status', 'approved')
      expect(approvedApps?.length).toBe(1)
      expect((await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()).data?.approved_count).toBe(1)

      // 申請が成功したなら「申請＋shift＋管理者通知」が揃っている。失敗したなら何も残っていない（仮shiftだけ・通知だけが残らない）
      const { data: castA1Apps } = await service.from('vacant_slot_applications').select('id, shift_id, status').eq('vacant_slot_id', slotId).eq('cast_id', castA1Id)
      const castA1Shifts = (await shiftsOf(castA1Id)).filter(sh => sh.date === date)
      const adminNotifs = await notifsOf([adminAId, adminA2Id], '空き枠申請が届きました')
      if (applyRes.error === null) {
        appliedFirst++
        expect(castA1Apps?.length).toBe(1)
        expect(castA1Apps![0]).toMatchObject({ status: 'pending' })
        expect(castA1Shifts.map(sh => sh.id)).toEqual([castA1Apps![0].shift_id])
        expect(adminNotifs.length).toBe(2)
      } else {
        approvedFirst++
        expect(applyRes.error.message).toContain('満員')
        expect(castA1Apps).toEqual([])
        expect(castA1Shifts).toEqual([])
        expect(adminNotifs).toEqual([])
      }
      // 承認されたキャストへの通知は1件だけ
      expect((await notifsOf([castA2Id], '空き枠申請が承認されました')).length).toBe(1)

      await service.from('shifts').delete().eq('store_id', storeAId)
      await service.from('vacant_slots').delete().eq('id', slotId)
    }
    console.log(`[concurrency apply-vs-final-approval] rounds=${ROUNDS} apply-first=${appliedFirst} approve-first=${approvedFirst}`)
  })
})

describe('notificationsの書き込み経路（直接INSERT/UPDATE/DELETEの拒否・リンク制約・用途別RPC）', () => {
  const mkNotif = async (userId: string, over: Record<string, unknown> = {}) => {
    const { data, error } = await service.from('notifications').insert({ user_id: userId, title: 'テスト', body: 'b', link: '/cast/shifts', ...over }).select('id').single()
    if (error || !data) throw error
    return data.id
  }

  it('anon（未ログイン）は notifications へ直接 INSERT / UPDATE / DELETE できず、読み取りもできない（任意の宛先・リンクでも）', async () => {
    const anon = getAnonClient()
    const id = await mkNotif(castA1Id)
    expect((await anon.from('notifications').insert({ user_id: castA1Id, title: 'phishing', link: '/cast/shifts' })).error).not.toBeNull()
    const upd = await anon.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).select()
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const del = await anon.from('notifications').delete().eq('id', id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    const sel = await anon.from('notifications').select('id').eq('id', id)
    expect(sel.error !== null || (sel.data ?? []).length === 0).toBe(true)
    expect((await service.from('notifications').select('id, read_at').eq('id', id).single()).data?.read_at).toBeNull()
  })

  it('authenticated（cast / admin / owner）は、任意の通知を直接INSERTできない（自分宛・他人宛・他店舗宛・外部リンク付きのどれも拒否）', async () => {
    const attempts: Database['public']['Tables']['notifications']['Insert'][] = [
      { user_id: castA1Id, title: '自分宛' }, { user_id: adminAId, title: '管理者宛' }, { user_id: castB1Id, title: '他店舗宛' },
      { user_id: adminAId, title: 'リンク付き', link: '/admin/shifts' }, { user_id: adminAId, title: '外部リンク', link: 'https://evil.example/' },
    ]
    for (const client of [castA1, adminA, ownerA]) {
      for (const row of attempts) expect((await client.from('notifications').insert(row)).error).not.toBeNull()
    }
    expect((await service.from('notifications').select('id').in('user_id', [castA1Id, adminAId, castB1Id])).data).toEqual([])
  })

  it('authenticatedのUPDATEは「自分の通知の read_at」だけ（title/body/link/user_idの書き換え・他人の通知の既読化は不可）', async () => {
    const id = await mkNotif(castA1Id)
    expect((await castA1.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)).error).toBeNull()
    expect((await service.from('notifications').select('read_at').eq('id', id).single()).data?.read_at).not.toBeNull()
    for (const patch of [{ title: '改ざん' }, { body: '改ざん' }, { link: '/admin/shifts' }, { user_id: castA2Id }, { created_by: castA1Id }, { push_sent_at: new Date().toISOString() }]) {
      expect((await castA1.from('notifications').update(patch as never).eq('id', id)).error).not.toBeNull()
    }
    const row = (await service.from('notifications').select('title, body, link, user_id').eq('id', id).single()).data
    expect(row).toMatchObject({ title: 'テスト', body: 'b', link: '/cast/shifts', user_id: castA1Id })
    // 他人の通知は既読化もできない（0件更新）
    const other = await mkNotif(castA2Id)
    for (const client of [castA1, adminA]) {
      const { data } = await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', other).select()
      expect(data ?? []).toEqual([])
    }
  })

  it('authenticatedは通知を直接DELETEできない。SELECTは自分の通知のみ（管理者は同店舗ユーザー宛の通知も読める＝既存仕様）', async () => {
    const id = await mkNotif(castA1Id)
    const del = await castA1.from('notifications').delete().eq('id', id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    expect((await castA1.from('notifications').select('id').eq('id', id)).data?.length).toBe(1)
    expect((await castA2.from('notifications').select('id').eq('id', id)).data).toEqual([])
    expect((await adminA.from('notifications').select('id').eq('id', id)).data?.length).toBe(1)
    expect((await adminB.from('notifications').select('id').eq('id', id)).data).toEqual([])
  })

  it('DBのCHECK制約: service_role（サーバー）でも、外部URL・プロトコル相対・許可されないパスのlinkは拒否される。許可パス・リンク無しは作成できる', async () => {
    for (const link of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/login', '/cast/../admin', '/api/push/dispatch']) {
      expect((await service.from('notifications').insert({ user_id: castA1Id, title: 'x', link })).error).not.toBeNull()
    }
    for (const link of ['/cast/shifts', '/admin/rewards/notice?cast_id=0b9d8f9e-1111-4222-8333-444455556666&from=2026-09-01&to=2026-09-30&notice_id=abc-1', null]) {
      expect((await service.from('notifications').insert({ user_id: castA1Id, title: 'x', link })).error).toBeNull()
    }
  })

  it('sync_vacant_slot_approved_count(uuid) は、anon・キャスト・管理者のいずれからも直接RPC実行できない', async () => {
    const slotId = await makeSlot()
    for (const client of [getAnonClient(), castA1, adminA, ownerA]) {
      expect((await client.rpc('sync_vacant_slot_approved_count', { target_id: slotId })).error).not.toBeNull()
    }
    // 承認処理（トリガー経由）では従来どおり集計される
    const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
    await reviewAs(adminA, app!.id, 'approved')
    expect((await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()).data?.approved_count).toBe(1)
  })

  it('【シフト提出リマインド】管理者だけが、自店舗の有効なキャストへ、DBが決めた文面・リンクの通知を作成できる（全員／指定）', async () => {
    const { data: all, error } = await adminA.rpc('send_shift_reminder')
    expect(error).toBeNull()
    expect(all).toBe(2) // castA1, castA2（無効なキャスト・他店舗のキャストには送らない）
    const rows = (await service.from('notifications').select('user_id, title, body, link, created_by, store_id').eq('title', 'シフト提出のお願い')).data ?? []
    expect(rows.map(r => r.user_id).sort()).toEqual([castA1Id, castA2Id].sort())
    expect(rows.every(r => r.body === 'まだシフトを提出していない場合は、提出をお願いします' && r.link === '/cast/shifts' && r.created_by === adminAId && r.store_id === storeAId)).toBe(true)

    await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id])
    expect((await adminA.rpc('send_shift_reminder', { p_cast_ids: [castA2Id] })).data).toBe(1)
    expect((await service.from('notifications').select('user_id').eq('title', 'シフト提出のお願い')).data?.map(r => r.user_id)).toEqual([castA2Id])
  })

  it('【シフト提出リマインド】キャスト・owner・他店舗の管理者は送れず、他店舗・無効なキャスト・管理者を宛先に指定することも拒否される', async () => {
    expect((await castA1.rpc('send_shift_reminder')).error).not.toBeNull()
    expect((await ownerA.rpc('send_shift_reminder')).error).not.toBeNull()
    expect((await getAnonClient().rpc('send_shift_reminder')).error).not.toBeNull()
    for (const ids of [[castB1Id], [castInactiveId], [adminA2Id], [castA1Id, castB1Id], []]) {
      expect((await adminA.rpc('send_shift_reminder', { p_cast_ids: ids })).error).not.toBeNull()
    }
    expect((await service.from('notifications').select('id').eq('title', 'シフト提出のお願い')).data).toEqual([])
  })

  it('【テスト通知】自分宛は誰でも作成できる。キャスト宛は管理者が自店舗の有効なキャストにだけ作成できる（文面はDBが決める）', async () => {
    expect((await castA1.rpc('send_test_notification')).data).toBe(1)
    expect((await adminA.rpc('send_test_notification', { p_target_user_id: adminAId })).data).toBe(1)
    expect((await adminA.rpc('send_test_notification', { p_target_user_id: castA2Id })).data).toBe(1)
    const rows = (await service.from('notifications').select('user_id, body, link, created_by').eq('title', 'テスト通知')).data ?? []
    expect(rows.find(r => r.user_id === castA1Id)).toMatchObject({ body: '通知の動作確認です', link: null, created_by: castA1Id })
    expect(rows.find(r => r.user_id === castA2Id)).toMatchObject({ body: '管理者からの通知テストです', created_by: adminAId })

    // 他人・他店舗・無効なキャスト・管理者宛への送信は拒否される
    for (const [client, target] of [[castA1, castA2Id], [castA1, adminAId], [adminA, castB1Id], [adminA, castInactiveId], [adminA, adminA2Id], [ownerA, castA1Id]] as const) {
      expect((await client.rpc('send_test_notification', { p_target_user_id: target })).error).not.toBeNull()
    }
    expect((await getAnonClient().rpc('send_test_notification')).error).not.toBeNull()
  })
})

describe.skipIf(!localDbAvailable())('ローカルDB直接操作による検証（アドバイザリロックの取得順・故障注入・migrationの事前チェック）', () => {
  const HOLD_MS = 2500
  const timed = async <T,>(fn: () => PromiseLike<T>) => { const t0 = Date.now(); const result = await fn(); return { result, ms: Date.now() - t0 } }

  describe('空き枠単位のアドバイザリロックを別セッションが保持している間、各RPCは待たされる', () => {
    it('apply_vacant_slot は、ロックが解放されるまで完了せず、解放後に成功する', async () => {
      const slotId = await makeSlot()
      const holder = await holdSlotAdvisoryLock(slotId, HOLD_MS)
      const { result, ms } = await timed(() => applyAs(castA1, slotId, '12:00', '15:00'))
      await holder.done
      expect(result.error).toBeNull()
      expect(ms).toBeGreaterThanOrEqual(HOLD_MS - 700)
    })

    it('review_vacant_slot_application も同じロックで待たされる（申請と最終承認が直列化される）', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      const holder = await holdSlotAdvisoryLock(slotId, HOLD_MS)
      const { result, ms } = await timed(() => reviewAs(adminA, app!.id, 'approved'))
      await holder.done
      expect(result.error).toBeNull()
      expect(ms).toBeGreaterThanOrEqual(HOLD_MS - 700)
    })

    it('set_vacant_slot_published / delete_vacant_slot も同じロックで待たされる', async () => {
      const slotId = await makeSlot()
      const h1 = await holdSlotAdvisoryLock(slotId, HOLD_MS)
      const t1 = await timed(() => adminA.rpc('set_vacant_slot_published', { p_slot_id: slotId, p_published: false }))
      await h1.done
      expect(t1.result.error).toBeNull()
      expect(t1.ms).toBeGreaterThanOrEqual(HOLD_MS - 700)

      const h2 = await holdSlotAdvisoryLock(slotId, HOLD_MS)
      const t2 = await timed(() => adminA.rpc('delete_vacant_slot', { p_slot_id: slotId }))
      await h2.done
      expect(t2.result.error).toBeNull()
      expect(t2.ms).toBeGreaterThanOrEqual(HOLD_MS - 700)
    })

    it('【対照】ロックを保持していなければ、apply_vacant_slot は待たされず短時間で完了する', async () => {
      const slotId = await makeSlot()
      const { result, ms } = await timed(() => applyAs(castA1, slotId, '12:00', '15:00'))
      expect(result.error).toBeNull()
      expect(ms).toBeLessThan(HOLD_MS - 700)
    })

    it('review_vacant_slot_application は、空き枠の行ロックより前にアドバイザリロックを取得する（行ロック待ちの最中にアドバイザリロックを保持している）', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      // 別セッションが空き枠の行をFOR UPDATEで保持する
      const rowHolder = spawn('docker', ['exec', '-i', 'supabase_db_CalendarApp', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { stdio: ['pipe', 'ignore', 'ignore'] })
      const rowHolderDone = new Promise<void>(resolve => rowHolder.on('close', () => resolve()))
      rowHolder.stdin.write(`begin; select 1 from public.vacant_slots where id = '${slotId}' for update; select pg_sleep(${HOLD_MS / 1000}) /* rowlock:${slotId} */; commit;\n`)
      rowHolder.stdin.end()
      for (let i = 0; i < 100; i++) {
        if (runLocalSql(`select count(*) from pg_stat_activity where state = 'active' and query like '%rowlock:${slotId}%' and query not like '%pg_stat_activity%';`).trim() !== '0') break
        await new Promise(r => setTimeout(r, 50))
      }
      const review = reviewAs(adminA, app!.id, 'approved') // 行ロックが取れず待たされる
      let sawAdvisoryWhileWaiting = false
      for (let i = 0; i < 80 && !sawAdvisoryWhileWaiting; i++) {
        const n = runLocalSql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.locktype = 'advisory' and l.granted and a.wait_event_type = 'Lock' and a.query ilike '%review_vacant_slot_application%';`).trim()
        sawAdvisoryWhileWaiting = n !== '0'
        if (!sawAdvisoryWhileWaiting) await new Promise(r => setTimeout(r, 50))
      }
      const result = await review
      await rowHolderDone
      expect(sawAdvisoryWhileWaiting).toBe(true)
      expect(result.error).toBeNull()
    })
  })

  describe('通知INSERTが失敗した場合、申請・shift・status変更は全体がロールバックされる（故障注入）', () => {
    // 対象ユーザー宛の通知INSERTだけを失敗させる一時トリガー（他ファイルの並行テストには影響しない）
    function failNotificationsFor(userIds: string[]) {
      const name = `t_fail_notif_${suffix}`
      const list = userIds.map(id => `'${id}'`).join(', ')
      runLocalSql(`create or replace function public.${name}() returns trigger language plpgsql as $$ begin raise exception 'injected notification failure'; end $$; drop trigger if exists ${name} on public.notifications; create trigger ${name} before insert on public.notifications for each row when (new.user_id in (${list})) execute function public.${name}();`)
      return () => runLocalSql(`drop trigger if exists ${name} on public.notifications; drop function if exists public.${name}();`)
    }
    afterEach(() => { try { runLocalSql(`drop trigger if exists t_fail_notif_${suffix} on public.notifications; drop function if exists public.t_fail_notif_${suffix}();`) } catch { /* 無ければ何もしない */ } })

    it('【申請】管理者への通知INSERTが失敗すると、申請もshiftも作られない（成功扱いにならない）', async () => {
      const slotId = await makeSlot()
      const restore = failNotificationsFor([adminAId, adminA2Id])
      const { error } = await applyAs(castA1, slotId, '12:00', '15:00')
      restore()
      expect(error).not.toBeNull()
      expect((await service.from('vacant_slot_applications').select('id').eq('vacant_slot_id', slotId)).data).toEqual([])
      expect(await shiftsOf(castA1Id)).toEqual([])
      expect((await notifsOf([adminAId, adminA2Id])).length).toBe(0)
      // 故障解除後の再申請は成功する（壊れた状態が残っていない）
      expect((await applyAs(castA1, slotId, '12:00', '15:00')).error).toBeNull()
    })

    it('【承認】キャストへの通知INSERTが失敗すると、申請statusもshiftの確定もロールバックされる', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      const restore = failNotificationsFor([castA1Id])
      const { error } = await reviewAs(adminA, app!.id, 'approved')
      restore()
      expect(error).not.toBeNull()
      expect(await getApp(app!.id)).toMatchObject({ status: 'pending', shift_id: app!.shift_id, reviewed_at: null, reviewed_by: null })
      expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['submitted'])
      expect((await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()).data?.approved_count).toBe(0)
      expect((await reviewAs(adminA, app!.id, 'approved')).error).toBeNull() // 解除後は成功
    })

    it('【不承認】キャストへの通知INSERTが失敗すると、申請statusもshiftの削除もロールバックされる', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      const restore = failNotificationsFor([castA1Id])
      const { error } = await reviewAs(adminA, app!.id, 'rejected')
      restore()
      expect(error).not.toBeNull()
      expect(await getApp(app!.id)).toMatchObject({ status: 'pending', shift_id: app!.shift_id })
      expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['submitted'])
    })

    it('【承認取消は通知しない】キャストへの通知INSERTが失敗する状況でも、承認取消は成功する（既存仕様）', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      await reviewAs(adminA, app!.id, 'approved')
      const restore = failNotificationsFor([castA1Id])
      const { error } = await reviewAs(adminA, app!.id, 'pending')
      restore()
      expect(error).toBeNull()
      expect((await getApp(app!.id)).status).toBe('pending')
    })

    it('【空き枠作成】通知INSERTが失敗すると空き枠も作られない', async () => {
      const restore = failNotificationsFor([castA1Id])
      const { error } = await adminA.rpc('create_vacant_slot', { p_date: '2099-08-20', p_start_time: '18:00', p_end_time: '23:00', p_capacity: 1 })
      restore()
      expect(error).not.toBeNull()
      expect((await service.from('vacant_slots').select('id').eq('store_id', storeAId)).data).toEqual([])
    })

    it('【シフト管理の確定】キャストへの通知INSERTが失敗すると、linked shiftの確定は申請statusごとロールバックされる', async () => {
      const slotId = await makeSlot({ capacity: 1 })
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      await service.from('notifications').delete().in('user_id', [adminAId, adminA2Id])
      const restore = failNotificationsFor([castA1Id])
      const { error } = await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app!.shift_id!)
      restore()
      expect(error).not.toBeNull()
      expect((await shiftsOf(castA1Id)).map(sh => sh.status)).toEqual(['submitted'])
      expect(await getApp(app!.id)).toMatchObject({ status: 'pending', reviewed_by: null, reviewed_at: null })
      expect((await service.from('vacant_slots').select('approved_count').eq('id', slotId).single()).data?.approved_count).toBe(0)
      expect((await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', app!.shift_id!)).error).toBeNull() // 解除後は成功
    })

    it('【通常シフト】管理者の変更・削除で通知INSERTが失敗すると、変更・削除ごとロールバックされる', async () => {
      const { data: shift } = await castA1.from('shifts').insert({ cast_id: castA1Id, store_id: storeAId, date: '2099-12-20', start_time: '18:00', end_time: '23:00', status: 'submitted' }).select('id').single()
      const restore = failNotificationsFor([castA1Id])
      const c = await adminA.from('shifts').update({ status: 'confirmed' }).eq('id', shift!.id)
      const u = await adminA.from('shifts').update({ start_time: '19:00' }).eq('id', shift!.id)
      const d = await adminA.from('shifts').delete().eq('id', shift!.id)
      restore()
      expect(c.error).not.toBeNull(); expect(u.error).not.toBeNull(); expect(d.error).not.toBeNull()
      expect((await service.from('shifts').select('status, start_time').eq('id', shift!.id).single()).data).toMatchObject({ status: 'submitted', start_time: '18:00:00' })
    })

    it('【キャストの再提出・修正申請】管理者への通知INSERTが失敗すると、再提出・修正申請の作成もロールバックされる', async () => {
      const { data: shift } = await castA1.from('shifts').insert({ cast_id: castA1Id, store_id: storeAId, date: '2099-12-21', start_time: '18:00', end_time: '23:00', status: 'rejected' }).select('id').single()
      const restore = failNotificationsFor([adminAId, adminA2Id])
      const resubmit = await castA1.from('shifts').update({ status: 'submitted' }).eq('id', shift!.id)
      expect(resubmit.error).not.toBeNull()
      expect((await service.from('shifts').select('status').eq('id', shift!.id).single()).data?.status).toBe('rejected')
      await service.from('shifts').update({ status: 'confirmed' }).eq('id', shift!.id)
      const req = await castA1.rpc('create_shift_modification_request', { p_shift_id: shift!.id, p_reason: 'x' })
      restore()
      expect(req.error).not.toBeNull()
      expect((await service.from('shift_modification_requests').select('id').eq('shift_id', shift!.id)).data).toEqual([])
      // 申請作成に失敗した場合、shiftのstatus変更（confirmed→modification_requested）も同じトランザクションでロールバックされる
      expect((await service.from('shifts').select('status').eq('id', shift!.id).single()).data?.status).toBe('confirmed')
    })

    it('【修正申請の処理・リマインド・テスト通知】通知INSERTが失敗すると、申請・shiftの更新も通知の一部作成もロールバックされる', async () => {
      const slotId = await makeSlot()
      const { data: app } = await applyAs(castA1, slotId, '12:00', '15:00')
      await reviewAs(adminA, app!.id, 'approved')
      const { data: req } = await castA1.rpc('create_shift_modification_request', { p_shift_id: app!.shift_id!, p_reason: 'x' })
      await service.from('notifications').delete().in('user_id', [castA1Id, castA2Id, adminAId, adminA2Id])

      const restore = failNotificationsFor([castA1Id])
      const review = await adminA.rpc('review_shift_modification_request', { p_request_id: req!.id, p_action: 'reject', p_reject_reason: '無理' })
      const reminder = await adminA.rpc('send_shift_reminder') // castA2への通知が先に作られても、castA1で失敗して全体が戻る
      const test = await adminA.rpc('send_test_notification', { p_target_user_id: castA1Id })
      restore()
      expect(review.error).not.toBeNull(); expect(reminder.error).not.toBeNull(); expect(test.error).not.toBeNull()
      expect((await service.from('shift_modification_requests').select('status').eq('id', req!.id).single()).data?.status).toBe('pending')
      expect((await shiftsOf(castA1Id))[0].status).toBe('modification_requested')
      expect((await service.from('notifications').select('id').in('user_id', [castA1Id, castA2Id])).data).toEqual([])
    })
  })

  describe('権限とSECURITY DEFINER関数の棚卸し（カタログ）', () => {
    const DEFINER_RPCS = ['apply_vacant_slot', 'cancel_vacant_slot_application', 'review_vacant_slot_application', 'set_vacant_slot_published',
      'delete_vacant_slot', 'create_vacant_slot', 'create_shift_modification_request', 'review_shift_modification_request', 'send_shift_reminder',
      'send_test_notification']
    const DEFINER_TRIGGERS = ['guard_linked_shift_status', 'guard_linked_shift_delete', 'guard_linked_modification_request_status',
      'guard_linked_modification_request_delete', 'notify_shift_update', 'notify_shift_delete', 'notify_modification_request_created']
    // authenticatedにもEXECUTEしない、service_role専用のDEFINER関数（v8）
    const SERVICE_ROLE_ONLY_RPCS = ['claim_pending_push_notifications']

    it('今回追加したSECURITY DEFINER関数はすべて search_path が空で、PUBLIC・anonにEXECUTEが無い（RPCはauthenticatedのみ、トリガー関数は誰にも付与しない）', () => {
      const rows = runLocalSql(`select p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || has_function_privilege('anon', p.oid, 'execute') || '|' || has_function_privilege('authenticated', p.oid, 'execute') || '|' || exists(select 1 from aclexplode(p.proacl) a where a.grantee = 0) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${[...DEFINER_RPCS, ...DEFINER_TRIGGERS, 'create_notification_internal'].map(n => `'${n}'`).join(',')}) order by 1;`).trim().split('\n')
      const byName = new Map(rows.map(r => { const [name, secdef, cfg, anon, auth, pub] = r.split('|'); return [name, { secdef, cfg, anon, auth, pub }] }))
      for (const name of [...DEFINER_RPCS, ...DEFINER_TRIGGERS]) {
        const r = byName.get(name)!
        expect(r, name).toBeDefined()
        expect(r.secdef, `${name} security definer`).toBe('true')
        expect(r.cfg, `${name} search_path`).toBe('search_path=""')
        expect(r.anon, `${name} anon execute`).toBe('false')
        expect(r.pub, `${name} PUBLIC execute`).toBe('false')
        expect(r.auth, `${name} authenticated execute`).toBe(DEFINER_RPCS.includes(name) ? 'true' : 'false')
      }
      const internal = byName.get('create_notification_internal')!
      expect(internal).toMatchObject({ secdef: 'false', cfg: 'search_path=""', anon: 'false', auth: 'false', pub: 'false' })
    })

    it('claim_pending_push_notificationsはservice_role専用（PUBLIC・anon・authenticatedにEXECUTEが無く、service_roleにはある）', () => {
      const rows = runLocalSql(`select p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || has_function_privilege('anon', p.oid, 'execute') || '|' || has_function_privilege('authenticated', p.oid, 'execute') || '|' || has_function_privilege('service_role', p.oid, 'execute') || '|' || exists(select 1 from aclexplode(p.proacl) a where a.grantee = 0) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${SERVICE_ROLE_ONLY_RPCS.map(n => `'${n}'`).join(',')}) order by 1;`).trim().split('\n')
      const byName = new Map(rows.map(r => { const [name, secdef, cfg, anon, auth, svc, pub] = r.split('|'); return [name, { secdef, cfg, anon, auth, svc, pub }] }))
      for (const name of SERVICE_ROLE_ONLY_RPCS) {
        const r = byName.get(name)!
        expect(r, name).toBeDefined()
        expect(r.secdef, `${name} security definer`).toBe('true')
        expect(r.cfg, `${name} search_path`).toBe('search_path=""')
        expect(r.anon, `${name} anon execute`).toBe('false')
        expect(r.auth, `${name} authenticated execute`).toBe('false')
        expect(r.pub, `${name} PUBLIC execute`).toBe('false')
        expect(r.svc, `${name} service_role execute`).toBe('true')
      }
    })

    it('旧トリガー・旧関数は存在しない（sync_vacant_slot_application_on_shift_confirm・my_store_admin_ids・delete_vacant_slot_application_provisional_shift）', () => {
      const n = runLocalSql(`select count(*) from pg_proc where proname in ('sync_vacant_slot_application_on_shift_confirm', 'my_store_admin_ids', 'delete_vacant_slot_application_provisional_shift');`).trim()
      expect(n).toBe('0')
      expect(runLocalSql(`select count(*) from pg_trigger where tgname = 'trg_sync_vacant_slot_application_on_shift_confirm';`).trim()).toBe('0')
    })

    it('旧ポリシー「shifts: cast が確定シフトに修正申請」は存在しない（create_shift_modification_requestを迂回できたため削除済み）', () => {
      expect(runLocalSql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'shifts' and policyname = 'shifts: cast が確定シフトに修正申請';`).trim()).toBe('0')
    })

    it('テーブル権限: notificationsは anon 権限なし・authenticated は SELECT と read_at 列のUPDATEのみ。申請テーブルは authenticated が SELECT のみ', () => {
      const tbl = (t: string, role: string) => runLocalSql(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') from information_schema.role_table_grants where table_schema = 'public' and table_name = '${t}' and grantee = '${role}';`).trim()
      expect(tbl('notifications', 'anon')).toBe('')
      expect(tbl('notifications', 'authenticated')).toBe('SELECT')
      expect(tbl('vacant_slot_applications', 'anon')).toBe('')
      expect(tbl('vacant_slot_applications', 'authenticated')).toBe('SELECT')
      expect(tbl('shift_modification_requests', 'anon')).toBe('')
      expect(tbl('shift_modification_requests', 'authenticated')).toBe('SELECT')
      const cols = runLocalSql(`select coalesce(string_agg(column_name, ',' order by column_name), '') from information_schema.column_privileges where table_schema = 'public' and table_name = 'notifications' and grantee = 'authenticated' and privilege_type = 'UPDATE';`).trim()
      expect(cols).toBe('read_at')
    })

    it('TRUNCATE は anon / authenticated ともに拒否される（notifications・vacant_slot_applications・shift_modification_requests）', () => {
      for (const role of ['anon', 'authenticated']) {
        for (const table of ['notifications', 'vacant_slot_applications', 'shift_modification_requests']) {
          expect(() => runLocalSql(`set role ${role}; truncate public.${table};`), `${role} truncate ${table}`).toThrow(/permission denied/)
        }
      }
    })
  })

  describe('vacant_slot_applications(shift_id) の一意インデックス', () => {
    it('shift_id is not null の行だけを対象にした一意インデックスが存在する', () => {
      const def = runLocalSql(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'vacant_slot_applications' and indexname = 'uq_vacant_slot_applications_shift_id';`).trim()
      expect(def).toContain('CREATE UNIQUE INDEX')
      expect(def).toContain('(shift_id)')
      expect(def).toMatch(/WHERE \(?shift_id IS NOT NULL\)?/)
    })

    it('既存データに重複がある場合、migrationの事前チェックは勝手に修正せず例外で停止する（別スキーマの複製データで実行）', async () => {
      const { readFileSync } = await import('node:fs')
      const sql = readFileSync(new URL('../../supabase/migrations/20260919000000_add_vacant_slot_application_requested_time.sql', import.meta.url), 'utf8')
      // 事前チェックのDOブロック（'v_dups' を含む最初の do $$ ... $$;）だけを取り出し、対象テーブルを検証用スキーマの複製に差し替える
      const block = sql.match(/do \$\$[\s\S]*?v_dups[\s\S]*?\n\$\$;/)![0].replaceAll('public.vacant_slot_applications', 'scratch_dup.vacant_slot_applications')
      const a = '11111111-1111-4111-8111-111111111111'
      const b = '22222222-2222-4222-8222-222222222222'
      try {
        runLocalSql(`drop schema if exists scratch_dup cascade; create schema scratch_dup; create table scratch_dup.vacant_slot_applications (id serial, shift_id uuid); insert into scratch_dup.vacant_slot_applications (shift_id) values ('${a}'), ('${a}'), ('${b}'), (null), (null);`)
        expect(() => runLocalSql(block)).toThrow(/shift_id に重複があるため/)
        // データは変更されていない（どの行も勝手に修正・削除されない）
        expect(runLocalSql(`select count(*) from scratch_dup.vacant_slot_applications;`).trim()).toBe('5')
        // 重複が無ければ（nullの重複は対象外）停止しない
        runLocalSql(`delete from scratch_dup.vacant_slot_applications where id = 2;`)
        expect(() => runLocalSql(block)).not.toThrow()
      } finally {
        runLocalSql(`drop schema if exists scratch_dup cascade;`)
      }
    })
  })

  describe('shift_modification_requests(shift_id) のpendingに限定した一意インデックス', () => {
    it('status = pending の行だけを対象にした一意インデックスが存在する', () => {
      const def = runLocalSql(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'shift_modification_requests' and indexname = 'uq_shift_modification_requests_pending_shift_id';`).trim()
      expect(def).toContain('CREATE UNIQUE INDEX')
      expect(def).toContain('(shift_id)')
      expect(def).toMatch(/WHERE \(?status = 'pending'::request_status\)?/)
    })

    it('既存データに同じshiftへの複数pending申請がある場合、migrationの事前チェックは勝手に修正せず例外で停止する（別スキーマの複製データで実行）', async () => {
      const { readFileSync } = await import('node:fs')
      const sql = readFileSync(new URL('../../supabase/migrations/20260919000000_add_vacant_slot_application_requested_time.sql', import.meta.url), 'utf8')
      // 事前チェックのDOブロックは2つ（vacant_slot_applications用・shift_modification_requests用）あるため、後者だけを取り出す
      const blocks = sql.match(/do \$\$[\s\S]*?v_dups[\s\S]*?\n\$\$;/g)!
      const block = blocks.find(b => b.includes('shift_modification_requests'))!.replaceAll('public.shift_modification_requests', 'scratch_dup.shift_modification_requests')
      const a = '11111111-1111-4111-8111-111111111111'
      const b = '22222222-2222-4222-8222-222222222222'
      try {
        runLocalSql(`drop schema if exists scratch_dup cascade; create schema scratch_dup; create table scratch_dup.shift_modification_requests (id serial, shift_id uuid, status request_status not null default 'pending'); insert into scratch_dup.shift_modification_requests (shift_id, status) values ('${a}', 'pending'), ('${a}', 'pending'), ('${a}', 'approved'), ('${b}', 'pending'), (null, 'pending');`)
        expect(() => runLocalSql(block)).toThrow(/pending申請の重複があるため/)
        expect(runLocalSql(`select count(*) from scratch_dup.shift_modification_requests;`).trim()).toBe('5')
        // 重複が無ければ（承認済みの重複・nullの重複は対象外）停止しない
        runLocalSql(`delete from scratch_dup.shift_modification_requests where id = 2;`)
        expect(() => runLocalSql(block)).not.toThrow()
      } finally {
        runLocalSql(`drop schema if exists scratch_dup cascade;`)
      }
    })
  })
})

// v7レビューで指摘: /api/push/dispatch が「直近1分の件数確認」と「未送信通知のclaim」を別クエリで行っていたため、
// 同じ呼び出し元から同時に複数リクエストが来ると、両方が古い件数を見て別々の通知をclaimし、
// MAX_PUSH_PER_MINUTEを超えて送ってしまう可能性があった。claim_pending_push_notifications
// （呼び出し元単位のアドバイザリロックで「確認→claim」を直列化）が、同時呼び出しでも上限を守ることを確認する。
//
// v7再レビューで指摘: このRPCが authenticated にEXECUTEされており、ブラウザから直接呼べば
// ①任意の大きな上限値を指定して連続送信抑止を無効化できる、②通知行全体（宛先user_id含む）を取得できる、
// という問題があった。v8でPUBLIC/anon/authenticatedからEXECUTEを剥奪し、service_role専用にした。
// 呼び出し元の識別はauth.uid()ではなく明示引数p_user_idで行うため、以下のテストは（route.tsと同じく）
// serviceクライアント（service_role）から p_user_id を明示して呼び出す。
describe('claim_pending_push_notifications: service_role専用・直接呼び出しの拒否', () => {
  const insertUnclaimed = async (title: string) =>
    (await service.from('notifications').insert({ user_id: castA1Id, title, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId }).select('id, push_sent_at').single()).data!

  it('authenticated（キャスト）はclaim_pending_push_notificationsを直接実行できない（EXECUTE権限が無い）', async () => {
    const { error } = await castA1.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 200, p_pending_window_minutes: 15, p_max_batch: 100 })
    expect(error).not.toBeNull()
  })

  it('authenticated（管理者・owner）も直接実行できない', async () => {
    expect((await adminA.rpc('claim_pending_push_notifications', { p_user_id: adminAId })).error).not.toBeNull()
    expect((await ownerA.rpc('claim_pending_push_notifications', { p_user_id: adminAId })).error).not.toBeNull()
  })

  it('直接呼び出しを試みても、push_sent_atは変更されない（確保処理自体が実行されていない）', async () => {
    const row = await insertUnclaimed(`直接呼び出し拒否テスト-${suffix}`)
    await castA1.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 200, p_pending_window_minutes: 15, p_max_batch: 100 })
    const after = (await service.from('notifications').select('push_sent_at').eq('id', row.id).single()).data
    expect(after?.push_sent_at).toBeNull()
  })

  it('直接呼び出しでは、通知データ（宛先user_id等）を取得できない', async () => {
    await insertUnclaimed(`直接呼び出しuser_id漏洩テスト-${suffix}`)
    const { data, error } = await castA1.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 200, p_pending_window_minutes: 15, p_max_batch: 100 })
    expect(error).not.toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('anon（未ログイン）も直接実行できない', async () => {
    const anon = getAnonClient()
    expect((await anon.rpc('claim_pending_push_notifications', { p_user_id: castA1Id })).error).not.toBeNull()
  })
})

describe('claim_pending_push_notifications: 残量計算（least(p_max_batch, p_max_per_minute - v_recent)）', () => {
  it('直近の送信件数が上限に近い場合（直近2件・上限3件・batch3件）、追加確保は残り枠の1件だけに制限される', async () => {
    await service.from('notifications').insert(Array.from({ length: 2 }, (_, i) => ({
      user_id: castA1Id, title: `残量テストA-送信済-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId, push_sent_at: new Date().toISOString(),
    })))
    await service.from('notifications').insert(Array.from({ length: 5 }, (_, i) => ({
      user_id: castA1Id, title: `残量テストA-未送信-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId,
    })))
    const { data, error } = await service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 3, p_pending_window_minutes: 15, p_max_batch: 3 })
    expect(error).toBeNull()
    expect(data).toHaveLength(1) // least(3, 3-2) = 1。v7の実装では3件確保でき、合計5件（3+2）が上限3件を超えていた
  })

  it('直近の送信件数が多い場合（直近150件・上限200件・batch100件）も、追加確保は残り枠の50件だけに制限される', async () => {
    await service.from('notifications').insert(Array.from({ length: 150 }, (_, i) => ({
      user_id: castA1Id, title: `残量テストB-送信済-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId, push_sent_at: new Date().toISOString(),
    })))
    await service.from('notifications').insert(Array.from({ length: 60 }, (_, i) => ({
      user_id: castA1Id, title: `残量テストB-未送信-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId,
    })))
    const { data, error } = await service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 200, p_pending_window_minutes: 15, p_max_batch: 100 })
    expect(error).toBeNull()
    expect(data).toHaveLength(50) // least(100, 200-150) = 50。v7の実装では100件確保でき、合計250件が上限200件を超えていた
  }, 30000)

  it('残り枠が0以下なら拒否される（errcode 23514。route.tsはこれを429にマップする）', async () => {
    await service.from('notifications').insert(Array.from({ length: 5 }, (_, i) => ({
      user_id: castA1Id, title: `残量ゼロテスト-送信済-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId, push_sent_at: new Date().toISOString(),
    })))
    const { error } = await service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 5, p_pending_window_minutes: 15, p_max_batch: 10 })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })

  it('上限値の引数にDB側の固定上限を超える値を渡しても、固定上限でクランプされる（p_max_per_minute=999999でも200件を超えて確保しない）', async () => {
    await service.from('notifications').insert(Array.from({ length: 210 }, (_, i) => ({
      user_id: castA1Id, title: `クランプテスト-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId,
    })))
    const { data, error } = await service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 999999, p_pending_window_minutes: 999999, p_max_batch: 999999 })
    expect(error).toBeNull()
    expect(data!.length).toBeLessThanOrEqual(200) // DB固定上限(v_hard_max_per_minute=200・v_hard_max_batch=100)を超えない
  }, 30000)
})

describe('claim_pending_push_notifications: 同時実行でも合計の確保件数が上限を超えない', () => {
  it('同時に2つ呼び出すと、片方は上限(p_max_per_minute)に達して拒否され、確保される合計件数は上限ちょうどになる', async () => {
    await service.from('notifications').insert(Array.from({ length: 10 }, (_, i) => ({
      user_id: castA1Id, title: `並行dispatchテスト${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId,
    })))
    const call = () => service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 3, p_pending_window_minutes: 15, p_max_batch: 3 })
    const [r1, r2] = await Promise.all([call(), call()])
    const claimedTotal = (r1.data?.length ?? 0) + (r2.data?.length ?? 0)
    expect(claimedTotal).toBe(3) // 上限3件ちょうど（3+3=6にはならない）
    const results = [r1, r2]
    const errored = results.filter(r => r.error !== null)
    const succeeded = results.filter(r => r.error === null)
    expect(errored).toHaveLength(1)
    expect(errored[0].error?.code).toBe('23514') // 上限超過は23514（route.tsはこれを429にマップする）
    expect(succeeded).toHaveLength(1)
    expect(succeeded[0].data).toHaveLength(3)
    // 確保された通知のpush_sent_atが実際に設定されている（claim漏れが無い）
    const claimedIds = [...(r1.data ?? []), ...(r2.data ?? [])].map(n => n.id)
    const rows = (await service.from('notifications').select('id, push_sent_at').in('id', claimedIds)).data ?? []
    expect(rows.every(r => r.push_sent_at !== null)).toBe(true)
  })

  it('上限に余裕があれば、同時に呼び出しても通知が重複して確保されない（合計が対象件数を超えない）', async () => {
    await service.from('notifications').insert(Array.from({ length: 6 }, (_, i) => ({
      user_id: castA1Id, title: `並行dispatchテスト2-${i}-${suffix}`, link: '/cast/shifts', created_by: castA1Id, store_id: storeAId,
    })))
    const call = () => service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 100, p_pending_window_minutes: 15, p_max_batch: 100 })
    const [r1, r2] = await Promise.all([call(), call()])
    expect(r1.error).toBeNull(); expect(r2.error).toBeNull()
    const ids1 = (r1.data ?? []).map(n => n.id)
    const ids2 = (r2.data ?? []).map(n => n.id)
    // 同じ通知が両方のレスポンスに重複して含まれない（行ロック＋WHERE再評価で保証される）
    expect(ids1.filter(id => ids2.includes(id))).toEqual([])
    expect(ids1.length + ids2.length).toBe(6)
  })

  it('自分以外(created_by)の通知は確保対象にならない', async () => {
    await service.from('notifications').insert({ user_id: castA2Id, title: `他人の通知-${suffix}`, link: '/cast/shifts', created_by: castA2Id, store_id: storeAId })
    const { data, error } = await service.rpc('claim_pending_push_notifications', { p_user_id: castA1Id, p_max_per_minute: 100, p_pending_window_minutes: 15, p_max_batch: 100 })
    expect(error).toBeNull()
    expect((data ?? []).some(n => n.title === `他人の通知-${suffix}`)).toBe(false)
  })
})

describe('認証なしのRPC呼び出し', () => {
  it('anon（未ログイン）はRPCを実行できない', async () => {
    const anon = getAnonClient()
    const slotId = await makeSlot()
    expect((await anon.rpc('apply_vacant_slot', { p_vacant_slot_id: slotId })).error).not.toBeNull()
    expect((await anon.rpc('delete_vacant_slot', { p_slot_id: slotId })).error).not.toBeNull()
    expect((await anon.rpc('create_shift_modification_request', { p_shift_id: slotId, p_reason: 'x' })).error).not.toBeNull()
    // claim_pending_push_notifications のanon拒否は「claim_pending_push_notifications: service_role専用・直接呼び出しの拒否」で確認
  })
})
