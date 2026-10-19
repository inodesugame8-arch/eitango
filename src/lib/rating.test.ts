import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { SLOW_THINK_MS } from './config.ts'
import { toRating } from './rating.ts'

const base = { thinkMs: 3_000, usedHint: false, easy: false }

describe('toRating（仕様書 6-5 の表）', () => {
  it('× は Again（「わからない」も × なので Again）', () => {
    expect(toRating({ ...base, verdict: 'wrong' })).toBe(Rating.Again)
  })

  it('△ は Hard', () => {
    expect(toRating({ ...base, verdict: 'close' })).toBe(Rating.Hard)
  })

  it('○（遅い）: 答え始めるまで 10 秒以上なら Hard', () => {
    expect(SLOW_THINK_MS).toBe(10_000)
    expect(toRating({ ...base, verdict: 'correct', thinkMs: 10_000 })).toBe(Rating.Hard)
    expect(toRating({ ...base, verdict: 'correct', thinkMs: 12_000 })).toBe(Rating.Hard)
  })

  it('○（遅い）: 並べ替えヒントを使ったら Hard', () => {
    expect(toRating({ ...base, verdict: 'correct', usedHint: true })).toBe(Rating.Hard)
  })

  it('○: ふつうの速さ（10 秒未満）なら Good', () => {
    expect(toRating({ ...base, verdict: 'correct' })).toBe(Rating.Good)
    expect(toRating({ ...base, verdict: 'correct', thinkMs: 9_999 })).toBe(Rating.Good)
  })

  it('○（簡単すぎ）: 「簡単すぎ」を押したら Easy', () => {
    expect(toRating({ ...base, verdict: 'correct', easy: true })).toBe(Rating.Easy)
  })

  it('「簡単すぎ」は遅さ・ヒントより優先する（6-6「評価を Easy で付け直す」）', () => {
    expect(toRating({ ...base, verdict: 'correct', easy: true, thinkMs: 15_000 })).toBe(Rating.Easy)
    expect(toRating({ ...base, verdict: 'correct', easy: true, usedHint: true })).toBe(Rating.Easy)
  })

  it('「簡単すぎ」は ○ のときだけ効く', () => {
    expect(toRating({ ...base, verdict: 'wrong', easy: true })).toBe(Rating.Again)
    expect(toRating({ ...base, verdict: 'close', easy: true })).toBe(Rating.Hard)
  })

  it('△ と × は遅さ・ヒントで変わらない', () => {
    expect(toRating({ verdict: 'close', thinkMs: 20_000, usedHint: true, easy: false })).toBe(Rating.Hard)
    expect(toRating({ verdict: 'wrong', thinkMs: 20_000, usedHint: true, easy: false })).toBe(Rating.Again)
  })

  it('判定を直したとき: 12 秒かかった答えを ○ に直すと Hard', () => {
    expect(toRating({ verdict: 'correct', thinkMs: 12_000, usedHint: false, easy: false })).toBe(Rating.Hard)
  })
})
