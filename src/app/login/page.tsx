'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Logo } from '@/components/logo'

async function resolveLoginId(loginId: string): Promise<string | null> {
  const res = await fetch('/api/auth/resolve-login-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: loginId }),
  })
  if (!res.ok) return null
  const json = await res.json()
  return json.email ?? null
}

export default function LoginPage() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const email = await resolveLoginId(loginId)
    if (!email) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  async function handleResetPassword() {
    if (!loginId) {
      setError('ユーザーIDを入力してください')
      return
    }
    setLoading(true)
    const email = await resolveLoginId(loginId)
    if (!email) {
      setError('ユーザーIDまたはパスワードが正しくありません')
      setLoading(false)
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/settings/password`,
    })
    setLoading(false)
    if (error) {
      setError('パスワードリセットメールの送信に失敗しました')
    } else {
      setError(null)
      alert('パスワードリセットメールを送信しました')
    }
  }

  return (
    <div
      className="h-dvh overflow-hidden flex items-center justify-center p-4"
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
                <Input
                  id="password"
                  type="password"
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
              <Button
                type="button"
                variant="tonal"
                className="w-full text-sm"
                onClick={handleResetPassword}
                disabled={loading}
              >
                パスワードをお忘れの方
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
