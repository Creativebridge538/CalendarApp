import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Bell, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { CastAppearanceSettings } from '@/components/settings/cast-appearance-settings'
import { CastProfileSettings } from '@/components/settings/cast-profile-settings'
import { CastCalendarSyncSettings } from '@/components/settings/cast-calendar-sync-settings'
import { CastLogoutButton } from '@/components/settings/cast-logout-button'
import { PasswordChangeSettings } from '@/components/settings/password-change-settings'

export default async function CastSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('accent_skin, accent_font, display_name, photo_url, birthdate, show_birthdate, calendar_token, period_start_date, period_end_date')
    .eq('id', user.id)
    .single()

  return (
    <div className="px-4 py-4 md:p-6 space-y-4 max-w-lg">
      <div>
        <h1 className="text-xl font-bold">設定</h1>
        <p className="text-sm text-muted-foreground">プロフィールやアプリの見た目を自分好みにカスタマイズできます</p>
      </div>
      <Card elevated>
        <CardContent className="p-0">
          <Link href="/notifications" className="flex items-center gap-2.5 px-4 py-3.5 hover:bg-muted/40 transition-colors rounded-xl">
            <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">通知</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
          </Link>
        </CardContent>
      </Card>
      <CastProfileSettings
        userId={user.id}
        email={user.email ?? ''}
        initialDisplayName={profile?.display_name ?? null}
        initialPhotoUrl={profile?.photo_url ?? null}
        initialBirthdate={profile?.birthdate ?? null}
        initialShowBirthdate={profile?.show_birthdate ?? false}
        initialPeriodStartDate={profile?.period_start_date ?? null}
        initialPeriodEndDate={profile?.period_end_date ?? null}
      />
      <CastAppearanceSettings
        userId={user.id}
        initialSkin={profile?.accent_skin ?? null}
        initialFont={profile?.accent_font ?? null}
      />
      <CastCalendarSyncSettings userId={user.id} initialCalendarToken={profile?.calendar_token ?? null} />
      <PasswordChangeSettings />
      <CastLogoutButton />
    </div>
  )
}
