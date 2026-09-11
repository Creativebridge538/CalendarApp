import { ImageResponse } from 'next/og'
import { LOGO_URL } from '@/lib/app-config'

// favicon/apple-touch-icon/PWAアイコンを納品先ごとのロゴ（NEXT_PUBLIC_LOGO_URL）から
// 動的に生成する。静的ファイル（旧icon.png等）だと全納品先で同じリポジトリを共有する
// 現構成では上書きし合ってしまうため、実行時に生成する必要がある。
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const size = Number(searchParams.get('size')) || 256

  const logoRes = await fetch(new URL(LOGO_URL, origin))
  const buf = await logoRes.arrayBuffer()
  const contentType = logoRes.headers.get('content-type') || 'image/png'
  const dataUri = `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} width={size} height={size} style={{ objectFit: 'contain' }} />
      </div>
    ),
    { width: size, height: size }
  )
}
