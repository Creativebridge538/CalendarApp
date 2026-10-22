import { describe, it, expect } from 'vitest'
import { vacantSlotRpcErrorMessage, publishToggleToast } from '@/lib/vacant-slot-errors'

describe('vacantSlotRpcErrorMessage', () => {
  it('承認上限などDB関数の日本語の業務エラーはそのまま表示する', () => {
    expect(vacantSlotRpcErrorMessage({ code: '23514', message: '募集人数（1人）に達しています' }, '処理に失敗しました'))
      .toBe('募集人数（1人）に達しています')
    expect(vacantSlotRpcErrorMessage({ code: '23514', message: 'この空き枠は終了しています' }, '申請に失敗しました'))
      .toBe('この空き枠は終了しています')
  })

  it('同じルームの確定シフトとの重複は、ルーム名付きのメッセージにする', () => {
    expect(vacantSlotRpcErrorMessage(
      { code: '23P01', message: 'shifts_no_double_booking: overlapping confirmed shift in the same room' }, '承認に失敗しました', 'ブース'))
      .toBe('この時間帯は同じブースに既に確定シフトがあります')
  })

  it('本人の別シフトとの重複を区別する', () => {
    expect(vacantSlotRpcErrorMessage(
      { code: '23P01', message: 'conflicting key value violates exclusion constraint "shifts_no_self_overlap"' }, '申請に失敗しました'))
      .toBe('この時間帯は本人の別のシフトと重なっています')
  })

  it('再公開できない場合など、23P01でも日本語の業務メッセージはそのまま表示する', () => {
    expect(vacantSlotRpcErrorMessage(
      { code: '23P01', message: '他のシフトと時間帯が重なるため、申請中・承認済みのシフトを復元できず、公開に戻せませんでした（公開状態は変更していません）' }, '更新に失敗しました'))
      .toBe('他のシフトと時間帯が重なるため、申請中・承認済みのシフトを復元できず、公開に戻せませんでした（公開状態は変更していません）')
  })

  it('DBの英語メッセージ・関数未適用のエラーは内部情報を見せずfallbackにする', () => {
    expect(vacantSlotRpcErrorMessage({ code: 'PGRST202', message: 'Could not find the function public.apply_vacant_slot in the schema cache' }, '申請に失敗しました'))
      .toBe('申請に失敗しました')
    expect(vacantSlotRpcErrorMessage({ code: '42501', message: 'new row violates row-level security policy for table "vacant_slot_applications"' }, '申請に失敗しました'))
      .toBe('申請に失敗しました')
  })
})

describe('publishToggleToast（公開切替のtoastは常に1つだけ）', () => {
  it('成功時は成功メッセージのみ（公開/非公開）', () => {
    expect(publishToggleToast(null, true)).toEqual({ kind: 'success', message: '公開しました' })
    expect(publishToggleToast(null, false)).toEqual({ kind: 'success', message: '非公開にしました' })
  })

  it('復元失敗（RPC全体がロールバック）の場合はエラーメッセージのみで、成功メッセージを返さない', () => {
    const result = publishToggleToast(
      { code: '23P01', message: '他のシフトと時間帯が重なるため、申請中・承認済みのシフトを復元できず、公開に戻せませんでした（公開状態は変更していません）' }, true)
    expect(result.kind).toBe('error')
    expect(result.message).toContain('公開に戻せませんでした')
    expect(result.message).not.toBe('公開しました')
  })

  it('英語のDBエラーは内部情報を見せずfallback（更新に失敗しました）のエラーになる', () => {
    expect(publishToggleToast({ code: 'XX000', message: 'internal error' }, false)).toEqual({ kind: 'error', message: '更新に失敗しました' })
  })
})
