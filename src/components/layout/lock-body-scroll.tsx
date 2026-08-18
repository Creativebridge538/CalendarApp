'use client'

import { useEffect } from 'react'

/** (app)配下のログイン後画面でのみbodyをスクロール不可に固定する。/apply・/internal等には影響しない */
export function LockBodyScroll() {
  useEffect(() => {
    document.body.classList.add('app-shell')

    // 100vh/100dvhはブラウザ・PWAのスタンドアロン表示かどうかによって実際の可視領域と
    // ズレることがある（ブラウザではツールバー分だけ小さく、PWAでは逆に余分に大きく計算される、等）。
    // window.innerHeightで実測した値をCSS変数として渡し、それを高さの基準にすることで
    // どの環境でも実際に見えている領域ぴったりに固定する
    function updateViewportHeight() {
      document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`)
    }
    updateViewportHeight()
    window.addEventListener('resize', updateViewportHeight)
    window.addEventListener('orientationchange', updateViewportHeight)

    return () => {
      document.body.classList.remove('app-shell')
      window.removeEventListener('resize', updateViewportHeight)
      window.removeEventListener('orientationchange', updateViewportHeight)
    }
  }, [])
  return null
}
