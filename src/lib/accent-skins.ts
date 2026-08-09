export type ShiftStatusColors = {
  draft: string
  submitted: string
  confirmed: string
  rejected: string
}

export type AccentSkin = {
  id: string
  label: string
  accent: string
  accent2: string
  dark: string
  bg: string
  /** 未指定ならシフトカレンダーの状態色は既定値（青/緑/赤）のまま */
  status?: ShiftStatusColors
  /** trueの場合、背景・カード・文字色なども合わせてダーク配色にする（画面全体をダークモード化） */
  isDark?: boolean
}

export const ACCENT_SKINS: AccentSkin[] = [
  { id: 'blue',   label: 'ブルー',   accent: '#3987e5', accent2: '#5b9ee8', dark: '#2f6fc4', bg: '#f7f7f8' },
  { id: 'black',  label: 'ブラック', accent: '#d4a537', accent2: '#e8c766', dark: '#a3791f', bg: '#141414', isDark: true },
  {
    id: 'clinical', label: 'クリニカル',
    accent: '#3E6E78', accent2: '#5C8B94', dark: '#2F565E', bg: '#F6F7F5',
    status: { draft: '#9AA6A3', submitted: '#4E8FA0', confirmed: '#4C8F6B', rejected: '#B25A56' },
  },
  {
    id: 'warm-ledger', label: 'あたたかい家計',
    accent: '#48607A', accent2: '#6883A0', dark: '#35485C', bg: '#FBF5EC',
    status: { draft: '#B8AA9B', submitted: '#5C7FA6', confirmed: '#6E9B6A', rejected: '#C07056' },
  },
  {
    id: 'studio-indigo', label: 'スタンダード',
    accent: '#00A99D', accent2: '#33BDB3', dark: '#00847A', bg: '#FFFFFF',
    status: { draft: '#B7B7B7', submitted: '#F2A65A', confirmed: '#00A99D', rejected: '#D96C6C' },
  },
  {
    id: 'sunshine', label: 'サンシャイン',
    accent: '#FF7A45', accent2: '#FF9A6E', dark: '#D65A2E', bg: '#FFF7F0',
    status: { draft: '#D9C9BA', submitted: '#3F8FE0', confirmed: '#1FB574', rejected: '#F0453D' },
  },
  {
    id: 'sky', label: 'スカイ',
    accent: '#1FA9DB', accent2: '#5CC4EA', dark: '#167FA8', bg: '#F0FAFF',
    status: { draft: '#B9C6CE', submitted: '#6C7FE0', confirmed: '#1FB574', rejected: '#F0453D' },
  },
]

// studio-indigo は globals.css :root の既定値と同じ配色。着せ替え未設定のキャストは
// ここ経由で明示的にこの配色を受け取り、admin/ログイン画面はglobals.css側の既定値をそのまま使う
export const DEFAULT_ACCENT_SKIN = 'studio-indigo'

export function getAccentSkin(id?: string | null): AccentSkin {
  return ACCENT_SKINS.find(s => s.id === id) ?? ACCENT_SKINS.find(s => s.id === DEFAULT_ACCENT_SKIN)!
}
