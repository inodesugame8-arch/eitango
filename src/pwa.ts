import { useCallback, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export interface PwaUpdate {
  needRefresh: boolean // 新しい版が待っている
  applyUpdate: () => Promise<void> // 新しい版に切り替える（ページが読み込み直される）
  checkUpdate: () => Promise<void> // 新しい版があるかをサーバーに確認する（登録がまだなら何もしない）
}

// サービスワーカーを登録し、新しい版があるかを返す（registerType は prompt）。
// ホーム画面のアプリは閉じずに戻ると読み込み直しが起きないので、起動したときと
// 画面が前に戻ったとき（visibilitychange）に registration.update() で確認する（仕様書 5-4）。
// useRegisterSW を呼ぶのはアプリの中でこの 1 か所だけにする
export function usePwaUpdate(): PwaUpdate {
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      registration.current = r
      // 起動したときに 1 回確認する。電波が無いなどで失敗しても、次に戻ったときにまた確認する
      r?.update().catch(() => undefined)
    },
  })

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      registration.current?.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // 「更新を確認する」ボタン用。失敗はそのまま投げる（画面で文を出すため）
  const checkUpdate = useCallback(async (): Promise<void> => {
    await registration.current?.update()
  }, [])

  const applyUpdate = useCallback(() => updateServiceWorker(true), [updateServiceWorker])

  return { needRefresh, applyUpdate, checkUpdate }
}
