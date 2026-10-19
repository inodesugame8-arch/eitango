import { afterEach, describe, expect, it, vi } from 'vitest'
import { iosVersion, isIOS, isStandalone } from './platform.ts'

// 実際の UA の形（iOS 26 からは OS の版が 18_6 などで止まり、Version/ に Safari の版が出る）
const IPHONE_SAFARI_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const IPHONE_SAFARI_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_NO_VERSION =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

function stubNavigator(userAgent: string, extra: Record<string, unknown> = {}): void {
  vi.stubGlobal('navigator', { userAgent, maxTouchPoints: 0, ...extra })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isIOS', () => {
  it('iPhone は true', () => {
    stubNavigator(IPHONE_SAFARI_26, { maxTouchPoints: 5 })
    expect(isIOS()).toBe(true)
  })

  it('PC 版の表示の iPad（Mac と同じ UA）は、触れる点の数で見分ける', () => {
    stubNavigator(IPAD_DESKTOP, { maxTouchPoints: 5 })
    expect(isIOS()).toBe(true)
    stubNavigator(IPAD_DESKTOP, { maxTouchPoints: 0 })
    expect(isIOS()).toBe(false)
  })

  it('Windows は false', () => {
    stubNavigator(WINDOWS_CHROME)
    expect(isIOS()).toBe(false)
  })
})

describe('iosVersion', () => {
  it('Version/ が 26 以上なら、それを iOS の版とする（UA の OS の版は 18_6 で止まっている）', () => {
    stubNavigator(IPHONE_SAFARI_26)
    expect(iosVersion()).toBe('26.0')
  })

  it('Version/ が 26 より前なら、UA の OS の版', () => {
    stubNavigator(IPHONE_SAFARI_18)
    expect(iosVersion()).toBe('18.5')
  })

  it('Version/ が無い UA なら、UA の OS の版', () => {
    stubNavigator(IPHONE_NO_VERSION)
    expect(iosVersion()).toBe('17.4.1')
  })

  it('iOS でなければ undefined', () => {
    stubNavigator(WINDOWS_CHROME)
    expect(iosVersion()).toBeUndefined()
  })
})

describe('isStandalone', () => {
  it('navigator.standalone が true なら true（iPhone のホーム画面のアプリ）', () => {
    stubNavigator(IPHONE_NO_VERSION, { standalone: true })
    expect(isStandalone()).toBe(true)
  })

  it('standalone が false で、display-mode も standalone でなければ false', () => {
    stubNavigator(IPHONE_SAFARI_26, { standalone: false })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(isStandalone()).toBe(false)
  })

  it('PC のブラウザでインストールしたアプリ（display-mode が standalone）は true', () => {
    stubNavigator(WINDOWS_CHROME)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }))
    expect(isStandalone()).toBe(true)
  })
})
