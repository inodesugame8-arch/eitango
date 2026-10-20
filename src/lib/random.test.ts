import { describe, expect, it } from 'vitest'
import { hashString, mulberry32, orderByHash } from './random.ts'

describe('hashString（32 ビットの FNV-1a）', () => {
  it('公開されている FNV-1a の値と一致する', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
  })

  it('日本語でも 0 以上 2^32 未満の整数を返す', () => {
    const h = hashString('2026-10-20:あきらめる')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
    // 「あ」の UTF-8 のバイト列（E3 81 82）の FNV-1a
    expect(hashString('あ')).toBe(0xe02c1bb1)
  })

  it('同じ文字列なら同じ値、違う文字列なら違う値', () => {
    expect(hashString('2026-10-20:abc')).toBe(hashString('2026-10-20:abc'))
    expect(hashString('2026-10-20:abc')).not.toBe(hashString('2026-10-21:abc'))
  })
})

describe('mulberry32（種つきの乱数）', () => {
  it('同じ種なら同じ列を返す', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 5 }, () => a())
    const ys = Array.from({ length: 5 }, () => b())
    expect(xs).toEqual(ys)
  })

  it('種 42 の最初の 3 つの値は決まっている（作り方が変わって今日の並びが変わらないように）', () => {
    const r = mulberry32(42)
    expect([r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099])
  })

  it('違う種なら違う列を返す', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('0 以上 1 未満を返す', () => {
    const r = mulberry32(hashString('種'))
    for (let i = 0; i < 1000; i++) {
      const x = r()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('orderByHash（ハッシュの小さい順に並べる）', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `w${i}:en-ja`)

  it('hashString(salt + ":" + key) の小さい順になる', () => {
    const sorted = orderByHash(ids, (id) => id, '2026-10-20')
    const hashes = sorted.map((id) => hashString(`2026-10-20:${id}`))
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i - 1]).toBeLessThanOrEqual(hashes[i])
    }
    expect([...sorted].sort()).toEqual([...ids].sort())
  })

  it('元の配列を変えない', () => {
    const copy = [...ids]
    orderByHash(ids, (id) => id, '2026-10-20')
    expect(ids).toEqual(copy)
  })

  it('同じ salt なら、一部を除いても残りの順は変わらない（開き直して枚数が減ったとき）', () => {
    const all = orderByHash(ids, (id) => id, '2026-10-20')
    const rest = ids.filter((_, i) => i % 3 !== 0)
    const sortedRest = orderByHash(rest, (id) => id, '2026-10-20')
    expect(sortedRest).toEqual(all.filter((id) => rest.includes(id)))
  })

  it('salt（アプリの日）が変わると並びが変わる', () => {
    const day1 = orderByHash(ids, (id) => id, '2026-10-20')
    const day2 = orderByHash(ids, (id) => id, '2026-10-21')
    expect(day2).not.toEqual(day1)
  })

  it('ハッシュが同じなら key の文字列順', () => {
    // ハッシュが同じになる key の組を探す（32 ビットなので、でたらめな key なら十数万個のうちに見つかる。
    // 末尾の数字だけが違う連番の key は FNV-1a では衝突しにくいので、乱数で key を作る）
    const r = mulberry32(1)
    const seen = new Map<number, string>()
    let pair: [string, string] | undefined
    for (let i = 0; i < 1_000_000 && !pair; i++) {
      const key = Math.floor(r() * 2 ** 32).toString(36) + Math.floor(r() * 2 ** 32).toString(36)
      const h = hashString(`x:${key}`)
      const other = seen.get(h)
      if (other !== undefined) pair = [other, key]
      else seen.set(h, key)
    }
    expect(pair).toBeDefined()
    const [a, b] = [...(pair as [string, string])].sort()
    expect(a).not.toBe(b)
    expect(orderByHash([b, a], (key) => key, 'x')).toEqual([a, b])
    expect(orderByHash([a, b], (key) => key, 'x')).toEqual([a, b])
  })
})
