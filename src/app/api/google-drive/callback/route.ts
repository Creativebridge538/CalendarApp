import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCodeForRefreshToken } from '@/lib/google-drive'

export async function GET(request: Request) {
  const { user, profile } = await getCurrentUser()
  const origin = new URL(request.url).origin
  const settingsUrl = new URL('/admin/issued-notices', origin)

  if (!user || profile?.role !== 'admin' || !profile.store_id) {
    settingsUrl.searchParams.set('google_drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieStore = await cookies()
  const expectedState = cookieStore.get('google_oauth_state')?.value
  cookieStore.delete('google_oauth_state')

  if (!code || !state || !expectedState || state !== expectedState) {
    settingsUrl.searchParams.set('google_drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }

  try {
    const redirectUri = `${origin}/api/google-drive/callback`
    const refreshToken = await exchangeCodeForRefreshToken(code, redirectUri)

    const admin = createAdminClient()
    const { error } = await admin.from('store_google_drive_tokens').upsert({
      store_id: profile.store_id,
      refresh_token: refreshToken,
      root_folder_id: null,
      connected_by: user.id,
    })
    if (error) throw error

    settingsUrl.searchParams.set('google_drive', 'connected')
    return NextResponse.redirect(settingsUrl)
  } catch (e) {
    console.error('[google-drive callback] failed', e)
    settingsUrl.searchParams.set('google_drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }
}
