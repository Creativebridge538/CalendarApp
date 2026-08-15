/** 全角数字（０-９）を半角（0-9）に変換する。日本語IMEでの入力ゆれを吸収するため */
export function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}
