import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format, endOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { PrintButton } from './print-button'

const PLATFORM_LABEL: Record<string, string> = {
  manual: '手入力', stripchat: 'STRIPCHAT', fc2: 'FC2', dxlive: 'DXライブ',
}

export default async function PaymentNoticePage({
  searchParams,
}: {
  searchParams: Promise<{ cast_id?: string; year?: string; month?: string }>
}) {
  const { cast_id, year: yearParam, month: monthParam } = await searchParams
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  const isAdmin = profile?.role === 'admin'
  const isSelf = profile?.role === 'cast' && cast_id === user.id
  if (!isAdmin && !isSelf) redirect('/dashboard')

  const storeId = profile!.store_id!
  const year = parseInt(yearParam ?? '')
  const month = parseInt(monthParam ?? '')

  if (!cast_id || !year || !month) {
    return <div className="p-6 text-sm text-muted-foreground">対象キャスト・対象月が指定されていません。</div>
  }

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = format(endOfMonth(new Date(`${monthStart}T00:00:00`)), 'yyyy-MM-dd')

  const [{ data: store }, { data: settings }, { data: cast }, { data: reward }, { data: sales }] = await Promise.all([
    supabase.from('stores').select('name').eq('id', storeId).single(),
    supabase.from('store_settings').select('logo_url').eq('store_id', storeId).single(),
    supabase.from('users').select('display_name').eq('id', cast_id).eq('store_id', storeId).single(),
    supabase.from('reward_calculations').select('*')
      .eq('cast_id', cast_id).eq('store_id', storeId).eq('period_year', year).eq('period_month', month).single(),
    supabase.from('sales').select('date, platform, amount, raw_units, is_daily_payment')
      .eq('cast_id', cast_id).eq('store_id', storeId)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date'),
  ])

  if (!cast || !reward) {
    return <div className="p-6 text-sm text-muted-foreground">対象の報酬明細が見つかりません（まだ計算・確定されていない可能性があります）。</div>
  }
  // キャスト本人は確定済みの月のみ閲覧可能（管理者は確認のため未確定でも閲覧可）
  if (isSelf && !reward.is_finalized) {
    return <div className="p-6 text-sm text-muted-foreground">この月の報酬明細はまだ確定されていません。確定後にご確認いただけます。</div>
  }

  const periodLabel = `${year}年${month}月分`

  return (
    <div style={{ background: '#eef0f2', minHeight: '100vh' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .notice-page { box-shadow: none !important; margin: 0 !important; }
          @page { size: A4; margin: 0; }
        }
        .notice-page {
          width: 210mm; min-height: 297mm; margin: 24px auto; background: white; color: #1a1a1a;
          padding: 14mm 16mm; box-shadow: 0 2px 24px rgba(0,0,0,0.16);
          font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
          font-size: 13px;
        }
        /* スマホ表示: A4固定幅だとはみ出すので画面用に流動幅に切り替え（印刷時は上のA4指定が優先） */
        @media screen and (max-width: 700px) {
          .notice-page { width: 100%; min-height: auto; margin: 0 auto 24px; padding: 20px 16px; box-shadow: none; border-bottom: 8px solid #f0f0f0; }
          .notice-doc-title { font-size: 17px; letter-spacing: 3px; }
          .notice-header-grid { flex-wrap: wrap; gap: 12px; }
          .notice-issuer { text-align: left; }
          .notice-issuer img { margin-left: 0; }
          .notice-total-amount { font-size: 22px; }
          table.notice-table, table.summary-table { font-size: 11px; }
          table.notice-table th, table.notice-table td { padding: 5px 4px; }
        }
        .notice-title-row { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; margin-bottom: 18px; }
        .notice-doc-title { font-size: 24px; font-weight: bold; letter-spacing: 8px; }
        .notice-header-grid { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .notice-issuer { text-align: right; }
        .notice-issuer img { height: 44px; width: auto; margin-left: auto; display: block; margin-bottom: 4px; }
        .notice-total { display: flex; align-items: baseline; gap: 12px; border-top: 1px solid #aaa; border-bottom: 1px solid #aaa; padding: 10px 0; margin-bottom: 20px; }
        .notice-total-amount { font-size: 26px; font-weight: bold; font-variant-numeric: tabular-nums; }
        table.notice-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
        table.notice-table th { text-align: left; padding: 6px 8px; border-top: 1.5px solid #1a1a1a; border-bottom: 1.5px solid #1a1a1a; font-weight: normal; }
        table.notice-table th.right, table.notice-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        table.notice-table td { padding: 5px 8px; border-bottom: 1px solid #e8e8e8; }
        table.summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.summary-table td { padding: 6px 10px; border-bottom: 1px dotted #ccc; }
        table.summary-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        table.summary-table .final-row td { padding: 8px 10px; font-weight: bold; font-size: 15px; border-top: 1.5px solid #1a1a1a; border-bottom: 1.5px solid #1a1a1a; }
      `}</style>

      <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto', padding: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <PrintButton />
      </div>

      <div className="notice-page">
        <div className="notice-title-row">
          <span className="notice-doc-title">支　払　通　知　書</span>
          <div style={{ fontSize: 12 }}>発行日　{format(new Date(), 'yyyy年M月d日', { locale: ja })}</div>
        </div>

        <div className="notice-header-grid">
          <div>
            <div style={{ fontSize: 18, fontWeight: 'bold' }}>{cast.display_name} 様</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>{periodLabel}のお支払い明細をお送りいたします。</div>
          </div>
          <div className="notice-issuer">
            {settings?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logo_url} alt={store?.name ?? ''} />
            )}
            <div style={{ fontSize: 12, fontWeight: 'bold' }}>{store?.name ?? ''}</div>
          </div>
        </div>

        <div className="notice-total">
          <div style={{ fontSize: 14, fontWeight: 'bold', width: 90 }}>お支払額</div>
          <div className="notice-total-amount">¥{Number(reward.total_reward).toLocaleString()}</div>
        </div>

        <table className="summary-table">
          <tbody>
            <tr><td>売上合計</td><td className="right">¥{Number(reward.sales_total).toLocaleString()}</td></tr>
            <tr><td>報酬率</td><td className="right">{(Number(reward.reward_rate) * 100).toFixed(1)}%</td></tr>
            <tr><td>基本報酬</td><td className="right">¥{Number(reward.base_reward).toLocaleString()}</td></tr>
            <tr><td>ボーナス</td><td className="right">+¥{Number(reward.bonus).toLocaleString()}</td></tr>
            <tr><td>控除</td><td className="right">-¥{Number(reward.deduction).toLocaleString()}</td></tr>
            <tr className="final-row"><td>合計お支払額</td><td className="right">¥{Number(reward.total_reward).toLocaleString()}</td></tr>
          </tbody>
        </table>

        <div style={{ fontSize: 12, fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: 4, marginBottom: 8 }}>
          売上内訳（{periodLabel}）
        </div>
        <table className="notice-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>プラットフォーム</th>
              <th className="right">金額</th>
            </tr>
          </thead>
          <tbody>
            {(!sales || sales.length === 0) && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: '16px 0' }}>売上データがありません</td></tr>
            )}
            {sales?.map((s, i) => (
              <tr key={i}>
                <td>{format(new Date(s.date), 'M/d(E)', { locale: ja })}</td>
                <td>{PLATFORM_LABEL[s.platform] ?? s.platform}{s.is_daily_payment && '（日払い）'}</td>
                <td className="right">¥{Number(s.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ fontSize: 11, color: '#555', paddingTop: 8, borderTop: '1px dotted #ccc' }}>
          ※本明細に関するお問い合わせは店舗管理者までご連絡ください
        </div>
      </div>
    </div>
  )
}
