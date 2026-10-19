import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('newId', () => {
  it('crypto.randomUUID があれば UUID を返す', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('crypto が無いとき（LAN の http）は 32 文字の 16 進を返す', () => {
    vi.stubGlobal('crypto', undefined)
    expect(globalThis.crypto).toBeUndefined()
    expect(newId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('crypto はあっても randomUUID が無いときも 32 文字の 16 進を返す', () => {
    vi.stubGlobal('crypto', {})
    expect(newId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('crypto が無いときの id は Date.now() の 16 進で始まる', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(0x19a0b1c2d3e)
    expect(newId().slice(0, 12)).toBe('019a0b1c2d3e')
  })

  it('crypto が無いときも 1000 回作って重ならない', () => {
    vi.stubGlobal('crypto', undefined)
    const ids = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(ids.size).toBe(1000)
  })
})
