import { describe, expect, it } from 'vitest'
import { appealChoices, applyAppeal, canAppealDown } from './appeal.ts'
import { matchLocal } from './match.ts'
import type { Word } from './types.ts'

const created = new Date(2026, 9, 18, 12)
const now = new Date(2026, 9, 20, 21, 30)

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'give up',
    kind: 'word',
    context: 'He Gave Up early',
    meaning: '諦める',
    accepted: ['諦める', 'あきらめる', 'やめる'],
    nearMiss: ['負ける', '断念する'],
    acceptedEn: ['quit'],
    cloze: 'He ___ ___ early',
    clozeAnswer: 'Gave Up',
    needsAi: false,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

describe('applyAppeal「正解にする」（○ に直す）', () => {
  it('英→日: 紛らわしい誤訳から外してから、許容訳に加える', () => {
    const w = applyAppeal(word(), 'en-ja', '断念する', 'correct', now)
    expect(w.nearMiss).toEqual(['負ける'])
    expect(w.accepted).toEqual(['諦める', 'あきらめる', 'やめる', '断念する'])
    expect(w.acceptedEn).toEqual(['quit'])
  })

  it('英→日: 外す・加えるときは正規化して比べる（記号やカタカナの違いは同じとみなす）', () => {
    const w = applyAppeal(word(), 'en-ja', '断念する。', 'correct', now)
    expect(w.nearMiss).toEqual(['負ける'])
    const w2 = applyAppeal(word(), 'en-ja', 'アキラメル', 'correct', now)
    expect(w2.accepted).toEqual(['諦める', 'あきらめる', 'やめる'])
  })

  it('英→日: 次からは照合だけで ○ になる', () => {
    const w = applyAppeal(word(), 'en-ja', '投げ出す', 'correct', now)
    expect(matchLocal(word(), 'en-ja', '投げ出す')).toBe(false)
    expect(matchLocal(w, 'en-ja', '投げ出す')).toBe(true)
  })

  it('日→英: 許容する英語に加える（日本語の一覧は変えない）', () => {
    const w = applyAppeal(word(), 'ja-en', 'throw in the towel', 'correct', now)
    expect(w.acceptedEn).toEqual(['quit', 'throw in the towel'])
    expect(w.accepted).toEqual(word().accepted)
    expect(w.nearMiss).toEqual(word().nearMiss)
    expect(matchLocal(w, 'ja-en', 'Throw in the towel!')).toBe(true)
  })

  it('日→英: すでにある英語は二重に加えない', () => {
    const w = applyAppeal(word(), 'ja-en', 'Quit!', 'correct', now)
    expect(w.acceptedEn).toEqual(['quit'])
  })

  it('加えるのは前後の空白を除いた答え', () => {
    const w = applyAppeal(word(), 'ja-en', '  call it quits ', 'correct', now)
    expect(w.acceptedEn).toEqual(['quit', 'call it quits'])
  })
})

describe('applyAppeal「不正解にする」（× に直す）', () => {
  it('英→日: 許容訳から外してから、紛らわしい誤訳に加える', () => {
    const w = applyAppeal(word(), 'en-ja', 'やめる', 'wrong', now)
    expect(w.accepted).toEqual(['諦める', 'あきらめる'])
    expect(w.nearMiss).toEqual(['負ける', '断念する', 'やめる'])
    expect(matchLocal(w, 'en-ja', 'やめる')).toBe(false)
  })

  it('英→日: すでに紛らわしい誤訳にあれば二重に加えない', () => {
    const w = applyAppeal(word(), 'en-ja', '負ける。', 'wrong', now)
    expect(w.nearMiss).toEqual(['負ける', '断念する'])
  })

  it('日→英: 許容する英語から外す（紛らわしい誤訳には加えない）', () => {
    const w = applyAppeal(word(), 'ja-en', 'Quit', 'wrong', now)
    expect(w.acceptedEn).toEqual([])
    expect(w.nearMiss).toEqual(word().nearMiss)
    expect(matchLocal(w, 'ja-en', 'quit')).toBe(false)
  })
})

describe('applyAppeal「おしいにする」（△ に直す）', () => {
  it('英→日: 許容訳から外す（紛らわしい誤訳には加えない）', () => {
    const w = applyAppeal(word(), 'en-ja', 'やめる。', 'close', now)
    expect(w.accepted).toEqual(['諦める', 'あきらめる'])
    expect(w.nearMiss).toEqual(word().nearMiss)
    expect(w.acceptedEn).toEqual(word().acceptedEn)
  })

  it('英→日: 紛らわしい誤訳にある答えなら、紛らわしい誤訳からも外す（次の AI の判定に不正解にすべき訳として渡さない）', () => {
    const w = applyAppeal(word(), 'en-ja', '断念する。', 'close', now)
    expect(w.nearMiss).toEqual(['負ける'])
    expect(w.accepted).toEqual(word().accepted)
    expect(w.acceptedEn).toEqual(word().acceptedEn)
  })

  it('英→日: △ → × → △ と直し直すと、紛らわしい誤訳は元に戻る', () => {
    const close = applyAppeal(word(), 'en-ja', '投げ出す', 'close', now)
    const wrong = applyAppeal(close, 'en-ja', '投げ出す', 'wrong', now)
    expect(wrong.nearMiss).toEqual(['負ける', '断念する', '投げ出す'])
    const back = applyAppeal(wrong, 'en-ja', '投げ出す', 'close', now)
    expect(back.nearMiss).toEqual(word().nearMiss)
    expect(back.accepted).toEqual(word().accepted)
  })

  it('英→日: 外した答えは、次は照合で ○ にならない（AI が判定する）', () => {
    expect(matchLocal(word(), 'en-ja', 'やめる')).toBe(true)
    const w = applyAppeal(word(), 'en-ja', 'やめる', 'close', now)
    expect(matchLocal(w, 'en-ja', 'やめる')).toBe(false)
  })

  it('日→英: 許容する英語から外す（日本語の一覧は変えない）', () => {
    const w = applyAppeal(word(), 'ja-en', 'Quit!', 'close', now)
    expect(w.acceptedEn).toEqual([])
    expect(w.accepted).toEqual(word().accepted)
    expect(w.nearMiss).toEqual(word().nearMiss)
    expect(matchLocal(w, 'ja-en', 'quit')).toBe(false)
  })

  it('一覧に無い答えなら、どの一覧も変えない', () => {
    const w = applyAppeal(word(), 'en-ja', '投げ出す', 'close', now)
    expect(w.accepted).toEqual(word().accepted)
    expect(w.nearMiss).toEqual(word().nearMiss)
    expect(w.acceptedEn).toEqual(word().acceptedEn)
  })
})

