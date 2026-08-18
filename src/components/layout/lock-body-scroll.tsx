'use client'

import { useEffect } from 'react'

/** (app)配下のログイン後画面でのみbodyをスクロール不可に固定する。/apply・/internal等には影響しない */
export function LockBodyScroll() {
  useEffect(() => {
    document.body.classList.add('app-shell')
    return () => document.body.classList.remove('app-shell')
  }, [])
  return null
}
