export function shiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.slice(0, 5).split(':').map(Number)
  const [eh, em] = endTime.slice(0, 5).split(':').map(Number)
  let minutes = (eh * 60 + em) - (sh * 60 + sm)
  if (minutes <= 0) minutes += 24 * 60
  return minutes / 60
}
