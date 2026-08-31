interface LogoProps {
  className?: string
  style?: React.CSSProperties
}

/**
 * ShiftMate のブランドマーク。public/logo.png を表示する。
 */
export function Logo({ className, style }: LogoProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="" className={className} style={style} aria-hidden="true" />
}
