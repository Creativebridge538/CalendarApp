import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPlatformOwner } from '@/lib/platform-owner'
import { SignupReviewList } from '@/components/internal/signup-review-list'

export default async function InternalSignupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isPlatformOwner(user?.email)) redirect('/dashboard')

  const admin = createAdminClient()
  const [{ data: pending }, { data: recent }] = await Promise.all([
    admin.from('store_signup_requests').select('*').eq('status', 'pending').order('created_at'),
    admin.from('store_signup_requests').select('*').neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(20),
  ])

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold">新規店舗の申込レビュー</h1>
          <p className="text-sm text-muted-foreground mt-0.5">承認すると店舗と管理者アカウントが作成され、招待メールが送信されます</p>
        </div>
        <SignupReviewList pending={pending ?? []} recent={recent ?? []} />
      </div>
    </div>
  )
}
