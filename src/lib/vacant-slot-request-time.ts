import { addDays, format } from 'date-fns'

interface TimeRange {
  start_time: string
  end_time: string
}

interface DatedTimeRange extends TimeRange {
  date: string
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

const TIME_OF_DAY_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * 時刻文字列（HH:MM または HH:MM:SS）を0時からの分数へ変換する。
 * 00:00〜23:59の範囲外（24:00以上・25:00など）、形式不正、文字列以外はnullを返す。
 * PostgreSQLのtime型は24:00以上を保存できない（24:00は許容されるが翌日扱いになり
 * 空き枠の計算が破綻する）ため、空き枠・空き枠申請の時刻はこの範囲に限定する。
 */
export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = TIME_OF_DAY_PATTERN.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = match[3] === undefined ? 0 : Number(match[3])
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  return hours * 60 + minutes
}

/** 空き枠・空き枠申請に使える時刻（00:00〜23:59のHH:MM/HH:MM:SS）か */
export function isValidTimeOfDay(value: unknown): boolean {
  return parseTimeOfDay(value) !== null
}

/**
 * 時刻（分）を、anchorMinutes（公開枠の開始時刻）を基準0分とした連続タイムライン上の
 * オフセット分（0〜1439）へ正規化する。anchorMinutes以降なら当日分、それより前なら
 * 「翌日」とみなして+1440する（1回だけ日をまたぐ想定。DBトリガーと同じ規則）。
 */
function toContainerOffset(minutes: number, anchorMinutes: number): number {
  return minutes >= anchorMinutes ? minutes - anchorMinutes : minutes - anchorMinutes + 1440
}

/**
 * 希望時刻（HH:MM）が公開枠（HH:MM または HH:MM:SS）の範囲内かを判定する。
 * 公開枠・希望時間ともに日またぎ（終了時刻 < 開始時刻）を1回だけ許容し、
 * 公開枠の開始時刻を基準にした分単位の連続タイムラインへ正規化して比較する
 * （同日枠・日またぎ枠を同じ規則で扱う。DBトリガーcheck_vacant_slot_application_requested_time
 *   と同じ計算式）。
 * 開始=終了は常に無効（公開枠自体が開始=終了の場合はspanが0になり、
 * いかなる希望時間も範囲外として拒否される＝24時間枠としては扱わない）。
 * 24:00以上・形式不正・NaN・文字列以外の入力は、公開枠との比較以前に無効として拒否する
 * （DBへ24:00以上を送らないための最初の関門）。
 */
export function isValidRequestedRange(slot: TimeRange, start: string, end: string): boolean {
  const slotStartMin = parseTimeOfDay(slot.start_time)
  const slotEndMin = parseTimeOfDay(slot.end_time)
  const startMin = parseTimeOfDay(start)
  const endMin = parseTimeOfDay(end)
  if (slotStartMin === null || slotEndMin === null || startMin === null || endMin === null) return false

  const slotSpan = toContainerOffset(slotEndMin, slotStartMin)
  const startOffset = toContainerOffset(startMin, slotStartMin)
  const endOffset = toContainerOffset(endMin, slotStartMin)

  return startOffset < endOffset && endOffset <= slotSpan
}

/**
 * 表示・shift作成に使う実効時刻（時刻のみ）を解決する。希望時刻が未指定（null/null）の場合は
 * 公開枠全体を希望したものとして扱う（既存申請との後方互換）。
 */
export function resolveRequestedRange<T extends TimeRange>(
  app: { requested_start_time: string | null; requested_end_time: string | null },
  slot: T
): { start_time: string; end_time: string } {
  if (app.requested_start_time && app.requested_end_time) {
    return { start_time: app.requested_start_time, end_time: app.requested_end_time }
  }
  return { start_time: slot.start_time, end_time: slot.end_time }
}

/**
 * shift作成・復元に使う実効値（開始日・開始時刻・終了時刻）を解決する。
 * 希望開始時刻が公開枠の開始時刻より前（＝連続タイムライン上で日をまたいだ側）の場合、
 * 空き枠の日付(slot.date)の翌日を実効開始日とする。
 * 希望時刻が未指定（null/null）の場合は公開枠全体・公開枠の日付のまま（後方互換）。
 * shiftの作成自体は現在DB関数（apply_vacant_slot / review_vacant_slot_application /
 * set_vacant_slot_published）が行い、日付補正は同じ規則のvacant_slot_effective_dateを使う。
 * この関数はその規則のクライアント側の基準実装で、両者が食い違わないことを
 * tests/vacant-slot-request-time.test.ts で固定している。
 */
export function resolveEffectiveShiftTime(
  slot: DatedTimeRange,
  requestedStart: string | null,
  requestedEnd: string | null
): DatedTimeRange {
  const range = resolveRequestedRange({ requested_start_time: requestedStart, requested_end_time: requestedEnd }, slot)
  const startsNextDay = toMinutes(range.start_time) < toMinutes(slot.start_time)
  const date = startsNextDay
    ? format(addDays(new Date(`${slot.date}T00:00:00`), 1), 'yyyy-MM-dd')
    : slot.date
  return { date, start_time: range.start_time, end_time: range.end_time }
}

/**
 * 表示用に「開始〜終了」を整形する。anchorStart（通常は公開枠の開始時刻）を基準に、
 * start・endそれぞれが独立して「翌日」かどうかを判定し、翌日側に「翌」を付ける
 * （例: 公開枠22:00〜翌05:00に対し希望01:00〜03:00は、両方とも翌日なので「翌01:00〜翌03:00」）。
 * 公開枠自身の表示は formatTimeRange(slot.start_time, slot.start_time, slot.end_time) のように呼ぶ。
 */
export function formatTimeRange(anchorStart: string, start: string, end: string): string {
  const anchorMin = toMinutes(anchorStart)
  const s = start.slice(0, 5)
  const e = end.slice(0, 5)
  const startNextDay = toMinutes(start) < anchorMin
  const endNextDay = toMinutes(end) < anchorMin
  return `${startNextDay ? '翌' : ''}${s}〜${endNextDay ? '翌' : ''}${e}`
}
