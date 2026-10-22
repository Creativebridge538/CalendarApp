import { format } from 'date-fns'

// 空き枠が「いつまで有効か」を判定する共通ロジック。
// サーバー側の初期取得（cast/admin/dashboard）とクライアント側のRealtime更新・定期再評価で
// 同じ規則を使う。日付・時刻はすべて日本時間の壁時計（nowJST()の戻り値）基準。
// DB側の申請INSERT時の終了判定（vacant_slot_ends_at）と同じ規則。
//
// 日またぎ枠（終了時刻 < 開始時刻）は翌日の終了時刻までが有効期間。
// 例: 9/19 22:00〜翌05:00 は、9/20 01:00 の時点でも有効で、9/20 05:00 ちょうどから終了済み。
// 開始=終了の枠は24時間枠として扱わず、日をまたがせない（申請可能な時間が0のため）。

interface DatedTimeRange {
  date: string
  start_time: string
  end_time: string
}

/** 'yyyy-MM-dd' を days 日ずらした 'yyyy-MM-dd' を返す（タイムゾーン・夏時間の影響を受けないUTC演算） */
export function shiftDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 日本時間の壁時計 now を、辞書順で比較できる 'yyyy-MM-ddTHH:mm' にする */
function nowKey(now: Date): string {
  return format(now, "yyyy-MM-dd'T'HH:mm")
}

/** 空き枠の実際の終了日時（'yyyy-MM-ddTHH:mm'、日本時間の壁時計） */
export function vacantSlotEndKey(slot: DatedTimeRange): string {
  const start = slot.start_time.slice(0, 5)
  const end = slot.end_time.slice(0, 5)
  const endDate = end < start ? shiftDateString(slot.date, 1) : slot.date
  return `${endDate}T${end}`
}

/** 空き枠が実際の終了日時を過ぎているか（終了時刻ちょうどから終了済み）。now は nowJST() の戻り値 */
export function isVacantSlotEnded(slot: DatedTimeRange, now: Date): boolean {
  return vacantSlotEndKey(slot) <= nowKey(now)
}

/**
 * 管理画面・ダッシュボードの申請件数に載せる空き枠か。
 * 従来どおり「今日以降の日付」の枠は（同日に終了済みでも、その日のうちは）対象のまま、
 * それに加えて、日付は過去でも日をまたいで進行中の枠（前日始まりの日またぎ枠）も対象にする。
 */
export function isVacantSlotListedForAdmin(slot: DatedTimeRange, now: Date): boolean {
  return slot.date >= format(now, 'yyyy-MM-dd') || !isVacantSlotEnded(slot, now)
}

/**
 * DB取得時の日付の下限。日またぎ枠は前日の日付のまま進行中になり得るため、
 * 「今日」ではなく「昨日」以降を取得し、実際の終了日時は isVacantSlotEnded 等で絞り込む。
 * （空き枠の有効期間は日付の翌日までなので、昨日より前の枠は必ず終了済み）
 */
export function vacantSlotQueryFromDate(now: Date): string {
  return shiftDateString(format(now, 'yyyy-MM-dd'), -1)
}
