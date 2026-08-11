// 深夜営業のシフトは「25:00」のような24時を超えた表記で入力できるようにする（DB保存時は24時間に正規化）
const HOUR_OPTIONS = Array.from({ length: 30 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTIONS = ['00', '15', '30', '45']
// 「19」を選んで「15」を選んで…と2段階にせず、"19:15" を1回で選べるようにする
const TIME_OPTIONS = HOUR_OPTIONS.flatMap(h => MINUTE_OPTIONS.map(m => `${h}:${m}`))

export function normalizeTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function TimeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="min-h-11 min-w-24 rounded-md border bg-background px-2 text-base font-medium tabular-nums text-center"
      aria-label="時刻"
    >
      {TIME_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
