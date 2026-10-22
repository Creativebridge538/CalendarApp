import { describe, it, expect } from 'vitest'
import {
  isValidRequestedRange, isValidTimeOfDay, parseTimeOfDay, resolveRequestedRange, resolveEffectiveShiftTime, formatTimeRange,
} from '@/lib/vacant-slot-request-time'

// 公開枠 12:00〜18:00（同日枠）を想定した検証。DBトリガー
// (check_vacant_slot_application_requested_time) と同じ計算式を、
// UI側のバリデーション（isValidRequestedRange）でも満たしていることを確認する。
const sameDaySlot = { start_time: '12:00:00', end_time: '18:00:00' }

// 公開枠 22:00〜翌05:00（日またぎ枠）を想定した検証。
const overnightSlot = { start_time: '22:00:00', end_time: '05:00:00' }

// 日付付きの日またぎ枠（空き枠日2026-09-19、22:00〜翌05:00）
const datedOvernightSlot = { date: '2026-09-19', start_time: '22:00:00', end_time: '05:00:00' }

describe('isValidRequestedRange（同日枠）', () => {
  it('公開枠と同じ範囲は許可される', () => {
    expect(isValidRequestedRange(sameDaySlot, '12:00', '18:00')).toBe(true)
  })

  it('枠内の前半（12:00〜15:00）は許可される', () => {
    expect(isValidRequestedRange(sameDaySlot, '12:00', '15:00')).toBe(true)
  })

  it('枠内の後半（14:00〜17:00）は許可される', () => {
    expect(isValidRequestedRange(sameDaySlot, '14:00', '17:00')).toBe(true)
  })

  it('開始が枠より前にはみ出す場合（11:00〜15:00）は拒否される', () => {
    expect(isValidRequestedRange(sameDaySlot, '11:00', '15:00')).toBe(false)
  })

  it('終了が枠より後にはみ出す場合（12:00〜19:00）は拒否される', () => {
    expect(isValidRequestedRange(sameDaySlot, '12:00', '19:00')).toBe(false)
  })

  it('開始と終了が同じ場合（15:00〜15:00）は拒否される', () => {
    expect(isValidRequestedRange(sameDaySlot, '15:00', '15:00')).toBe(false)
  })

  it('開始が終了より後の場合（16:00〜15:00）は拒否される', () => {
    expect(isValidRequestedRange(sameDaySlot, '16:00', '15:00')).toBe(false)
  })
})

describe('isValidRequestedRange（日またぎ枠 22:00〜翌05:00）', () => {
  it('枠内（23:00〜翌02:00）は許可される', () => {
    expect(isValidRequestedRange(overnightSlot, '23:00', '02:00')).toBe(true)
  })

  it('枠内（01:00〜翌03:00）は許可される', () => {
    expect(isValidRequestedRange(overnightSlot, '01:00', '03:00')).toBe(true)
  })

  it('公開枠と同じ範囲（22:00〜翌05:00）は許可される', () => {
    expect(isValidRequestedRange(overnightSlot, '22:00', '05:00')).toBe(true)
  })

  it('開始が枠より前にはみ出す場合（21:00〜翌01:00）は拒否される', () => {
    expect(isValidRequestedRange(overnightSlot, '21:00', '01:00')).toBe(false)
  })

  it('終了が枠より後にはみ出す場合（23:00〜翌06:00）は拒否される', () => {
    expect(isValidRequestedRange(overnightSlot, '23:00', '06:00')).toBe(false)
  })

  it('開始と終了が同じ場合（23:00〜23:00）は拒否される', () => {
    expect(isValidRequestedRange(overnightSlot, '23:00', '23:00')).toBe(false)
  })
})

