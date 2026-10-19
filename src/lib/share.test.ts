import { afterEach, describe, expect, it, vi } from 'vitest'
import { canShareFile, makeBackupFile, shareFile } from './share.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeBackupFile（仕様書 9-3）', () => {
  it('名前は eitango-backup-YYYYMMDD.json で、端末の時計の日付を使う', () => {
    // 日本時間の 10 月 20 日 8 時は、世界標準時では 10 月 19 日 23 時
    const file = makeBackupFile('{}', new Date(2026, 9, 20, 8, 0))
    expect(file.name).toBe('eitango-backup-20261020.json')
  })

  it('月と日は 2 桁にそろえる', () => {
    expect(makeBackupFile('{}', new Date(2027, 0, 5, 12)).name).toBe('eitango-backup-20270105.json')
  })

  it('中身は渡した JSON の文字列のままで、種類は application/json', async () => {
    const json = '{"app":"eitango","words":["諦める"]}'
    const file = makeBackupFile(json, new Date(2026, 9, 20, 21))
    expect(file.type).toBe('application/json')
    expect(await file.text()).toBe(json)
  })
})

describe('canShareFile・shareFile', () => {
  const file = makeBackupFile('{}', new Date(2026, 9, 20, 21))

  it('navigator.canShare が無ければ共有できない', () => {
    vi.stubGlobal('navigator', {})
    expect(canShareFile(file)).toBe(false)
  })

  it('canShare がファイルを断れば共有できない', () => {
    vi.stubGlobal('navigator', { share: async () => undefined, canShare: () => false })
    expect(canShareFile(file)).toBe(false)
  })

  it('canShare がファイルを受ければ共有できる', () => {
    vi.stubGlobal('navigator', { share: async () => undefined, canShare: () => true })
    expect(canShareFile(file)).toBe(true)
  })

  it('共有できたら shared、やめたら cancelled、それ以外の失敗は failed', async () => {
    vi.stubGlobal('navigator', { share: async () => undefined })
    expect(await shareFile(file)).toBe('shared')
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new DOMException('やめた', 'AbortError')
      },
    })
    expect(await shareFile(file)).toBe('cancelled')
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new DOMException('5 秒を過ぎた', 'NotAllowedError')
      },
    })
    expect(await shareFile(file)).toBe('failed')
    vi.stubGlobal('navigator', {})
    expect(await shareFile(file)).toBe('failed')
  })
})
