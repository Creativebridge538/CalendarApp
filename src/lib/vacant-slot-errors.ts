import type { PostgrestError } from '@supabase/supabase-js'
import { shiftConflictMessage } from '@/lib/shift-conflict'

const JAPANESE_TEXT = /[぀-ヿ㐀-鿿]/

/**
 * 空き枠系のDB関数（apply_vacant_slot / review_vacant_slot_application など）のエラーを
 * ユーザー向けメッセージにする。
 * - 関数・トリガーが日本語で返す業務エラー（満員・終了済み・範囲外・権限なし・再公開できない等）はそのまま表示
 * - 23P01: DBの制約が返すシフトの時間帯重複（本人の別シフト・同じルームの確定シフト）は原因別のメッセージにする
 * - それ以外（DBの英語メッセージ・関数未適用など）は内部情報を見せず fallback にする
 */
export function vacantSlotRpcErrorMessage(error: Pick<PostgrestError, 'code' | 'message'>, fallback: string, roomLabel = 'ルーム'): string {
  if (JAPANESE_TEXT.test(error.message)) return error.message
  if (error.code === '23P01') return shiftConflictMessage(error as PostgrestError, fallback, roomLabel)
  return fallback
}

export interface PublishToggleToast {
  kind: 'success' | 'error'
  message: string
}

/**
 * 公開/非公開切替(set_vacant_slot_published)の結果から、表示するtoastを1つだけ決める。
 * エラー時は成功メッセージを返さない（エラーと成功のtoastが両方出ることはない）。
 */
export function publishToggleToast(
  error: Pick<PostgrestError, 'code' | 'message'> | null,
  nextPublished: boolean,
  roomLabel = 'ルーム',
): PublishToggleToast {
  if (error) return { kind: 'error', message: vacantSlotRpcErrorMessage(error, '更新に失敗しました', roomLabel) }
  return { kind: 'success', message: nextPublished ? '公開しました' : '非公開にしました' }
}
