// 書き出したファイルの共有とコピー（仕様書 9-3）。ホーム画面のアプリでは <a download> が不安定なので、
// 共有（Web Share）で「ファイルに保存」へ渡す。共有はタップから 5 秒以内に呼ばないと断られるので、
// ファイルは画面を開いたときに先に作っておく
// 動作確認の段で使うので、src/lib のほかの部品は import しない

const pad2 = (n: number): string => String(n).padStart(2, '0')

// 名前は eitango-backup-YYYYMMDD.json（端末の時計の日付。toISOString は使わない）
export function makeBackupFile(json: string, now: Date): File {
  const name = `eitango-backup-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.json`
  return new File([json], name, { type: 'application/json' })
}

export function canShareFile(file: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

// 共有の画面を出す。やめたら cancelled、共有が無い・断られた（5 秒を過ぎたなど）は failed
export async function shareFile(file: File): Promise<'shared' | 'cancelled' | 'failed'> {
  if (typeof navigator.share !== 'function') return 'failed'
  try {
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

// クリップボードに入れる。安全なページでない（LAN の http）ときは clipboard が無いので、選んでコピーする古い方法を使う
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 下の方法を試す
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}
