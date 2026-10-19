import { describe, expect, it } from 'vitest'
import { makeCloze, scrambleWords } from './cloze.ts'

describe('makeCloze（仕様書 7-5 の表）', () => {
  it("give up / don't give up, we can still win → don't ___ ___, we can still win", () => {
    expect(makeCloze('give up', "don't give up, we can still win")).toEqual({
      cloze: "don't ___ ___, we can still win",
      answer: 'give up',
    })
  })

  // 仕様書の表の 2 行目は「He Gave Up early」だが、同じ節の決まり「語形が変わったもの（gave up など）は
  // 見つからない」と食い違う（gave と give は綴りが違う）。決まりを正とし、表の行が確認したいこと
  // （大文字・小文字を区別しない・答えは文の中の文字のまま）を Give Up で確認する
  it('give up / He Give Up early → He ___ ___ early（大文字・小文字を区別せず、答えは文の中の文字のまま）', () => {
    expect(makeCloze('give up', 'He Give Up early')).toEqual({
      cloze: 'He ___ ___ early',
      answer: 'Give Up',
    })
  })

  it('give up / He Gave Up early → 作らない（gave は語形が違う。7-5 の決まりのとおり）', () => {
    expect(makeCloze('give up', 'He Gave Up early')).toBeNull()
  })

  it('give up / forgive upstairs → 作らない（語の切れ目で一致しない）', () => {
    expect(makeCloze('give up', 'forgive upstairs')).toBeNull()
  })

  it('nerf / they nerfed the sniper → 作らない（語形が違う）', () => {
    expect(makeCloze('nerf', 'they nerfed the sniper')).toBeNull()
  })
})

describe('makeCloze の細部', () => {
  it('語と語の間の空白の数は問わず、答えは文の中の文字のまま', () => {
    expect(makeCloze('give up', 'never give   up!')).toEqual({
      cloze: 'never ___   ___!',
      answer: 'give   up',
    })
  })

  it('英語の前後の空白は無視する', () => {
    expect(makeCloze('  give  up ', 'I give up')).toEqual({ cloze: 'I ___ ___', answer: 'give up' })
  })

  it('最初に見つかった所を使う', () => {
    expect(makeCloze('give up', 'give up? never give up')).toEqual({
      cloze: '___ ___? never give up',
      answer: 'give up',
    })
  })

  it('1 語の英語', () => {
    expect(makeCloze('gg', 'GG, well played')).toEqual({ cloze: '___, well played', answer: 'GG' })
  })

  it('記号を含む英語も、そのままの文字で探す', () => {
    expect(makeCloze("what's up", "hey what's up guys")).toEqual({
      cloze: 'hey ___ ___ guys',
      answer: "what's up",
    })
  })

  it('英語か英文が空なら作らない', () => {
    expect(makeCloze('', 'give up')).toBeNull()
    expect(makeCloze('give up', '')).toBeNull()
  })
})

describe('scrambleWords（並べ替えヒント）', () => {
  it('同じ種なら同じ結果', () => {
    const text = 'Do you even wanna win?'
    expect(scrambleWords(text, '2026-10-20:w1:ja-en')).toEqual(
      scrambleWords(text, '2026-10-20:w1:ja-en'),
    )
  })

  it('記号は語に付けたまま、語を並べ替える', () => {
    const text = 'Do you even wanna win?'
    const result = scrambleWords(text, '2026-10-20:w1:ja-en')
    expect([...result].sort()).toEqual(['Do', 'even', 'wanna', 'win?', 'you'].sort())
  })

  it('3 語のとき、どの種でも元の順と違う（混ぜて同じなら 1 つずらす）', () => {
    const words = ['you', 'good', 'bro?']
    for (let i = 0; i < 100; i++) {
      const result = scrambleWords(words.join(' '), `2026-10-20:w${i}:ja-en`)
      expect(result).not.toEqual(words)
      expect([...result].sort()).toEqual([...words].sort())
    }
  })

  it('5 語のとき、どの種でも元の順と違い、種が違えば並びも変わる', () => {
    const words = ['I', 'am', 'so', 'down', 'bad']
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const result = scrambleWords(words.join(' '), `2026-10-20:w${i}:ja-en`)
      expect(result).not.toEqual(words)
      seen.add(result.join(' '))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('2 語は入れ替える', () => {
    expect(scrambleWords('nice try', 'どの種でも')).toEqual(['try', 'nice'])
  })

  it('1 語はそのまま（ボタンを出さない語）', () => {
    expect(scrambleWords('gg', '2026-10-20:w1:ja-en')).toEqual(['gg'])
  })

  it('余分な空白は語に数えない', () => {
    expect(scrambleWords('  nice   try ', 'x')).toEqual(['try', 'nice'])
    expect(scrambleWords('   ', 'x')).toEqual([])
  })
})
