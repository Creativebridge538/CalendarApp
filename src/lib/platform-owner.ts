/** SaaS運営者（新規店舗の申込を承認できる人）かどうかを判定する */
export function isPlatformOwner(email: string | null | undefined): boolean {
  if (!email) return false
  const owners = (process.env.PLATFORM_OWNER_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return owners.includes(email.toLowerCase())
}
