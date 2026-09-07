import { LOGO_URL } from '@/lib/app-config'

interface LogoProps {
  className?: string
  style?: React.CSSProperties
}

/**
 * ブランドマーク。NEXT_PUBLIC_LOGO_URL未設定時はpublic/logo.png（ShiftMate）を表示する。
 */
export function Logo({ className, style }: LogoProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_URL} alt="" className={className} style={style} aria-hidden="true" />
}
