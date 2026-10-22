import { buildTimeOptions } from '@/lib/time-options'

// 深夜営業のシフトは「25:00」のような24時を超えた表記で入力できるようにする（DB保存時は24時間に正規化）。
// デフォルトは従来どおり29時まで。PostgreSQLのtime型に直接保存する画面（空き枠の作成・申請）は、
// 24:00以上を保存できないため maxHour={23} で00:00〜23:45に制限する（翌日は00:00〜等の通常時刻＋「翌日」表示で扱う）。
const DEFAULT_TIME_OPTIONS = buildTimeOptions()

export function normalizeTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function TimeSelect({ value, onChange, maxHour }: { value: string; onChange: (value: string) => void; maxHour?: number }) {
  const options = maxHour === undefined ? DEFAULT_TIME_OPTIONS : buildTimeOptions(maxHour)
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="min-h-11 min-w-24 rounded-md border bg-background px-2 text-base font-medium tabular-nums text-center"
      aria-label="時刻"
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
