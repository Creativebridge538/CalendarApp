import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/current-user'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { DownloadPdfButton } from './download-button'
import { fetchNoticeContent, getNoticeSnapshotById, getLatestNoticeSnapshot, buildNoticeSummaryRows } from '@/lib/payment-notice-data'
import { DEFAULT_NOTICE_FOOTER_TEXT } from '@/lib/notice-template'

export default async function PaymentNoticePage({
  searchParams,
}: {
  searchParams: Promise<{ cast_id?: string; from?: string; to?: string; notice_id?: string; hide_download?: string }>
}) {
  const { cast_id, from, to, notice_id, hide_download } = await searchParams
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

  // notice_id指定時は、発行済みのその1件をそのまま表示する（発行後の内容変更の影響を受けない）。
  // notice_idなしの場合、管理画面からのプレビューは常に最新の内容を見られるようにし、
  // キャスト自身が見る分だけ（古いリンク向けの後方互換）最後に発行された内容を優先する
  let content = notice_id ? await getNoticeSnapshotById(supabase, storeId, notice_id) : null
  if (!content) {
    content = isAdmin
      ? await fetchNoticeContent(supabase, storeId, cast_id, from, to)
      : (await getLatestNoticeSnapshot(supabase, storeId, cast_id, from, to)) ?? await fetchNoticeContent(supabase, storeId, cast_id, from, to)
  }
  // notice_id経由の場合、対象キャスト本人・同店舗管理者以外には見せない
  if (notice_id && !isAdmin && cast_id !== user.id) {
    return <div className="p-6 text-sm text-muted-foreground">対象のキャストが見つかりません。</div>
  }

  if (!content) {
    return <div className="p-6 text-sm text-muted-foreground">対象のキャストが見つかりません。</div>
  }

  const {
    castName, castRealName, logoUrl, salesRows, totalReward,
    bankName, bankBranch, bankAccountNumber, bankAccountHolder, headerText, footerText,
  } = content
  const store = { name: content.storeName }
  const settings = { logo_url: logoUrl }

  const hasFxRow = salesRows.some(s => s.fxRate != null)
  const periodLabel = `${format(new Date(`${from}T00:00:00`), 'yyyy年M月d日', { locale: ja })}〜${format(new Date(`${to}T00:00:00`), 'M月d日', { locale: ja })}`
  const { itemRows, subtotalRows, settlementRows } = buildNoticeSummaryRows(content)

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
        .notice-total { display: flex; align-items: baseline; gap: 12px; border-top: 1px solid #aaa; border-bottom: 1px solid #aaa; padding: 10px 0; margin-bottom: 4px; }
        .notice-total-amount { font-size: 26px; font-weight: bold; font-variant-numeric: tabular-nums; }
        table.notice-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; }
        table.notice-table th { text-align: left; padding: 6px 8px; border-top: 1.5px solid #1a1a1a; border-bottom: 1.5px solid #1a1a1a; font-weight: normal; }
        table.notice-table th.right, table.notice-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        table.notice-table td { padding: 5px 8px; border-bottom: 1px solid #e8e8e8; }
        table.summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        table.summary-table td { padding: 6px 10px; border-bottom: 1px dotted #ccc; }
        table.summary-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        table.summary-table .final-row td { padding: 8px 10px; font-weight: bold; font-size: 15px; border-top: 1.5px solid #1a1a1a; border-bottom: 1.5px solid #1a1a1a; }
        /* 小計・消費税は報酬明細（項目一覧）ではなく集計結果のため、視覚的に分離する */
        table.subtotal-table { width: 100%; border-collapse: collapse; font-size: 12px; color: #555; margin-top: 4px; }
        table.subtotal-table td { padding: 3px 10px; }
        table.subtotal-table td.right { text-align: right; font-variant-numeric: tabular-nums; }
        table.bank-table { width: 100%; border-collapse: collapse; font-size: 13px; border: 1.5px solid #1a1a1a; margin-top: 20px; }
        table.bank-table td { padding: 8px 10px; border: 1px solid #1a1a1a; }
        table.bank-table .bank-header td { font-weight: bold; }
      `}</style>

      {!hide_download && content.id !== null && (
        <div className="no-print" style={{ maxWidth: '210mm', margin: '0 auto', padding: '16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <DownloadPdfButton castId={cast_id} from={from} to={to} noticeId={content.id} />
        </div>
      )}

      <div className="notice-page">
        <div className="notice-title-row">
          <span className="notice-doc-title">支　払　通　知　書</span>
          <div style={{ fontSize: 12 }}>発行日　{format(new Date(), 'yyyy年M月d日', { locale: ja })}</div>
        </div>

        <div className="notice-header-grid">
          <div>
            <div style={{ fontSize: 18, fontWeight: 'bold' }}>{castRealName || castName} 様</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>{periodLabel} のお支払い明細をお送りいたします。</div>
            {headerText && <div style={{ fontSize: 12, color: '#555', marginTop: 6, whiteSpace: 'pre-wrap' }}>{headerText}</div>}
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
        <p style={{ fontSize: 11, color: '#555', marginBottom: 16 }}>※上記金額には消費税10%が含まれています。</p>

        <table className="summary-table">
          <tbody>
            {itemRows.map((row, i) => (
              <tr key={i}><td>{row.label}</td><td className="right">{row.text}</td></tr>
            ))}
          </tbody>
        </table>

        {subtotalRows.length > 0 && (
          <table className="subtotal-table">
            <tbody>
              {subtotalRows.map((row, i) => (
                <tr key={i}><td>{row.label}</td><td className="right">{row.text}</td></tr>
              ))}
            </tbody>
          </table>
        )}

        <table className="summary-table">
          <tbody>
            <tr className="final-row"><td>今回お支払額</td><td className="right">¥{totalReward.toLocaleString()}</td></tr>
          </tbody>
        </table>

        {settlementRows.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 20, marginBottom: 8 }}>
              精算情報
            </div>
            <table className="summary-table">
              <tbody>
                {settlementRows.map((row, i) => (
                  <tr key={i}><td>{row.label}</td><td className="right">{row.text}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={{ fontSize: 12, fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: 4, marginTop: 20, marginBottom: 8 }}>
          売上内訳（{periodLabel}）
        </div>
        <table className="notice-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>プラットフォーム</th>
              <th className="right">金額</th>
              {hasFxRow && <th className="right">為替</th>}
            </tr>
          </thead>
          <tbody>
            {salesRows.length === 0 && (
              <tr><td colSpan={hasFxRow ? 4 : 3} style={{ textAlign: 'center', color: '#888', padding: '16px 0' }}>売上データがありません</td></tr>
            )}
            {salesRows.map((s, i) => (
              <tr key={i}>
                <td>{format(new Date(s.date), 'M/d(E)', { locale: ja })}</td>
                <td>
                  {s.platformLabel}
                  {s.isDailyPayment && (s.dailyPaymentAt
                    ? `（日払い済み ${format(new Date(s.dailyPaymentAt), 'M/d', { locale: ja })}）`
                    : '（日払い済み）')}
                </td>
                <td className="right">¥{s.reward.toLocaleString()}</td>
                {hasFxRow && (
                  <td className="right">
                    {s.fxRate != null ? (
                      <>
                        ¥{s.fxRate.toFixed(2)}/$
                        {s.usdAmount != null && <span style={{ display: 'block', color: '#888' }}>(${s.usdAmount.toFixed(2)})</span>}
                      </>
                    ) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {/* 発行済み（content.id !== null）の通知書は為替レートが確定済みのスナップショットのため、
            未発行のプレビュー時点でのみ「参考値」の注意書きを表示する */}
        {hasFxRow && content.id === null && (
          <p style={{ fontSize: 11, color: '#555', marginTop: -12, marginBottom: 16 }}>
            ※為替換算額は参考値です。精算時の金額と異なる場合があります。
          </p>
        )}

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

        <div style={{ fontSize: 11, color: '#555', paddingTop: 8, borderTop: '1px dotted #ccc', whiteSpace: 'pre-wrap' }}>
          {footerText || DEFAULT_NOTICE_FOOTER_TEXT}
        </div>
      </div>
    </div>
  )
}
