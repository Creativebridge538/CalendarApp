import { describe, it, expect } from 'vitest'
import { buildTimeOptions, DEFAULT_MAX_HOUR } from '@/lib/time-options'
import { isValidRequestedRange } from '@/lib/vacant-slot-request-time'

describe('buildTimeOptions（TimeSelectの選択肢）', () => {
  it('デフォルトは従来どおり00:00〜29:45（既存画面への影響なし）', () => {
    const options = buildTimeOptions()
    expect(options[0]).toBe('00:00')
    expect(options[options.length - 1]).toBe('29:45')
    expect(options).toHaveLength(30 * 4)
    expect(options).toContain('25:00')
    expect(DEFAULT_MAX_HOUR).toBe(29)
  })

  it('maxHour=23（空き枠の作成・申請画面）は00:00〜23:45だけで、24:00以上を選べない', () => {
    const options = buildTimeOptions(23)
    expect(options[0]).toBe('00:00')
    expect(options[options.length - 1]).toBe('23:45')
    expect(options).toHaveLength(24 * 4)
    expect(options).not.toContain('24:00')
    expect(options).not.toContain('25:00')
    expect(options.every(o => Number(o.slice(0, 2)) <= 23)).toBe(true)
  })

  it('範囲外・非整数・NaNのmaxHourでも、DBに送れない値（30時以上）は作らない', () => {
    expect(buildTimeOptions(99).at(-1)).toBe('29:45')
    expect(buildTimeOptions(-1)).toEqual(['00:00', '00:15', '00:30', '00:45'])
    expect(buildTimeOptions(23.9).at(-1)).toBe('23:45')
    expect(buildTimeOptions(Number.NaN).at(-1)).toBe('29:45')
  })

  it('日またぎ枠（22:00〜翌05:00）は、22:00〜翌01:00のように通常時刻の選択肢だけで指定できる', () => {
    const options = buildTimeOptions(23)
    expect(options).toContain('22:00')
    expect(options).toContain('01:00')
    expect(isValidRequestedRange({ start_time: '22:00:00', end_time: '05:00:00' }, '22:00', '01:00')).toBe(true)
  })
})
