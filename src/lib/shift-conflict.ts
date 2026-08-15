import type { PostgrestError } from '@supabase/supabase-js'

/**
 * DB側の重複防止制約（shifts_no_double_booking / shifts_no_self_overlap）に
 * 引っかかった場合、原因を区別してわかりやすい日本語メッセージにする
 */
export function shiftConflictMessage(error: PostgrestError, fallback: string): string {
  if (error.code !== '23P01') return fallback
  if (error.message.includes('shifts_no_self_overlap')) return 'この時間帯は本人の別のシフトと重なっています'
  if (error.message.includes('shifts_no_double_booking')) return 'この時間帯は同じルームに既に確定シフトがあります'
  return 'この時間帯は既に他のシフトと重なっています'
}
