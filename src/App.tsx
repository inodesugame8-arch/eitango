// 画面の切り替え（location.hash: #/words・#/settings・#/check、それ以外は学習）と、上の帯・下の切り替え（仕様書 5 章）
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import AppDataProvider from './app/AppData.tsx'
import { useAppData } from './app/useAppData.ts'
import Icon from './components/Icon.tsx'
import InstallGuide from './components/InstallGuide.tsx'
import { replaceLink } from './components/ui.ts'
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

  // 画面を替えたら、いちばん上から出す（前の画面のスクロールの位置を残さない）。
  // 新しい画面を描く前に戻すので、途中の位置で開いた画面は見えない。最初の表示では呼ばない
  const shown = useRef(route)
  useLayoutEffect(() => {
    if (shown.current === route) return
    shown.current = route
    window.scrollTo(0, 0)
  }, [route])
  return route
}

function TopBar({ route }: { route: Route }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-300 bg-white pl-4 dark:border-neutral-700 dark:bg-black">
      <h1 className="text-lg font-bold">英単語</h1>
      <a
        href="#/settings"
        onClick={replaceLink}
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
      onClick={replaceLink}
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

// 外側の入れ物の左右の余白。横向きのとき、画面の角の丸みや Dynamic Island にかからないように（縦向きでは 0）
const SAFE_X = 'pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]'

function Shell({ route }: { route: Route }) {
  const { status, loadError, inSession, needRefresh, applyUpdate } = useAppData()
  // 学習の途中は、hash が変わっても学習の画面を出し続ける（外れて付き直すと、学習の画面が古い写しで覚え具合を上書きするため）
  const view: Route = inSession ? 'study' : route

  // 学習の途中に hash が変わったら（左端のスワイプや PC の「戻る」）、hash を学習に戻す
  useEffect(() => {
    if (inSession && route !== 'study') location.replace('#/')
  }, [inSession, route])

  // 動作確認は上の帯と下の切り替えを付けずに出す（データの読み込みに失敗していても開けるように）
  if (view === 'check') {
    return (
      <div className={`min-h-dvh pb-safe ${SAFE_X}`}>
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
        <a href="#/check" onClick={replaceLink} className="mt-2 inline-flex min-h-11 items-center underline">
          動作確認
        </a>
      </main>
    )
  } else if (view === 'words') {
    screen = <WordsScreen />
  } else if (view === 'settings') {
    screen = <SettingsScreen />
  } else {
    screen = <StudyScreen />
  }

  // 学習の途中は上の帯と下の切り替えを隠す（学習の画面が上に小さく「やめる」を出す）
  return (
    <div className={`flex min-h-dvh flex-col ${SAFE_X}`}>
      {!inSession && <TopBar route={view} />}
      <div className="flex-1">{screen}</div>
      {!inSession && <BottomNav route={view} />}
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
