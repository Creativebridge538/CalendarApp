import { describe, it, expect, vi } from 'vitest'
import {
  sendSelfTestNotification, sendCastTestNotification, resolveShiftReminderTargets, runSendShiftReminder,
} from '@/lib/notification-list-actions'

// notification-list.tsx（テスト通知・シフト提出リマインド）のSupabase呼び出しの順序・分岐を、
// 実際のSupabase/ネットワークへ接続せず検証する（純粋なユニットテスト。ローカルSupabaseも不要）。

// 実際のSupabaseクライアント型（生成された型のRPC引数がリテラル関数名ごとに厳密なため）と構造的に一致させるより、
// テスト側では意図的に緩い型のスタブを使い、呼び出し先の関数シグネチャへ渡す際にキャストする。
function makeSupabaseStub(opts: { rpcError?: unknown; rpcData?: unknown; selectData?: unknown[] | null } = {}): any {
  const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({
    data: opts.rpcData ?? null,
    error: opts.rpcError ?? null,
  }))
  const limit = vi.fn(async (_n: number) => ({ data: opts.selectData ?? null }))
  const order = vi.fn((_col: string, _o: { ascending: boolean }) => ({ limit }))
  const eq = vi.fn((_col: string, _v: string) => ({ order }))
  const select = vi.fn((_cols: string) => ({ eq }))
  const from = vi.fn((_table: string) => ({ select }))
  return { rpc, from, eq, order, limit, select }
}

describe('sendSelfTestNotification（自分宛のテスト通知）', () => {
  it('RPC成功後に notifications テーブルを再取得し、結果を返す', async () => {
    const rows = [{ id: 'n1', title: 'テスト通知', body: null, link: null, read_at: null, created_at: '2026-09-28T00:00:00Z' }]
    const supabase = makeSupabaseStub({ selectData: rows })
    const result = await sendSelfTestNotification(supabase, 'user-1')
    expect(result).toEqual({ ok: true, notifications: rows })
    expect(supabase.rpc).toHaveBeenCalledWith('send_test_notification')
    expect(supabase.from).toHaveBeenCalledWith('notifications')
    expect(supabase.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(supabase.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(supabase.limit).toHaveBeenCalledWith(50)
  })

  it('RPCが失敗したら、再取得を行わずok:falseを返す（成功扱いにしない）', async () => {
    const supabase = makeSupabaseStub({ rpcError: { message: 'boom' } })
    const result = await sendSelfTestNotification(supabase, 'user-1')
    expect(result).toEqual({ ok: false })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('再取得のselectがnullを返しても、ok:trueのままnotificationsは省略される', async () => {
    const supabase = makeSupabaseStub({ selectData: null })
    const result = await sendSelfTestNotification(supabase, 'user-1')
    expect(result).toEqual({ ok: true, notifications: undefined })
  })
})

describe('sendCastTestNotification（管理者から指定キャストへのテスト通知）', () => {
  it('RPCへp_target_user_idを渡し、成功したらok:trueを返す', async () => {
    const supabase = makeSupabaseStub({})
    const result = await sendCastTestNotification(supabase, 'cast-1')
    expect(result).toEqual({ ok: true })
    expect(supabase.rpc).toHaveBeenCalledWith('send_test_notification', { p_target_user_id: 'cast-1' })
  })

  it('RPCが失敗したらok:falseを返す（成功扱いにしない）', async () => {
    const supabase = makeSupabaseStub({ rpcError: { message: '権限がありません' } })
    const result = await sendCastTestNotification(supabase, 'cast-1')
    expect(result).toEqual({ ok: false })
  })
})

describe('resolveShiftReminderTargets（シフト提出リマインドの宛先検証。RPCは呼ばない）', () => {
  const casts = [{ id: 'cast-1' }, { id: 'cast-2' }]

  it('全員を対象にした場合、rpcArgsは空オブジェクト', () => {
    expect(resolveShiftReminderTargets('all', casts)).toEqual({ ok: true, rpcArgs: {} })
  })

  it('存在する特定IDを指定した場合、rpcArgsにp_cast_idsを1件含める', () => {
    expect(resolveShiftReminderTargets('cast-2', casts)).toEqual({ ok: true, rpcArgs: { p_cast_ids: ['cast-2'] } })
  })

  it('存在しない特定IDを指定した場合はok:false', () => {
    expect(resolveShiftReminderTargets('cast-not-found', casts)).toEqual({ ok: false })
  })

  it('castsが空の場合（全員指定でも）はok:false', () => {
    expect(resolveShiftReminderTargets('all', [])).toEqual({ ok: false })
  })
})

describe('runSendShiftReminder（シフト提出リマインドのRPC呼び出し）', () => {
  it('成功したら送信件数を返す', async () => {
    const supabase = makeSupabaseStub({ rpcData: 2 })
    const result = await runSendShiftReminder(supabase, {})
    expect(result).toEqual({ ok: true, count: 2 })
    expect(supabase.rpc).toHaveBeenCalledWith('send_shift_reminder', {})
  })

  it('RPCが失敗したらok:falseを返す（成功扱いにしない。countも返さない）', async () => {
    const supabase = makeSupabaseStub({ rpcError: { message: '送信先のキャストがいません' } })
    const result = await runSendShiftReminder(supabase, { p_cast_ids: ['cast-1'] })
    expect(result).toEqual({ ok: false })
  })
})
