interface LogoProps {
  className?: string
  style?: React.CSSProperties
  /** 開口部のアクセントブロック色。テーマの主要アクセントに合わせて上書き可能 */
  accentColor?: string
}

/**
 * CalendarApp のブランドマーク。3本の角ブロックで組んだ「C」に、
 * 開口部のアクセントブロックがマークされた日付を示す。角丸は使わない。
 */
export function Logo({ className, style, accentColor = '#3987e5' }: LogoProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} fill="none" aria-hidden="true">
      <rect x="12" y="12" width="76" height="19" fill="currentColor" />
      <rect x="12" y="12" width="19" height="76" fill="currentColor" />
      <rect x="12" y="69" width="76" height="19" fill="currentColor" />
      <rect x="62" y="42" width="21" height="21" fill={accentColor} />
    </svg>
  )
}
