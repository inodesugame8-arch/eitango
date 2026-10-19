import { describe, expect, it } from 'vitest'
import { matchLocal, sameEn, sameJa } from './match.ts'
import type { Word } from './types.ts'

function word(over: Partial<Word> = {}): Word {
  const t = new Date(2026, 9, 20, 12)
  return {
    id: 'w1',
    term: 'give up',
    kind: 'word',
    context: 'He Gave Up early',
    meaning: '諦める',
    accepted: ['諦める', 'あきらめる', 'やめる'],
    nearMiss: ['負ける'],
    acceptedEn: ['quit', 'throw in the towel'],
    cloze: 'He ___ ___ early',
    clozeAnswer: 'Gave Up',
    needsAi: false,
    createdAt: t,
    updatedAt: t,
    ...over,
  }
}

describe('sameJa と sameEn', () => {
  it('正規化して同じなら true', () => {
    expect(sameJa('アキラメル。', 'あきらめる')).toBe(true)
    expect(sameEn("Don't", 'do not')).toBe(true)
    expect(sameEn('wanna', 'want to')).toBe(true)
  })

  it('違えば false', () => {
    expect(sameJa('諦める', 'あきらめる')).toBe(false)
    expect(sameEn('give up', 'give in')).toBe(false)
  })

  it('空どうし・記号だけどうしは同じとみなさない', () => {
    expect(sameJa('', '')).toBe(false)
    expect(sameJa('。', '！')).toBe(false)
    expect(sameEn('', '')).toBe(false)
    expect(sameEn('?!', '...')).toBe(false)
  })
})

describe('matchLocal 英→日（accepted と照合）', () => {
  it('accepted のどれかと正規化して同じなら ○', () => {
    expect(matchLocal(word(), 'en-ja', '諦める')).toBe(true)
    expect(matchLocal(word(), 'en-ja', 'アキラメル')).toBe(true)
    expect(matchLocal(word(), 'en-ja', ' やめる。')).toBe(true)
  })

  it('accepted に無い訳は ○ にしない（紛らわしい誤訳も）', () => {
    expect(matchLocal(word(), 'en-ja', '断念する')).toBe(false)
    expect(matchLocal(word(), 'en-ja', '負ける')).toBe(false)
  })

  it('英語（term）を打っても英→日では ○ にしない', () => {
    expect(matchLocal(word(), 'en-ja', 'give up')).toBe(false)
  })

  it('空の答えは ○ にしない（accepted に空や記号が混じっていても）', () => {
    const w = word({ accepted: ['諦める', '', '。'] })
    expect(matchLocal(w, 'en-ja', '')).toBe(false)
    expect(matchLocal(w, 'en-ja', '   ')).toBe(false)
    expect(matchLocal(w, 'en-ja', '。')).toBe(false)
  })
})

describe('matchLocal 日→英（term・acceptedEn・clozeAnswer と照合）', () => {
  it('term と同じなら ○', () => {
    expect(matchLocal(word(), 'ja-en', 'Give up!')).toBe(true)
  })

  it('acceptedEn と同じなら ○', () => {
    expect(matchLocal(word(), 'ja-en', 'Quit')).toBe(true)
    expect(matchLocal(word(), 'ja-en', 'throw in the towel.')).toBe(true)
  })

  it('clozeAnswer と同じなら ○（穴埋めの文の中の語形）', () => {
    expect(matchLocal(word(), 'ja-en', 'gave up')).toBe(true)
  })

  it('どれとも違えば ○ にしない', () => {
    expect(matchLocal(word(), 'ja-en', 'give in')).toBe(false)
    expect(matchLocal(word(), 'ja-en', 'gives up')).toBe(false)
  })

  it('日本語の許容訳を打っても日→英では ○ にしない', () => {
    expect(matchLocal(word(), 'ja-en', '諦める')).toBe(false)
  })

  it('clozeAnswer が無い語でも term と acceptedEn で照合する', () => {
    const w = word({ cloze: undefined, clozeAnswer: undefined })
    expect(matchLocal(w, 'ja-en', 'give up')).toBe(true)
    expect(matchLocal(w, 'ja-en', 'gave up')).toBe(false)
  })

  it('短縮形・崩した言い方は展開して比べる', () => {
    const w = word({ term: "don't wanna", acceptedEn: [], cloze: undefined, clozeAnswer: undefined })
    expect(matchLocal(w, 'ja-en', 'do not want to')).toBe(true)
    expect(matchLocal(w, 'ja-en', 'Don’t wanna')).toBe(true)
  })

  it('空の答えは ○ にしない', () => {
    expect(matchLocal(word(), 'ja-en', '')).toBe(false)
    expect(matchLocal(word(), 'ja-en', '!?')).toBe(false)
  })
})
