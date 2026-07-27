import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // キャストのモバイル表示は上下とも固定バーで四隅が埋まっているため、
  // 開発時のNマークはどの位置に置いても何かと被る。非表示にする
  devIndicators: false,
  // 実機スマホから同じWi-Fi経由でdevサーバーにアクセスして確認するため許可
  allowedDevOrigins: ['192.168.10.120'],
};

export default nextConfig;
