import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const body = await request.json()
  const { store_name, contact_name, contact_email, phone, message } = body

  if (!store_name || !contact_name || !contact_email) {
    return NextResponse.json({ error: '店舗名・担当者名・メールアドレスは必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { error } = await admin.from('store_signup_requests').insert({
    store_name,
    contact_name,
    contact_email,
    phone: phone || null,
    message: message || null,
  })

  if (error) {
    return NextResponse.json({ error: '送信に失敗しました。時間をおいて再度お試しください' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
