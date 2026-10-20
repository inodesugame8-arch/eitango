// 画面の切り替え（location.hash: #/words・#/settings・#/check、それ以外は学習）と、上の帯・下の切り替え（仕様書 5 章）
import { useEffect, useState } from 'react'
import AppDataProvider from './app/AppData.tsx'
import { useAppData } from './app/useAppData.ts'
import Icon from './components/Icon.tsx'
import InstallGuide from './components/InstallGuide.tsx'
import UpdateBanner from './components/UpdateBanner.tsx'
import { isIOS, isStandalone, requestPersist } from './lib/platform.ts'
import CheckScreen from './screens/CheckScreen.tsx'
import SettingsScreen from './screens/SettingsScreen.tsx'
import StudyScreen from './screens/StudyScreen.tsx'
import WordsScreen from './screens/WordsScreen.tsx'

type Route = 'study' | 'words' | 'settings' | 'check'

function routeOf(hash: string): Route {
  if (hash === '#/words') return 'words'
  if (hash === '#/settings') return 'settings'
  if (hash === '#/check') return 'check'
  return 'study'
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.hash))
  useEffect(() => {
    const onChange = (): void => setRoute(routeOf(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function TopBar({ route }: { route: Route }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-300 bg-white pl-4 dark:border-neutral-700 dark:bg-black">
      <h1 className="text-lg font-bold">英単語</h1>
      <a
        href="#/settings"
        aria-label="設定"
        aria-current={route === 'settings' ? 'page' : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center px-3"
      >
        <Icon name="settings" />
      </a>
    </header>
  )
}

function BottomNav({ route }: { route: Route }) {
  const tab = (href: string, label: string, active: boolean) => (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-11 items-center justify-center border-t-2 ${
        active ? 'border-current font-bold' : 'border-transparent text-neutral-500'
      }`}
    >
      {label}
    </a>
  )
  return (
    <nav className="sticky bottom-0 z-10 grid grid-cols-2 border-t border-neutral-300 bg-white pb-safe dark:border-neutral-700 dark:bg-black">
      {tab('#/', '学習', route === 'study')}
      {tab('#/words', '単語', route === 'words')}
    </nav>
  )
}

function Shell({ route }: { route: Route }) {
  const { status, loadError, inSession, needRefresh, applyUpdate } = useAppData()

  // 動作確認は上の帯と下の切り替えを付けずに出す（データの読み込みに失敗していても開けるように）
  if (route === 'check') {
    return (
      <div className="min-h-dvh pb-safe">
        {needRefresh && <UpdateBanner onUpdate={() => void applyUpdate()} />}
        <CheckScreen />
      </div>
    )
  }

  let screen
  if (status === 'loading') {
    screen = <p className="p-4">読み込み中</p>
  } else if (status === 'error') {
    screen = (
      <main className="p-4">
        <p>データを読めませんでした。アプリを閉じて開き直してください。</p>
        <p className="mt-2 text-[13px] break-all text-neutral-500">{loadError}</p>
        <a href="#/check" className="mt-2 inline-flex min-h-11 items-center underline">
          動作確認
        </a>
      </main>
    )
  } else if (route === 'words') {
    screen = <WordsScreen />
  } else if (route === 'settings') {
    screen = <SettingsScreen />
  } else {
    screen = <StudyScreen />
  }

  // 学習の途中は上の帯と下の切り替えを隠す（学習の画面が上に小さく「やめる」を出す）
  return (
    <div className="flex min-h-dvh flex-col">
      {!inSession && <TopBar route={route} />}
      <div className="flex-1">{screen}</div>
      {!inSession && <BottomNav route={route} />}
    </div>
  )
}

export default function App() {
  const route = useRoute()
  // 本番のビルドで、iPhone の Safari のタブで開いていたら案内だけを出す（仕様書 5-4）。開発のビルドと PC のブラウザでは止めない
  const [blocked] = useState(() => import.meta.env.PROD && isIOS() && !isStandalone())

  // ホーム画面のアプリとして開いたら、容量が足りないときに消されにくくする
  useEffect(() => {
    if (!blocked && isStandalone()) void requestPersist()
  }, [blocked])

  if (blocked) return <InstallGuide />
  return (
    <AppDataProvider>
      <Shell route={route} />
    </AppDataProvider>
  )
}
