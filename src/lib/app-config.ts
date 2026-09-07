/**
 * 納品先ごとにアプリ名・ロゴを差し替えられるようにするための設定。
 * 環境変数を設定しない場合は従来通りShiftMateブランドのまま変わらない。
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'ShiftMate'
export const LOGO_URL = process.env.NEXT_PUBLIC_LOGO_URL || '/logo.png'
