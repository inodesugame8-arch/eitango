import { useEffect, useState } from 'react'
import UpdateBanner from './components/UpdateBanner.tsx'
import { usePwaUpdate } from './pwa.ts'
import CheckScreen from './screens/CheckScreen.tsx'

// 動作確認の段の画面の切り替え。#/check なら動作確認、それ以外は「準備中」。
// 学習・単語・設定の画面ができたら（T29）、最終の版に置き換える
function useHash(): string {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const onChange = (): void => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function App() {
  const hash = useHash()
  // サービスワーカーを登録し、起動したときと画面が前に戻ったときに新しい版を確認する（動作確認で更新の届き方を試すため）
  const { needRefresh, applyUpdate } = usePwaUpdate()

  return (
    <div className="min-h-dvh pb-safe">
      {needRefresh && <UpdateBanner onUpdate={() => void applyUpdate()} />}
      {hash === '#/check' ? (
        <CheckScreen />
      ) : (
        <main className="p-4">
          <h1 className="text-2xl font-bold">英単語</h1>
          <p className="mt-4">準備中</p>
          <a href="#/check" className="mt-2 inline-flex min-h-11 items-center underline">
            動作確認
          </a>
        </main>
      )}
    </div>
  )
}

export default App
