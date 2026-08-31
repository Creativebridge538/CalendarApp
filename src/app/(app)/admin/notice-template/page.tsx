import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { NoticeTemplateSettings } from '@/components/settings/notice-template-settings'
import { NoticeItemTemplates } from '@/components/settings/notice-item-templates'

export default async function NoticeTemplatePage() {
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')
  if (profile?.role !== 'admin') redirect('/dashboard')

  const storeId = profile.store_id!
  const [{ data: settings }, { data: noticeItemTemplates }] = await Promise.all([
    supabase.from('store_settings')
      .select('id, notice_item_config, notice_header_text, notice_footer_text')
      .eq('store_id', storeId).single(),
    supabase.from('notice_item_templates').select('*').eq('store_id', storeId).order('sort_order'),
  ])

  return (
    <div className="p-6 space-y-6">
      <NoticeTemplateSettings
        settingsId={settings?.id ?? null} storeId={storeId}
        itemConfig={settings?.notice_item_config} headerText={settings?.notice_header_text ?? null}
        footerText={settings?.notice_footer_text ?? null}
      />
      <NoticeItemTemplates templates={noticeItemTemplates ?? []} storeId={storeId} />
    </div>
  )
}
