import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 下部固定タブバー（キャストのモバイル表示）と被るため、開発時のNマーク表示位置を右上に移動
  devIndicators: {
    position: "top-right",
  },
};

export default nextConfig;
