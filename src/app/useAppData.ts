// アプリ全体のデータの型と、画面から受け取る hook。中身を作るのは AppData.tsx の AppDataProvider。
// コンポーネント（AppDataProvider）と hook を同じファイルから出すと lint（react/only-export-components）が警告するので分けた
import { createContext, useContext } from 'react'
import type { EitangoDB } from '../lib/db.ts'
import type { CardRecord, ReviewRecord, Settings, Word } from '../lib/types.ts'

export interface Snapshot {
  settings: Settings
  words: Word[]
  cards: CardRecord[]
  reviews: ReviewRecord[]
}

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface AppData extends Snapshot {
  db: EitangoDB
  status: LoadStatus // 最初の読み込み
  loadError: string
  reload: () => Promise<Snapshot> // 保存し直した後に呼ぶ。読んだものを返す（state の反映は次の描画なので、続きの計算には戻り値を使う）
  saveSettings: (patch: Partial<Settings>) => Promise<void> // 変えた項目だけ渡す。失敗したら投げる
  inSession: boolean // 学習の途中（上の帯と下の切り替えを隠す）
  setInSession: (value: boolean) => void
  needRefresh: boolean // 新しい版が待っている
  applyUpdate: () => Promise<void> // 新しい版に切り替える（ページが読み込み直される）
  checkUpdate: () => Promise<void> // 新しい版があるかを確認する。失敗したら投げる
}

export const AppDataContext = createContext<AppData | null>(null)

export function useAppData(): AppData {
  const value = useContext(AppDataContext)
  if (!value) throw new Error('useAppData は AppDataProvider の中で使う')
  return value
}