// PostgreSQLのtime型は25:00等を保存できない。TimeSelectの24:00〜29:45は空き枠画面では選ばせず(maxHour=23)、
// 万一クライアント検証まで届いても isValidRequestedRange が24:00以上・不正値を拒否してDBへ送らない。
describe('isValidRequestedRange（24:00以上・不正な時刻の拒否）', () => {
  const lateSlot = { start_time: '18:00:00', end_time: '23:45:00' }

  it('23:45 は有効になり得る（枠が23:45まで公開されている場合）', () => {
    expect(isValidRequestedRange(lateSlot, '22:00', '23:45')).toBe(true)
    expect(isValidRequestedRange(lateSlot, '23:00', '23:45')).toBe(true)
  })

  it('24:00 は空き枠申請では無効（日をまたぐ枠でも終了24:00は送らせない）', () => {
    expect(isValidRequestedRange(lateSlot, '22:00', '24:00')).toBe(false)
    expect(isValidRequestedRange({ start_time: '22:00:00', end_time: '05:00:00' }, '23:00', '24:00')).toBe(false)
    expect(isValidRequestedRange({ start_time: '12:00:00', end_time: '18:00:00' }, '24:00', '18:00')).toBe(false)
  })

  it('25:00 など24時を超える値は開始・終了どちらに来ても無効', () => {
    const overnightSlot = { start_time: '22:00:00', end_time: '05:00:00' }
    expect(isValidRequestedRange(overnightSlot, '22:00', '25:00')).toBe(false)
    expect(isValidRequestedRange(overnightSlot, '25:00', '03:00')).toBe(false)
    expect(isValidRequestedRange(overnightSlot, '29:45', '29:45')).toBe(false)
  })

  it('形式不正・空文字・NaN・文字列以外は無効', () => {
    const slot = { start_time: '12:00:00', end_time: '18:00:00' }
    for (const bad of ['', 'abc', '12', '12:5', '1:00', '12:60', '12:00:60', '-1:00', '12:00 ', 'NaN:NaN', '１２:００']) {
      expect(isValidRequestedRange(slot, bad, '15:00')).toBe(false)
      expect(isValidRequestedRange(slot, '13:00', bad)).toBe(false)
    }
    expect(isValidRequestedRange(slot, NaN as unknown as string, '15:00')).toBe(false)
    expect(isValidRequestedRange(slot, undefined as unknown as string, '15:00')).toBe(false)
    expect(isValidRequestedRange(slot, null as unknown as string, '15:00')).toBe(false)
  })

  it('公開枠側の時刻が不正な場合も無効（24:00以上の枠を有効扱いにしない）', () => {
    expect(isValidRequestedRange({ start_time: '12:00:00', end_time: '24:00:00' }, '12:00', '15:00')).toBe(false)
    expect(isValidRequestedRange({ start_time: 'invalid', end_time: '18:00:00' }, '12:00', '15:00')).toBe(false)
  })

  it('22:00〜翌05:00の枠は、通常時刻の22:00〜翌01:00 のように選択できる', () => {
    expect(isValidRequestedRange({ start_time: '22:00:00', end_time: '05:00:00' }, '22:00', '01:00')).toBe(true)
  })
})

describe('parseTimeOfDay / isValidTimeOfDay', () => {
  it('00:00〜23:59（HH:MM・HH:MM:SS）のみ有効', () => {
    expect(parseTimeOfDay('00:00')).toBe(0)
    expect(parseTimeOfDay('23:45')).toBe(23 * 60 + 45)
    expect(parseTimeOfDay('18:30:00')).toBe(18 * 60 + 30)
    expect(isValidTimeOfDay('23:59')).toBe(true)
  })

  it('24:00以上・不正形式は無効', () => {
    for (const bad of ['24:00', '25:00', '29:45', '99:99', '', 'abc', '12:60']) {
      expect(isValidTimeOfDay(bad)).toBe(false)
    }
    expect(isValidTimeOfDay(undefined)).toBe(false)
    expect(isValidTimeOfDay(1200)).toBe(false)
  })
})

describe('isValidRequestedRange（公開枠自体が開始=終了の退化ケース）', () => {
  it('公開枠の開始=終了（22:00〜22:00）の場合、いかなる希望時間も拒否される（24時間枠として扱わない）', () => {
    const degenerateSlot = { start_time: '22:00:00', end_time: '22:00:00' }
    expect(isValidRequestedRange(degenerateSlot, '22:00', '23:00')).toBe(false)
    expect(isValidRequestedRange(degenerateSlot, '00:00', '23:59')).toBe(false)
  })
})

describe('resolveRequestedRange', () => {
  it('希望時刻が設定されていればそれを使う（同日枠）', () => {
    const app = { requested_start_time: '12:00:00', requested_end_time: '15:00:00' }
    expect(resolveRequestedRange(app, sameDaySlot)).toEqual({ start_time: '12:00:00', end_time: '15:00:00' })
  })

  it('日またぎの希望時刻もそのまま保持される（承認後のshift・再公開時の復元で利用）', () => {
    const app = { requested_start_time: '23:00:00', requested_end_time: '02:00:00' }
    expect(resolveRequestedRange(app, overnightSlot)).toEqual({ start_time: '23:00:00', end_time: '02:00:00' })
  })

  it('希望時刻がnull/nullなら公開枠全体にフォールバックする（既存申請との後方互換）', () => {
    const app = { requested_start_time: null, requested_end_time: null }
    expect(resolveRequestedRange(app, overnightSlot)).toEqual({ start_time: '22:00:00', end_time: '05:00:00' })
  })
})

