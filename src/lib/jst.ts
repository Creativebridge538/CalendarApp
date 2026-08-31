// 本番のVercelはNode.jsランタイムのタイムゾーンが常にUTC固定で、TZ環境変数でも上書きできない。
// date-fnsのformat/startOfMonth/getFullYear等はDateオブジェクトの「ローカルタイムゾーン」のgetterを
// 使うため、実行環境に任せて単なる`new Date()`を使うと、日本時間ではなくUTC基準の日付・月境界に
// なってしまう（日本時間の日付が変わってから最大9時間、UTC側はまだ前日のまま）。
// この店舗・キャストは全員日本国内のため、「今日」「今月」を扱う場所では必ずこのヘルパーを使う。
const JST_TIME_ZONE = 'Asia/Tokyo'

/** 指定した瞬間を、日本時間の壁時計表示と同じ値を持つDateに変換する。
 * date-fnsのformat/startOfMonth等にそのまま渡せば、実行環境のタイムゾーンに関係なく日本時間で扱える */
export function toJSTWallClock(date: Date | string): Date {
  const source = typeof date === 'string' ? new Date(date) : date
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JST_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(source)
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

/** 実行環境のタイムゾーンに関係なく、日本時間での「現在時刻」を返す */
export function nowJST(): Date {
  return toJSTWallClock(new Date())
}
