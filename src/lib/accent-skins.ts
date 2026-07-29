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
    id: 'studio-indigo', label: 'スタジオ',
    accent: '#5A7C93', accent2: '#7B9BB0', dark: '#435F73', bg: '#F6F7F9',
    status: { draft: '#A7AEB9', submitted: '#5E82A8', confirmed: '#5CA084', rejected: '#C36F68' },
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

export const DEFAULT_ACCENT_SKIN = 'blue'

export function getAccentSkin(id?: string | null): AccentSkin {
  return ACCENT_SKINS.find(s => s.id === id) ?? ACCENT_SKINS.find(s => s.id === DEFAULT_ACCENT_SKIN)!
}