// 【追加テスト 1・2・7】shifts.dateの翌日補正。
// 申請時の仮shift作成（cast-vacant-slots.tsx）、再公開時の復元・承認フォールバック
// （vacant-slot-manager.tsx）は、いずれもこのresolveEffectiveShiftTimeを経由するため、
// ここでのテストが3経路すべての日付補正ロジックの正しさを保証する。
describe('resolveEffectiveShiftTime（shifts.dateの翌日補正）', () => {
  it('【追加テスト1】希望23:00〜翌02:00（公開枠側と同じ日）は、空き枠の日付のまま', () => {
    expect(resolveEffectiveShiftTime(datedOvernightSlot, '23:00', '02:00')).toEqual({
      date: '2026-09-19', start_time: '23:00', end_time: '02:00',
    })
  })

  it('【追加テスト2】希望01:00〜03:00（公開枠の翌日側のみ）は、日付が翌日に補正される', () => {
    expect(resolveEffectiveShiftTime(datedOvernightSlot, '01:00', '03:00')).toEqual({
      date: '2026-09-20', start_time: '01:00', end_time: '03:00',
    })
  })

  it('希望00:00〜05:00（両方とも翌日側）も、日付が翌日に補正される', () => {
    expect(resolveEffectiveShiftTime(datedOvernightSlot, '00:00', '05:00')).toEqual({
      date: '2026-09-20', start_time: '00:00', end_time: '05:00',
    })
  })

  it('同日枠（12:00〜18:00）は、希望時間があっても日付はそのまま', () => {
    const datedSameDaySlot = { date: '2026-09-19', start_time: '12:00:00', end_time: '18:00:00' }
    expect(resolveEffectiveShiftTime(datedSameDaySlot, '12:00', '15:00')).toEqual({
      date: '2026-09-19', start_time: '12:00', end_time: '15:00',
    })
  })

  it('【追加テスト7】null/nullの既存申請は、公開枠自身の日付・時刻のまま（後方互換。再公開復元でも同じ関数を使うため、翌日側だけの希望も同様に保持される）', () => {
    expect(resolveEffectiveShiftTime(datedOvernightSlot, null, null)).toEqual({
      date: '2026-09-19', start_time: '22:00:00', end_time: '05:00:00',
    })
    // 翌日側だけの希望（例: 01:00〜03:00）が再公開後も維持されることの確認
    expect(resolveEffectiveShiftTime(datedOvernightSlot, '01:00', '03:00')).toEqual({
      date: '2026-09-20', start_time: '01:00', end_time: '03:00',
    })
  })

  it('月末をまたぐ場合も正しく翌日の日付になる', () => {
    const endOfMonthSlot = { date: '2026-09-30', start_time: '22:00:00', end_time: '05:00:00' }
    expect(resolveEffectiveShiftTime(endOfMonthSlot, '01:00', '03:00')).toEqual({
      date: '2026-10-01', start_time: '01:00', end_time: '03:00',
    })
  })
})

describe('formatTimeRange（公開枠の開始時刻を基準にした翌日表示）', () => {
  it('同日枠は「翌」を付けない', () => {
    expect(formatTimeRange('12:00:00', '12:00:00', '15:00:00')).toBe('12:00〜15:00')
  })

  it('【追加テスト4】公開枠22:00〜翌05:00・希望23:00〜02:00 → 「23:00〜翌02:00」（終了側のみ翌日）', () => {
    expect(formatTimeRange('22:00:00', '23:00:00', '02:00:00')).toBe('23:00〜翌02:00')
  })

  it('【追加テスト5】公開枠22:00〜翌05:00・希望01:00〜03:00 → 「翌01:00〜翌03:00」（開始・終了とも翌日）', () => {
    expect(formatTimeRange('22:00:00', '01:00:00', '03:00:00')).toBe('翌01:00〜翌03:00')
  })

  it('公開枠自身の表示（22:00〜翌05:00）も同じ関数で正しく表示できる', () => {
    expect(formatTimeRange('22:00:00', '22:00:00', '05:00:00')).toBe('22:00〜翌05:00')
  })

  it('HH:MM形式（秒なし）の入力でも同様に扱える', () => {
    expect(formatTimeRange('22:00', '22:00', '05:00')).toBe('22:00〜翌05:00')
  })
})
