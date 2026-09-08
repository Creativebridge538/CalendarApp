import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // 未認証でもアクセスできる必要があるパス（ログイン前のID解決・パスワードリセット等のOAuthコールバック）
  const isPublicPath = pathname === '/login'
    || pathname.startsWith('/auth/')
    || pathname === '/api/auth/resolve-login-id'
    || pathname === '/privacy'

  // Supabase側の一時的な通信エラー（ネットワーク断・タイムアウト等）でセッションが
  // 無効と誤判定され、実際にはログイン中のユーザーが強制的にログイン画面に飛ばされる
  // ことがあった。トークン自体が無効/期限切れという明確なエラーの時だけログアウト扱いにする
  const isDefiniteAuthError = !!error && error.status !== undefined && error.status >= 400 && error.status < 500

  // 未認証ユーザーを /login にリダイレクト（一時的な通信エラーの場合はリダイレクトしない）
  if (!user && !isPublicPath && (!error || isDefiniteAuthError)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 認証済みユーザーが /login にアクセスしたらダッシュボードへ
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}
