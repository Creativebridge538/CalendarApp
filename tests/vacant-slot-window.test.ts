import { describe, it, expect } from 'vitest'
import {
  isVacantSlotEnded, isVacantSlotListedForAdmin, shiftDateString, vacantSlotEndKey, vacantSlotQueryFromDate,
} from '@/lib/vacant-slot-window'

// now は nowJST()（日本時間の壁時計を表すDate）の戻り値。ここでは同じ形のDateを直接組み立てる。
const jst = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0)

// 9/19 22:00〜翌05:00 の日またぎ枠
const overnight = { date: '2026-09-19', start_time: '22:00:00', end_time: '05:00:00' }

describe('日またぎ空き枠（9/19 22:00〜翌05:00）が0時を過ぎても表示対象のまま残る', () => {
  it('9/19 23:00 はまだ進行中', () => {
    expect(isVacantSlotEnded(overnight, jst(2026, 9, 19, 23, 0))).toBe(false)
  })

  it('9/20 00:00 を過ぎても終了していない（従来は date >= 今日 で消えていた）', () => {
    expect(isVacantSlotEnded(overnight, jst(2026, 9, 20, 0, 0))).toBe(false)
  })

  it('9/20 01:00 は終了していない → キャスト画面・管理者画面・pending件数の対象', () => {
    const now = jst(2026, 9, 20, 1, 0)
    expect(isVacantSlotEnded(overnight, now)).toBe(false)
    expect(isVacantSlotListedForAdmin(overnight, now)).toBe(true)
  })

  it('9/20 04:59 はまだ終了していない', () => {
    expect(isVacantSlotEnded(overnight, jst(2026, 9, 20, 4, 59))).toBe(false)
  })

  it('9/20 05:00 ちょうどから終了済み → キャストの募集一覧から除外、管理画面・件数からも外れる', () => {
    const now = jst(2026, 9, 20, 5, 0)
    expect(isVacantSlotEnded(overnight, now)).toBe(true)
    expect(isVacantSlotListedForAdmin(overnight, now)).toBe(false)
  })

  it('9/20 05:01 以降も終了済み', () => {
    expect(isVacantSlotEnded(overnight, jst(2026, 9, 20, 5, 1))).toBe(true)
    expect(isVacantSlotEnded(overnight, jst(2026, 9, 21, 12, 0))).toBe(true)
  })

  it('DBの取得下限は「昨日」なので、9/20 01:00 の時点で9/19の枠が取得対象になる', () => {
    const now = jst(2026, 9, 20, 1, 0)
    expect(vacantSlotQueryFromDate(now)).toBe('2026-09-19')
    expect(overnight.date >= vacantSlotQueryFromDate(now)).toBe(true)
  })

  it('月末・年末をまたぐ日またぎ枠（12/31 22:00〜翌05:00）も翌日の終了時刻まで有効', () => {
    const slot = { date: '2026-12-31', start_time: '22:00', end_time: '05:00' }
    expect(vacantSlotEndKey(slot)).toBe('2027-01-01T05:00')
    expect(isVacantSlotEnded(slot, jst(2027, 1, 1, 4, 59))).toBe(false)
    expect(isVacantSlotEnded(slot, jst(2027, 1, 1, 5, 0))).toBe(true)
    expect(vacantSlotQueryFromDate(jst(2027, 1, 1, 1, 0))).toBe('2026-12-31')
  })
})

describe('通常の同日枠・未来枠', () => {
  const sameDay = { date: '2026-09-20', start_time: '12:00:00', end_time: '18:00:00' }

  it('【通常の未来枠】従来どおり表示される', () => {
    const future = { date: '2026-09-25', start_time: '12:00:00', end_time: '18:00:00' }
    const now = jst(2026, 9, 20, 10, 0)
    expect(isVacantSlotEnded(future, now)).toBe(false)
    expect(isVacantSlotListedForAdmin(future, now)).toBe(true)
  })

  it('【通常の終了済み同日枠】終了時刻ちょうどから終了済み（新規申請不可・キャスト一覧から除外）', () => {
    expect(isVacantSlotEnded(sameDay, jst(2026, 9, 20, 17, 59))).toBe(false)
    expect(isVacantSlotEnded(sameDay, jst(2026, 9, 20, 18, 0))).toBe(true)
    expect(isVacantSlotEnded(sameDay, jst(2026, 9, 20, 23, 0))).toBe(true)
  })

  it('同日枠は終了後も、その日のうちは管理画面・件数に残る（従来の date >= 今日 を維持）', () => {
    expect(isVacantSlotListedForAdmin(sameDay, jst(2026, 9, 20, 20, 0))).toBe(true)
    expect(isVacantSlotListedForAdmin(sameDay, jst(2026, 9, 21, 0, 0))).toBe(false)
  })

  it('過去日の同日枠は終了済み・管理画面からも外れる', () => {
    const past = { date: '2026-09-10', start_time: '12:00:00', end_time: '18:00:00' }
    const now = jst(2026, 9, 20, 10, 0)
    expect(isVacantSlotEnded(past, now)).toBe(true)
    expect(isVacantSlotListedForAdmin(past, now)).toBe(false)
  })

  it('開始=終了の退化枠は日をまたがせない（24時間枠にしない）', () => {
    const degenerate = { date: '2026-09-20', start_time: '22:00:00', end_time: '22:00:00' }
    expect(vacantSlotEndKey(degenerate)).toBe('2026-09-20T22:00')
    expect(isVacantSlotEnded(degenerate, jst(2026, 9, 20, 22, 0))).toBe(true)
  })
})

describe('ダッシュボードのpending件数（isVacantSlotListedForAdminで数える）', () => {
  it('0時を過ぎても進行中の日またぎ枠への申請が件数に含まれ、終了後・過去の同日枠は含まれない', () => {
    const rows = [
      { vacant_slots: overnight },                                                              // 進行中の日またぎ
      { vacant_slots: { date: '2026-09-20', start_time: '12:00', end_time: '18:00' } },          // 今日の枠
      { vacant_slots: { date: '2026-09-19', start_time: '12:00', end_time: '18:00' } },          // 昨日の同日枠（終了済み）
      { vacant_slots: { date: '2026-09-30', start_time: '12:00', end_time: '18:00' } },          // 未来枠
    ]
    const now = jst(2026, 9, 20, 1, 0)
    expect(rows.filter(r => isVacantSlotListedForAdmin(r.vacant_slots, now)).length).toBe(3)
    expect(rows.filter(r => isVacantSlotListedForAdmin(r.vacant_slots, jst(2026, 9, 20, 5, 0))).length).toBe(2)
  })
})

describe('shiftDateString', () => {
  it('月・年・うるう日をまたいで加減算できる', () => {
    expect(shiftDateString('2026-09-30', 1)).toBe('2026-10-01')
    expect(shiftDateString('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateString('2028-02-28', 1)).toBe('2028-02-29')
  })
})
