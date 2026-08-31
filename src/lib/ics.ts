function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function foldLine(line: string): string {
  // RFC5545: 75octet制限を超える行は継続行として折り返す
  if (line.length <= 75) return line
  let result = ''
  let rest = line
  while (rest.length > 75) {
    result += rest.slice(0, 75) + '\r\n '
    rest = rest.slice(75)
  }
  return result + rest
}

function toIcsDateTime(date: string, time: string): string {
  // date: 'yyyy-MM-dd', time: 'HH:mm:ss' -> 'yyyyMMddTHHmmss'
  return `${date.replace(/-/g, '')}T${time.replace(/:/g, '')}`
}

export interface IcsEvent {
  uid: string
  date: string
  startTime: string
  endTime: string
  summary: string
  description?: string
  location?: string
}

export function buildIcsCalendar(calendarName: string, events: IcsEvent[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftMate//Shifts//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
  ]

  for (const ev of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.uid}@calendarapp`)
    lines.push(`DTSTAMP:${now}`)
    lines.push(`DTSTART;TZID=Asia/Tokyo:${toIcsDateTime(ev.date, ev.startTime)}`)
    lines.push(`DTEND;TZID=Asia/Tokyo:${toIcsDateTime(ev.date, ev.endTime)}`)
    lines.push(`SUMMARY:${escapeText(ev.summary)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`)
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
