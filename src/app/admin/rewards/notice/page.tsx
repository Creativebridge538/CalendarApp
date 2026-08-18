import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { PrintButton } from './print-button'
import { fetchNoticeContent } from '@/lib/payment-notice-data'

export default async function PaymentNoticePage({
  searchParams,
}: {
  searchParams: Promise<{ cast_id?: string; from?: string; to?: string }>
}) {
  const { cast_id, from, to } = await searchParams
  const supabase = await createClient()
  const { user, profile } = await getCurrentUser()
  if (!user) redirect('/login')

  const isAdmin = profile?.role === 'admin'
  const isSelf = profile?.role === 'cast' && cast_id === user.id
  if (!isAdmin && !isSelf) redirect('/dashboard')

  const storeId = profile!.store_id!

  if (!cast_id || !from || !to) {
    return <div className="p-6 text-sm text-muted-foreground">対象キャスト・対象期間が指定されていません。</div>
  }

  const content = await fetchNoticeContent(supabase, storeId, cast_id, from, to)

  if (!content) {
    return <div className="p-6 text-sm text-muted-foreground">対象のキャストが見つかりません。</div>
  }

  const {
    castName, castRealName, logoUrl, rewardRate, salesRows, salesTotal, baseReward, bonus, deduction, totalReward,
    bankName, bankBranch, bankAccountNumber, bankAccountHolder,
  } = content
  const store = { name: content.storeName }
  const settings = { logo_url: logoUrl }

  const periodLabel = `${format(new Date(`${from}T00:00:00`), 'yyyy年M月d日', { locale: ja })}〜${format(new Date(`${to}T00:00:00`), 'M月d日', { locale: ja })}`

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
        table.bank-table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1.5px solid #1a1a1a; margin-top: 20px; }
        table.bank-table td { padding: 8px 10px; border: 1px solid #1a1a1a; }
        table.bank-table .bank-header td { font-weight: bold; }
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
            <div style={{ fontSize: 18, fontWeight: 'bold' }}>{castRealName || castName} 様</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>{periodLabel} のお支払い明細をお送りいたします。</div>
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
          <div className="notice-total-amount">¥{totalReward.toLocaleString()}</div>
        </div>

        <table className="summary-table">
          <tbody>
            <tr><td>売上合計</td><td className="right">¥{salesTotal.toLocaleString()}</td></tr>
            <tr><td>報酬率</td><td className="right">{(rewardRate * 100).toFixed(1)}%</td></tr>
            <tr><td>基本報酬</td><td className="right">¥{baseReward.toLocaleString()}</td></tr>
            <tr><td>ボーナス</td><td className="right">+¥{bonus.toLocaleString()}</td></tr>
            <tr><td>控除</td><td className="right">-¥{deduction.toLocaleString()}</td></tr>
            <tr className="final-row"><td>合計お支払額</td><td className="right">¥{totalReward.toLocaleString()}</td></tr>
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
            {salesRows.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: '16px 0' }}>売上データがありません</td></tr>
            )}
            {salesRows.map((s, i) => (
              <tr key={i}>
                <td>{format(new Date(s.date), 'M/d(E)', { locale: ja })}</td>
                <td>{s.platformLabel}{s.isDailyPayment && '（日払い済み）'}</td>
                <td className="right">¥{s.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(bankName || bankBranch || bankAccountNumber || bankAccountHolder) && (
          <table className="bank-table">
            <tbody>
              <tr className="bank-header"><td colSpan={3}>上記の御支払額総計を下記指定口座へ振込みます</td></tr>
              <tr>
                <td>{bankName}</td>
                <td>{bankBranch}</td>
                <td>{bankAccountNumber}</td>
              </tr>
              <tr>
                <td>{bankAccountHolder}</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}

        <div style={{ fontSize: 11, color: '#555', paddingTop: 8, borderTop: '1px dotted #ccc' }}>
          ※本明細に関するお問い合わせは店舗管理者までご連絡ください
        </div>
      </div>
    </div>
  )
}
