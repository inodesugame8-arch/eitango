// アプリ全体のデータ（語・カード・解答記録・設定）と、学習中かどうか・新しい版の知らせを配る。
// 学習・単語・設定の画面は props を取らず、useAppData()（./useAppData.ts）で受け取る
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultSettings, EitangoDB, getSettings, loadAll, saveSettings as storeSettings } from '../lib/db.ts'
import type { Settings } from '../lib/types.ts'
import { usePwaUpdate } from '../pwa.ts'
import { AppDataContext, type AppData, type LoadStatus, type Snapshot } from './useAppData.ts'

async function fetchSnapshot(db: EitangoDB): Promise<Snapshot> {
  const [all, settings] = await Promise.all([loadAll(db), getSettings(db)])
  return { settings, ...all }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

export default function AppDataProvider({ children }: { children: ReactNode }) {
  // データベースはアプリで 1 つ（開くのは最初の読み書きのとき）
  const [db] = useState(() => new EitangoDB())
  const [snap, setSnap] = useState<Snapshot>(() => ({ settings: defaultSettings(), words: [], cards: [], reviews: [] }))
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [inSession, setInSession] = useState(false)
  const settingsRef = useRef(snap.settings)
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  // サービスワーカーの登録はアプリの中でここ 1 か所だけ
  const { needRefresh, applyUpdate, checkUpdate } = usePwaUpdate()

  const reload = useCallback(async (): Promise<Snapshot> => {
    const next = await fetchSnapshot(db)
    settingsRef.current = next.settings
    setSnap(next)
    return next
  }, [db])

  // 最初の読み込み
  useEffect(() => {
    let alive = true
    fetchSnapshot(db).then(
      (next) => {
        if (!alive) return
        settingsRef.current = next.settings
        setSnap(next)
        setStatus('ready')
      },
      (e: unknown) => {
        if (!alive) return
        setLoadError(errorMessage(e))
        setStatus('error')
      },
    )
    return () => {
      alive = false
    }
  }, [db])

  // 画面にはすぐ反映し、書き込みは順に行う（続けて変えたときに古い値で上書きしないように）
  const saveSettings = useCallback(
    (patch: Partial<Settings>): Promise<void> => {
      const next: Settings = { ...settingsRef.current, ...patch }
      settingsRef.current = next
      setSnap((s) => ({ ...s, settings: next }))
      const write = writes.current.then(() => storeSettings(db, next))
      writes.current = write.catch(() => undefined)
      return write
    },
    [db],
  )

  const value = useMemo<AppData>(
    () => ({
      ...snap,
      db,
      status,
      loadError,
      reload,
      saveSettings,
      inSession,
      setInSession,
      needRefresh,
      applyUpdate,
      checkUpdate,
    }),
    [snap, db, status, loadError, reload, saveSettings, inSession, needRefresh, applyUpdate, checkUpdate],
  )
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
