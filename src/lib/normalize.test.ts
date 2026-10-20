import { describe, expect, it } from 'vitest'
import { normalizeEn, normalizeEnKey, normalizeJa } from './normalize.ts'

describe('仕様書 7-1 の表の 5 例', () => {
  it('アキラメル。 → あきらめる', () => {
    expect(normalizeJa('アキラメル。')).toBe('あきらめる')
  })

  it('諦める → 諦める（漢字はそのまま）', () => {
    expect(normalizeJa('諦める')).toBe('諦める')
  })

  it('Do you even wanna win? → do you even want to win', () => {
    expect(normalizeEn('Do you even wanna win?')).toBe('do you even want to win')
  })

  it("I'm gonna carry → i am going to carry", () => {
    expect(normalizeEn("I'm gonna carry")).toBe('i am going to carry')
  })

  it('Don’t give up!（曲がった引用符） → do not give up', () => {
    expect(normalizeEn('Don’t give up!')).toBe('do not give up')
  })
})

describe('normalizeJa', () => {
  it('半角カナを NFKC でそろえてからひらがなにする', () => {
    expect(normalizeJa('ｱｷﾗﾒﾙ')).toBe('あきらめる')
  })

  it('長音の「ー」は消さない', () => {
    expect(normalizeJa('スーパー')).toBe('すーぱー')
  })

  it('空白（全角を含む）を消す', () => {
    expect(normalizeJa(' あき　らめる ')).toBe('あきらめる')
  })

  it('仕様書の記号を消す', () => {
    expect(normalizeJa('「諦める」')).toBe('諦める')
    expect(normalizeJa('『諦める』！？')).toBe('諦める')
    expect(normalizeJa('（諦める）')).toBe('諦める')
    expect(normalizeJa('【諦める】［あ］')).toBe('諦めるあ')
    expect(normalizeJa('諦める、あきらめる。')).toBe('諦めるあきらめる')
    expect(normalizeJa('諦める〜')).toBe('諦める')
    expect(normalizeJa('諦める～')).toBe('諦める')
    expect(normalizeJa('すご～い')).toBe(normalizeJa('すご〜い'))
    expect(normalizeJa('諦める…')).toBe('諦める')
    expect(normalizeJa('勝つ・負ける')).toBe('勝つ負ける')
    expect(normalizeJa('“諦める”')).toBe('諦める')
  })

  it('全角の英数字は NFKC で半角になり、英字は小文字にそろえる', () => {
    expect(normalizeJa('ＧＧ１２３')).toBe('gg123')
  })

  it('英字まじりの訳は大文字・小文字を問わず同じになる', () => {
    expect(normalizeJa('Dmを送る')).toBe(normalizeJa('DMを送る'))
  })

  it('記号だけの答えは空になる', () => {
    expect(normalizeJa('。！？')).toBe('')
  })
})

describe('normalizeEn', () => {
  it('崩した言い方を展開する', () => {
    expect(normalizeEn('wanna')).toBe('want to')
    expect(normalizeEn('gonna')).toBe('going to')
    expect(normalizeEn('gotta go')).toBe('got to go')
    expect(normalizeEn('Gimme that')).toBe('give me that')
    expect(normalizeEn('lemme see')).toBe('let me see')
    expect(normalizeEn('kinda')).toBe('kind of')
    expect(normalizeEn('sorta')).toBe('sort of')
    expect(normalizeEn('dunno')).toBe('do not know')
  })

  it('語の一部は展開しない', () => {
    expect(normalizeEn('wannabe')).toBe('wannabe')
  })

  it('短縮形を展開する', () => {
    expect(normalizeEn("can't")).toBe('can not')
    expect(normalizeEn("won't")).toBe('will not')
    expect(normalizeEn("shan't")).toBe('shall not')
    expect(normalizeEn('cannot')).toBe('can not')
    expect(normalizeEn("isn't")).toBe('is not')
    expect(normalizeEn("doesn't")).toBe('does not')
    expect(normalizeEn("you're")).toBe('you are')
    expect(normalizeEn("we've")).toBe('we have')
    expect(normalizeEn("they'll")).toBe('they will')
  })

  it("'s と 'd は展開せず、記号として消す", () => {
    expect(normalizeEn("it's")).toBe('its')
    expect(normalizeEn("I'd like")).toBe('id like')
  })

  it("'d を would にしないので、had の 'd に would と打った答えは合わない", () => {
    expect(normalizeEn("You'd better go")).not.toBe(normalizeEn('you would better go'))
  })

  it('曲がった引用符をまっすぐにしてから展開する', () => {
    expect(normalizeEn('I’m')).toBe('i am')
    expect(normalizeEn('can‘t')).toBe('can not')
  })

  it('英字・数字・空白以外を消し、空白を 1 つにまとめる', () => {
    expect(normalizeEn('  GG,   well   played!!  ')).toBe('gg well played')
    expect(normalizeEn('“nice”')).toBe('nice')
    expect(normalizeEn('o7')).toBe('o7')
  })

  it('全角の英字を NFKC で半角にして小文字にする', () => {
    expect(normalizeEn('ＧＧ')).toBe('gg')
  })

  it('アクセント記号を外す（文字ごとは消さない）', () => {
    expect(normalizeEn('café')).toBe('cafe')
    expect(normalizeEn('Pokémon')).toBe('pokemon')
    expect(normalizeEn('touché')).toBe('touche')
    expect(normalizeEn('touché')).not.toBe(normalizeEn('touch'))
  })

  it('展開した形と元の形が同じになる', () => {
    expect(normalizeEn("Don't")).toBe(normalizeEn('do not'))
    expect(normalizeEn('wanna win')).toBe(normalizeEn('want to win'))
  })
})

describe('normalizeEnKey（まとめて読み込むときの同じ語の見分け。仕様書 8-3）', () => {
  it('崩した言い方と短縮形は展開せず、それ以外は normalizeEn と同じにそろえる', () => {
    expect(normalizeEnKey('wanna')).toBe('wanna')
    expect(normalizeEnKey('Don’t give up!')).toBe('dont give up')
    expect(normalizeEnKey('Café')).toBe('cafe')
  })
})
