import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { getCurrentUser } from '@/lib/current-user'
import { buildGoogleAuthUrl, googleOAuthConfigured } from '@/lib/google-drive'

export async function GET(request: Request) {
  const { user, profile } = await getCurrentUser()
  if (!user || profile?.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }
  if (!googleOAuthConfigured()) {
    return NextResponse.json({ error: 'Google連携が未設定です（管理者にお問い合わせください）' }, { status: 500 })
  }

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set('google_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })

  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/google-drive/callback`
  return NextResponse.redirect(buildGoogleAuthUrl(redirectUri, state))
}
