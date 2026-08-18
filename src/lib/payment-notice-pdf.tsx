import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import path from 'path'
import type { NoticeContent } from './payment-notice-data'

let fontRegistered = false
function ensureFont() {
  if (fontRegistered) return
  const fontPath = path.join(process.cwd(), 'public/fonts/NotoSansJP-Variable.ttf')
  Font.register({
    family: 'NotoSansJP',
    fonts: [
      { src: fontPath, fontWeight: 400 },
      { src: fontPath, fontWeight: 700 },
    ],
  })
  fontRegistered = true
}

const styles = StyleSheet.create({
  page: { fontFamily: 'NotoSansJP', padding: '14mm 16mm', fontSize: 10 },
  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: '#1a1a1a', marginBottom: 18,
  },
  docTitle: { fontSize: 20, fontWeight: 700, letterSpacing: 6 },
  issuedAt: { fontSize: 10 },
  headerGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  castName: { fontSize: 15, fontWeight: 700 },
  periodNote: { fontSize: 10, color: '#555', marginTop: 6 },
  storeName: { fontSize: 10, fontWeight: 700, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 12,
    borderTopWidth: 1, borderTopColor: '#aaa', borderBottomWidth: 1, borderBottomColor: '#aaa',
    paddingVertical: 10, marginBottom: 20,
  },
  totalLabel: { fontSize: 12, fontWeight: 700, width: 70 },
  totalAmount: { fontSize: 20, fontWeight: 700 },
  summaryTable: { marginBottom: 20 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#ccc',
  },
  summaryFinalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderTopWidth: 1.5, borderTopColor: '#1a1a1a', borderBottomWidth: 1.5, borderBottomColor: '#1a1a1a',
    fontWeight: 700, fontSize: 12,
  },
  breakdownTitle: {
    fontSize: 10, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: '#ccc',
    paddingBottom: 4, marginBottom: 8,
  },
  tableHeadRow: {
    flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: '#1a1a1a',
    borderBottomWidth: 1.5, borderBottomColor: '#1a1a1a', paddingVertical: 5,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e8e8e8', paddingVertical: 4 },
  colDate: { width: '25%' },
  colPlatform: { width: '45%' },
  colAmount: { width: '30%', textAlign: 'right' },
  footer: { fontSize: 9, color: '#555', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#ccc', marginTop: 8 },
  bankBox: { borderWidth: 1.5, borderColor: '#1a1a1a', marginTop: 20 },
  bankHeaderCell: { padding: 6, borderBottomWidth: 1, borderColor: '#1a1a1a', fontSize: 10, fontWeight: 700 },
  bankRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#1a1a1a' },
  bankRowLast: { flexDirection: 'row' },
  bankColBank: { width: '28%', padding: 6, borderRightWidth: 1, borderColor: '#1a1a1a', fontSize: 10 },
  bankColBranch: { width: '34%', padding: 6, borderRightWidth: 1, borderColor: '#1a1a1a', fontSize: 10 },
  bankColNumber: { width: '38%', padding: 6, fontSize: 10 },
})

export function NoticeDocument({ content, issuedAt }: { content: NoticeContent; issuedAt: string }) {
  ensureFont()
  const {
    castName, castRealName, storeName, from, to, rewardRate, salesRows, salesTotal, baseReward, bonus, deduction, totalReward,
    bankName, bankBranch, bankAccountNumber, bankAccountHolder,
  } = content
  const periodLabel = `${format(new Date(`${from}T00:00:00`), 'yyyy年M月d日', { locale: ja })}〜${format(new Date(`${to}T00:00:00`), 'M月d日', { locale: ja })}`

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleRow}>
          <Text style={styles.docTitle}>支払通知書</Text>
          <Text style={styles.issuedAt}>発行日　{format(new Date(issuedAt), 'yyyy年M月d日', { locale: ja })}</Text>
        </View>

        <View style={styles.headerGrid}>
          <View>
            <Text style={styles.castName}>{castRealName || castName} 様</Text>
            <Text style={styles.periodNote}>{periodLabel} のお支払い明細をお送りいたします。</Text>
          </View>
          <Text style={styles.storeName}>{storeName}</Text>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>お支払額</Text>
          <Text style={styles.totalAmount}>¥{totalReward.toLocaleString()}</Text>
        </View>

        <View style={styles.summaryTable}>
          <View style={styles.summaryRow}><Text>売上合計</Text><Text>¥{salesTotal.toLocaleString()}</Text></View>
          <View style={styles.summaryRow}><Text>報酬率</Text><Text>{(rewardRate * 100).toFixed(1)}%</Text></View>
          <View style={styles.summaryRow}><Text>基本報酬</Text><Text>¥{baseReward.toLocaleString()}</Text></View>
          <View style={styles.summaryRow}><Text>ボーナス</Text><Text>+¥{bonus.toLocaleString()}</Text></View>
          <View style={styles.summaryRow}><Text>控除</Text><Text>-¥{deduction.toLocaleString()}</Text></View>
          <View style={styles.summaryFinalRow}><Text>合計お支払額</Text><Text>¥{totalReward.toLocaleString()}</Text></View>
        </View>

        <Text style={styles.breakdownTitle}>売上内訳（{periodLabel}）</Text>
        <View style={styles.tableHeadRow}>
          <Text style={styles.colDate}>日付</Text>
          <Text style={styles.colPlatform}>プラットフォーム</Text>
          <Text style={styles.colAmount}>金額</Text>
        </View>
        {salesRows.length === 0 && (
          <Text style={{ textAlign: 'center', color: '#888', paddingVertical: 16 }}>売上データがありません</Text>
        )}
        {salesRows.map((s, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDate}>{format(new Date(s.date), 'M/d(E)', { locale: ja })}</Text>
            <Text style={styles.colPlatform}>
              {s.platformLabel}
              {s.isDailyPayment && (s.dailyPaymentAt
                ? `（日払い済み ${format(new Date(s.dailyPaymentAt), 'M/d', { locale: ja })}）`
                : '（日払い済み）')}
            </Text>
            <Text style={styles.colAmount}>¥{s.amount.toLocaleString()}</Text>
          </View>
        ))}

        {(bankName || bankBranch || bankAccountNumber || bankAccountHolder) && (
          <View style={styles.bankBox} wrap={false}>
            <Text style={styles.bankHeaderCell}>上記の御支払額総計を下記指定口座へ振込みます</Text>
            <View style={styles.bankRow}>
              <Text style={styles.bankColBank}>{bankName}</Text>
              <Text style={styles.bankColBranch}>{bankBranch}</Text>
              <Text style={styles.bankColNumber}>{bankAccountNumber}</Text>
            </View>
            <View style={styles.bankRowLast}>
              <Text style={styles.bankColBank}>{bankAccountHolder}</Text>
              <Text style={styles.bankColBranch}></Text>
              <Text style={styles.bankColNumber}></Text>
            </View>
          </View>
        )}

        <Text style={styles.footer}>※本明細に関するお問い合わせは店舗管理者までご連絡ください</Text>
      </Page>
    </Document>
  )
}
