'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Logo } from '@/components/logo'

export function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください')
      return
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません')
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setError('パスワードの変更に失敗しました。時間をおいて再度お試しください')
      return
    }
    window.location.href = '/dashboard'
  }

  return (
    <div className="h-screen overflow-hidden flex items-center justify-center p-4" style={{ background: 'var(--cast-mobile-bg, #f7f7f8)' }}>
      <div className="relative w-full max-w-md">
        <Card elevated className="w-full">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <Logo className="h-5 w-5" />
              <span className="font-bold text-sm tracking-tight" style={{ color: 'var(--brand-accent)' }}>
                ShiftMate
              </span>
            </div>
            <CardTitle className="text-2xl font-bold text-center">新しいパスワードを設定</CardTitle>
            <CardDescription className="text-center">ログインに使用する新しいパスワードを入力してください</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">新しいパスワード</Label>
                <PasswordInput
                  id="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="8文字以上"
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">確認用</Label>
                <PasswordInput
                  id="confirm-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? '変更中...' : 'パスワードを変更する'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
