// notification-list.tsx（テスト通知・シフト提出リマインド）が行うSupabase呼び出しの順序・分岐を、
// コンポーネントから切り出したテスト可能な純粋関数。UIの文言表示・state更新は呼び出し元（コンポーネント）が行う。
// 引数の型は実際のSupabaseクライアント（テスト側ではその形をした最小限のスタブ）を受け取る。

import type { createClient } from '@/lib/supabase/client'

type SupabaseLike = ReturnType<typeof createClient>

interface NotificationRow {
  id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string
}

/**
 * 自分宛のテスト通知を送信し、成功したら通知一覧（直近50件）を再取得する。
 * RPCが失敗した場合は再取得を行わず、ok:falseを返す（成功扱いにしない）。
 */
export async function sendSelfTestNotification(
  supabase: SupabaseLike,
  userId: string
): Promise<{ ok: boolean; notifications?: NotificationRow[] }> {
  const { error } = await supabase.rpc('send_test_notification')
  if (error) return { ok: false }
  const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  return { ok: true, notifications: (data as NotificationRow[] | null) ?? undefined }
}

/** 管理者から指定キャストへのテスト通知送信。宛先は管理者自身ではないため、通知一覧の再取得は行わない。 */
export async function sendCastTestNotification(
  supabase: Pick<SupabaseLike, 'rpc'>,
  targetUserId: string
): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc('send_test_notification', { p_target_user_id: targetUserId })
  return { ok: !error }
}

export type ShiftReminderTargets = { ok: true; rpcArgs: { p_cast_ids?: string[] } } | { ok: false }

/**
 * シフト提出リマインドの宛先指定を検証する（純粋関数。RPCは呼ばない）。
 * 'all'以外が指定され、そのIDが渡されたキャスト一覧に無い場合、またはキャストが0人の場合は不可とする。
 */
export function resolveShiftReminderTargets(remindCastId: string, casts: { id: string }[]): ShiftReminderTargets {
  if (remindCastId !== 'all' && !casts.some(c => c.id === remindCastId)) return { ok: false }
  if (casts.length === 0) return { ok: false }
  return { ok: true, rpcArgs: remindCastId === 'all' ? {} : { p_cast_ids: [remindCastId] } }
}

/** シフト提出リマインドのRPC呼び出し。失敗した場合はok:falseを返す（成功扱いにしない）。 */
export async function runSendShiftReminder(
  supabase: Pick<SupabaseLike, 'rpc'>,
  rpcArgs: { p_cast_ids?: string[] }
): Promise<{ ok: boolean; count?: number }> {
  const { data, error } = await supabase.rpc('send_shift_reminder', rpcArgs)
  if (error) return { ok: false }
  return { ok: true, count: data as number | undefined }
}
