// 端末の確認（仕様書 5-4・13-2）。iPhone か、ホーム画面のアプリとして開いているか、保存の永続化
// 動作確認の段で使うので、src/lib のほかの部品は import しない

// iPhone の Safari だけにある項目（TypeScript の型には無い）
interface NavigatorWithStandalone {
  standalone?: boolean
}

export function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPad の PC 版の表示は Mac と同じ UA になるので、触れる点の数で見分ける
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// ホーム画面のアプリとして開いているか（iPhone は navigator.standalone、ほかは display-mode）
export function isStandalone(): boolean {
  if ((navigator as Navigator & NavigatorWithStandalone).standalone === true) return true
  return typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches
}

// 容量が足りないときに消されにくくする。安全なページでない（LAN の http）など、使えなければ false
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

// 永続化が許されているか。使えなければ undefined
export async function isPersisted(): Promise<boolean | undefined> {
  try {
    return await navigator.storage?.persisted?.()
  } catch {
    return undefined
  }
}

// UA から見た iOS の版（例 '26.0'・'18.5'）。iOS でなければ undefined。
// iOS 26 からの Safari は、UA の OS の版を 18_6 などで止め、Version/ に Safari の版（= iOS の版）を出す。
// そのため Version/ が 26 以上ならそれを使う。目安なので、正しい版は「設定 → 一般 → 情報」で見る
export function iosVersion(): string | undefined {
  if (!isIOS()) return undefined
  const ua = navigator.userAgent
  const version = /Version\/(\d+(?:\.\d+)*)/.exec(ua)?.[1]
  if (version !== undefined && Number(version.split('.')[0]) >= 26) return version
  const os = /OS (\d+(?:_\d+)*) like Mac OS X/.exec(ua)?.[1]
  if (os !== undefined) return os.split('_').join('.')
  return version
}
