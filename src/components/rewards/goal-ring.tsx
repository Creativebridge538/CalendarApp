export function GoalRing({ percent, size = 72, stroke = 6, textClassName = 'text-sm font-bold' }: {
  percent: number
  size?: number
  stroke?: number
  textClassName?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, percent))
  const offset = c * (1 - clamped / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand-accent)" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.7s ease' }}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center tabular-nums ${textClassName}`}>
        {Math.round(clamped)}%
      </div>
    </div>
  )
}