describe('applyAppeal の共通の決まり', () => {

  it('空の答えは一覧に加えない', () => {
    const w = applyAppeal(word(), 'en-ja', '。', 'correct', now)
    expect(w.accepted).toEqual(word().accepted)
  })

  it('updatedAt を now にし、ほかの項目は変えない', () => {
    const before = word()
    const w = applyAppeal(before, 'en-ja', '断念する', 'correct', now)
    expect(w.updatedAt.getTime()).toBe(now.getTime())
    expect(w.createdAt.getTime()).toBe(created.getTime())
    expect({ ...w, accepted: before.accepted, nearMiss: before.nearMiss, updatedAt: created }).toEqual(before)
  })

  it('入力の Word と一覧の配列を書き換えない', () => {
    const before = word()
    const snap = structuredClone(before)
    applyAppeal(before, 'en-ja', '断念する', 'correct', now)
    applyAppeal(before, 'en-ja', 'やめる', 'wrong', now)
    applyAppeal(before, 'ja-en', 'Quit', 'wrong', now)
    applyAppeal(before, 'ja-en', 'bail', 'correct', now)
    applyAppeal(before, 'en-ja', 'やめる', 'close', now)
    applyAppeal(before, 'ja-en', 'Quit', 'close', now)
    expect(before).toEqual(snap)
  })
})

describe('canAppealDown（△ と × に直す選択肢を出すか。仕様書 6-6）', () => {
  it('英→日で答えが意味（meaning）そのものなら出さない（正規化して比べる）', () => {
    expect(canAppealDown(word(), 'en-ja', '諦める')).toBe(false)
    expect(canAppealDown(word(), 'en-ja', ' 諦める。')).toBe(false)
  })

  it('英→日でそれ以外の答えなら出す（許容訳に入っていても）', () => {
    expect(canAppealDown(word(), 'en-ja', 'あきらめる')).toBe(true)
    expect(canAppealDown(word(), 'en-ja', 'やめる')).toBe(true)
    expect(canAppealDown(word(), 'en-ja', '断念する')).toBe(true)
  })

  it('日→英で答えが英語（term）そのものなら出さない', () => {
    expect(canAppealDown(word(), 'ja-en', 'Give up!')).toBe(false)
  })

  it('日→英で答えが穴の答えそのものなら出さない', () => {
    expect(canAppealDown(word(), 'ja-en', 'gave up')).toBe(false)
  })

  it('日→英でそれ以外の答えなら出す（許容する英語に入っていても）', () => {
    expect(canAppealDown(word(), 'ja-en', 'quit')).toBe(true)
    expect(canAppealDown(word(), 'ja-en', 'give in')).toBe(true)
  })

  it('穴の答えが無い語は term だけを見る', () => {
    const w = word({ cloze: undefined, clozeAnswer: undefined })
    expect(canAppealDown(w, 'ja-en', 'gave up')).toBe(true)
    expect(canAppealDown(w, 'ja-en', 'give up')).toBe(false)
  })

  it('空の答えには出さない（外す答えが無い）', () => {
    expect(canAppealDown(word(), 'en-ja', '')).toBe(false)
    expect(canAppealDown(word(), 'en-ja', '。')).toBe(false)
    expect(canAppealDown(word(), 'ja-en', ' ')).toBe(false)
  })
})

describe('appealChoices（「判定を直す」で出す選択肢。仕様書 6-6）', () => {
  it('元の判定以外の 2 つを ○ △ × の順に出す', () => {
    expect(appealChoices(word(), 'en-ja', '投げ出す', 'close', 'ai')).toEqual(['correct', 'wrong'])
    expect(appealChoices(word(), 'en-ja', '投げ出す', 'wrong', 'ai')).toEqual(['correct', 'close'])
    expect(appealChoices(word(), 'en-ja', '投げ出す', 'correct', 'self')).toEqual(['close', 'wrong'])
  })

  it('「わからない」で × になった答えには出さない', () => {
    expect(appealChoices(word(), 'en-ja', '', 'wrong', 'giveup')).toEqual([])
  })

  it('△ と × に直せない答え（英→日で意味そのもの）は、元が ○ なら何も出さない', () => {
    expect(appealChoices(word(), 'en-ja', '諦める', 'correct', 'local')).toEqual([])
  })

  it('△ と × に直せない答え（日→英で英語そのもの・穴の答えそのもの）は、○ への直しだけ残る', () => {
    expect(appealChoices(word(), 'ja-en', 'give up', 'wrong', 'self')).toEqual(['correct'])
    expect(appealChoices(word(), 'ja-en', 'gave up', 'close', 'self')).toEqual(['correct'])
  })
})
