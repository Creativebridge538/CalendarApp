import { APP_NAME } from '@/lib/app-config'

export const metadata = {
  title: `プライバシーポリシー - ${APP_NAME}`,
}

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-sm leading-relaxed text-foreground">
      <h1 className="text-2xl font-bold mb-2">プライバシーポリシー</h1>
      <p className="text-muted-foreground mb-8">最終更新日: 2026年9月</p>

      <p className="mb-8">
        本ページは、業務管理システム「{APP_NAME}」（以下「本サービス」）における、利用者情報の取り扱いについて説明するものです。
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">1. 取得する情報</h2>
        <p>本サービスは、利用にあたり以下の情報を取得します。</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>アカウント情報（ユーザーID、氏名、メールアドレス）</li>
          <li>シフト・勤怠に関する情報</li>
          <li>売上・報酬計算に必要な業務データ</li>
          <li>プッシュ通知の送信に必要な情報（利用者が通知を許可した場合）</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">2. 利用目的</h2>
        <p>取得した情報は、シフト管理・報酬計算・支払通知書の発行など、本サービスの提供に必要な範囲でのみ利用します。</p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">3. Google APIの利用について</h2>
        <p>
          本サービスは、管理者が任意で有効にできる「Google Drive連携」機能において、Google Drive API
          （<code className="text-xs">drive.file</code>スコープ）を利用します。このスコープは、本サービスが作成したファイル・フォルダのみへのアクセスに限定されており、
          利用者のGoogle Drive上の他のファイルにアクセスすることはありません。取得したデータは、支払通知書PDFの保存以外の目的には使用しません。
        </p>
        <p className="mt-2">
          本サービスによるGoogleユーザーデータの使用および他のアプリへの転送は、
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Google API Services User Data Policy
          </a>
          （Limited Use要件を含む）を遵守します。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">4. 第三者提供</h2>
        <p>法令に基づく場合を除き、取得した情報を本人の同意なく第三者に提供することはありません。</p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">5. データの保管</h2>
        <p>取得した情報は、適切なセキュリティ対策を講じた上で、サービス提供に必要な期間保管します。</p>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">6. お問い合わせ</h2>
        <p>本ポリシーに関するお問い合わせは、以下の連絡先までお願いいたします。</p>
        <p className="mt-2">eve.p.impact@gmail.com</p>
      </section>
    </div>
  )
}
