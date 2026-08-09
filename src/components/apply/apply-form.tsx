'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2 } from 'lucide-react'

export function ApplyForm() {
  const [storeName, setStoreName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/store-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_name: storeName, contact_name: contactName, contact_email: contactEmail,
        phone: phone || undefined, message: message || undefined,
      }),
    })

    setLoading(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '送信に失敗しました');
      return
    }
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-positive mx-auto" />
          <p className="font-medium">お申し込みありがとうございます</p>
          <p className="text-sm text-muted-foreground">
            内容を確認の上、担当者よりご登録いただいたメールアドレスへご連絡いたします。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold text-center">導入のお申し込み</CardTitle>
        <CardDescription className="text-center">
          店舗情報をご入力ください。内容確認後にご連絡いたします
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="store_name">店舗名 *</Label>
            <Input id="store_name" value={storeName} onChange={e => setStoreName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_name">ご担当者名 *</Label>
            <Input id="contact_name" value={contactName} onChange={e => setContactName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_email">メールアドレス *</Label>
            <Input
              id="contact_email" type="email" value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              placeholder="example@email.com" required autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">承認後、このアドレス宛に管理者アカウントの設定案内をお送りします</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">電話番号</Label>
            <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">備考</Label>
            <Textarea id="message" value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="キャスト人数・店舗数など、参考になる情報があればご記入ください" />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '送信中...' : '申し込む'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
