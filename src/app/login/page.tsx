'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Logo } from '@/components/logo'

interface StoreOption { store_id: string; store_name: string }
type ResolveResult = { email: string } | { ambiguous: true; stores: StoreOption[] } | null

async function resolveLoginId(loginId: string, storeId?: string): Promise<ResolveResult> {
  const res = await fetch('/api/auth/resolve-login-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: loginId, store_id: storeId }),
  })
  if (!res.ok) return null
  const json = await res.json()
  if (json.ambiguous) return { ambiguous: true, stores: json.stores }
  return json.email ? { email: json.email } : null
}

export default function LoginPage() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // 同じユーザーIDが複数店舗で使われている場合、ここに候補が入りログイン画面が店舗選択に切り替わる
  const [storeOptions, setStoreOptions] = useState<StoreOption[] | null>(null)
  const supabase = createClient()

  async function signInWithEmail(email: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }
    // Next.jsのソフト遷移だと、iOSのPWAでパスワード欄のあるこの画面から抜けた直後、
    // セーフエリア（ステータスバー分の余白）の再計算が古いまま引き継がれ、
    // 一時的にコンテンツがステータスバーの裏に潜り込むことがある。
    // ここだけは完全なページ読み込みにして、iOS側にまっさらな状態から計算させる
    window.location.assign('/dashboard')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await resolveLoginId(loginId)
    if (!result) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }
    if ('ambiguous' in result) {
      setStoreOptions(result.stores)
      setLoading(false)
      return
    }
    await signInWithEmail(result.email)
  }

  async function handleSelectStore(storeId: string) {
    setLoading(true)
    setError(null)
    const result = await resolveLoginId(loginId, storeId)
    if (!result || 'ambiguous' in result) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }
    await signInWithEmail(result.email)
  }

  if (storeOptions) {
    return (
      <div
        className="h-screen overflow-hidden flex items-center justify-center p-4"
        style={{ background: 'var(--cast-mobile-bg, #f7f7f8)' }}
      >
        <div className="relative w-full max-w-md">
          <Card elevated className="w-full">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-bold text-center">店舗を選択してください</CardTitle>
              <CardDescription className="text-center">
                同じユーザーIDが複数の店舗で使われています。ログインする店舗を選んでください
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {storeOptions.map(s => (
                <Button
                  key={s.store_id} type="button" variant="outline" className="w-full justify-start"
                  disabled={loading}
                  onClick={() => handleSelectStore(s.store_id)}
                >
                  {s.store_name}
                </Button>
              ))}
              <Button
                type="button" variant="ghost" className="w-full"
                onClick={() => { setStoreOptions(null); setError(null) }}
              >
                戻る
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div
      className="h-screen overflow-hidden flex items-center justify-center p-4"
      style={{ background: 'var(--cast-mobile-bg, #f7f7f8)' }}
    >
      <div className="relative w-full max-w-md">
        <Card elevated className="w-full">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <Logo className="h-5 w-5" style={{ color: 'var(--brand-accent)' }} />
              <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--brand-accent)' }}>
                CalendarApp
              </span>
            </div>
            <CardTitle className="text-2xl font-bold text-center">ログイン</CardTitle>
            <CardDescription className="text-center">
              ユーザーIDとパスワードを入力してください
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="login-id">ユーザーID</Label>
                <Input
                  id="login-id"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="user_id"
                  required
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">パスワード</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" variant="elevated" className="w-full" disabled={loading}>
                {loading ? 'ログイン中...' : 'ログイン'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                パスワードを忘れた場合は管理者にお問い合わせください
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
