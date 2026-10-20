// 画面で共通に使う見た目と文（仕様書 11 章・12 章）。ボタンは高さ 44px 以上、注記は 13px、色は白黒と ○△× の 3 色だけ。
// コンポーネントのファイル（.tsx）から定数を出すと lint（react/only-export-components）が警告するので、ここに置く
import type { Verdict } from '../lib/types.ts'

export const BUTTON = 'min-h-11 rounded-lg border border-neutral-400 px-4 disabled:opacity-40 dark:border-neutral-600'
export const PRIMARY =
  'min-h-11 rounded-lg bg-neutral-900 px-5 font-bold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-black'
export const FIELD = 'block min-h-11 w-full rounded-lg border border-neutral-400 px-3 dark:border-neutral-600'
export const AREA = 'block w-full rounded-lg border border-neutral-400 px-3 py-2 dark:border-neutral-600'
export const NOTE = 'text-[13px] text-neutral-500'
export const LINK = 'inline-flex min-h-11 items-center underline'

// 英語を入れる欄の属性（仕様書 5-1）。日本語の欄は lang="ja" だけ
export const EN_INPUT = { lang: 'en', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false } as const
export const JA_INPUT = { lang: 'ja' } as const

export const SAVE_FAILED = '保存できませんでした。アプリを閉じて開き直してください'
export const LOAD_FAILED = 'データを読めませんでした。アプリを閉じて開き直してください'

export const VERDICT_MARK: Record<Verdict, string> = { correct: '○', close: '△', wrong: '×' }
export const VERDICT_LABEL: Record<Verdict, string> = { correct: '正解', close: 'おしい', wrong: '不正解' }
// ダークでも読める濃さ（仕様書 11 章）
export const VERDICT_COLOR: Record<Verdict, string> = {
  correct: 'text-green-600',
  close: 'text-yellow-600',
  wrong: 'text-red-600',
}
// 「判定を直す」の選択肢の文（仕様書 6-6）
export const APPEAL_LABEL: Record<Verdict, string> = {
  correct: '正解にする',
  close: 'おしいにする',
  wrong: '不正解にする',
}
