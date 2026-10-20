// キーボードの上に見えている範囲（visualViewport）を CSS 変数に入れる（仕様書 5-1）。
// iOS はキーボードが出ても画面の高さを縮めないので、学習の画面はこの値に合わせて組む。
// --vvh: 見えている範囲の高さ、--vvt: 見えている範囲の上の位置（iOS が画面をずらしたときの分）。
// visualViewport が無ければ innerHeight と 0
import { useEffect } from 'react'

export function useVisualViewport(): void {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    const update = (): void => {
      root.style.setProperty('--vvh', `${vv ? vv.height : window.innerHeight}px`)
      root.style.setProperty('--vvt', `${vv ? vv.offsetTop : 0}px`)
    }
    update()
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    } else {
      window.addEventListener('resize', update)
    }
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      } else {
        window.removeEventListener('resize', update)
      }
      root.style.removeProperty('--vvh')
      root.style.removeProperty('--vvt')
    }
  }, [])
}
