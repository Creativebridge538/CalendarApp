import crypto from 'crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

export function googleOAuthConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
}

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    // drive.file: アプリ自身が作成したファイルのみ操作できる最小権限スコープ
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForRefreshToken(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  const data = await res.json()
  if (!data.refresh_token) {
    throw new Error('refresh_tokenが取得できませんでした（既に連携済みの場合、一度連携を解除してからやり直してください）')
  }
  return data.refresh_token as string
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`)
  const data = await res.json()
  return data.access_token as string
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// 同名フォルダが既にあれば再利用し、無ければ作成する
export async function ensureFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const qParts = [
    `name='${escapeDriveQueryValue(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
  ]
  if (parentId) qParts.push(`'${parentId}' in parents`)

  const listRes = await fetch(`${DRIVE_FILES_URL}?q=${encodeURIComponent(qParts.join(' and '))}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!listRes.ok) throw new Error(`Google Driveフォルダ検索に失敗しました: ${await listRes.text()}`)
  const listData = await listRes.json()
  if (listData.files?.length > 0) return listData.files[0].id

  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  })
  if (!createRes.ok) throw new Error(`Google Driveフォルダ作成に失敗しました: ${await createRes.text()}`)
  const createData = await createRes.json()
  return createData.id
}

export async function uploadFileToDrive(
  accessToken: string, folderId: string, filename: string, buffer: Buffer, mimeType = 'application/pdf'
): Promise<void> {
  const boundary = `calendarapp-${crypto.randomUUID()}`
  const metadata = JSON.stringify({ name: filename, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Google Driveへのアップロードに失敗しました: ${await res.text()}`)
}
