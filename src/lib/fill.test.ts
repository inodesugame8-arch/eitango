import { describe, expect, it } from 'vitest'
import { applyFill } from './fill.ts'
import type { FillResult } from './gemini/prompts.ts'
import type { Word } from './types.ts'

const created = new Date(2026, 9, 18, 12)
const now = new Date(2026, 9, 20, 21, 30)

// 登録欄に入れた値から作った下書き（AI で埋める前）
function draft(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'nerf',
    kind: 'word',
    context: 'they nerfed the sniper',
    source: 'ゲーム',
    meaning: '',
    accepted: [],
    nearMiss: [],
    acceptedEn: [],
    needsAi: true,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

function fill(over: Partial<FillResult> = {}): FillResult {
  return {
    kind: 'word',
    meaning: '弱くする',
    tone: '',
    accepted: ['弱くする', '弱体化する'],
    nearMiss: ['強くする'],
    acceptedEn: ['nerf', 'weaken'],
    exampleEn: 'They nerfed my main.',
    exampleJa: 'メインのキャラが弱体化された。',
    note: 'ゲームの言葉',
    cloze: 'they ___ the sniper',
    clozeAnswer: 'nerfed',
    ...over,
  }
}

describe("applyFill(…, 'new')（登録の確認の画面に出す値。仕様書 8-1）", () => {
  it('AI が作った値で埋め、AI で補う前の印を外す（空の項目は入れない）', () => {
    const w = applyFill(draft(), fill(), 'new', now)
    expect(w).toEqual({
      id: 'w1',
      term: 'nerf',
      kind: 'word',
      context: 'they nerfed the sniper',
      source: 'ゲーム',
      meaning: '弱くする',
      accepted: ['弱くする', '弱体化する'],
      nearMiss: ['強くする'],
      acceptedEn: ['nerf', 'weaken'],
      exampleEn: 'They nerfed my main.',
      exampleJa: 'メインのキャラが弱体化された。',
      note: 'ゲームの言葉',
      cloze: 'they ___ the sniper',
      clozeAnswer: 'nerfed',
      needsAi: false,
      createdAt: created,
      updatedAt: now,
    })
    expect('tone' in w).toBe(false)
  })

  it('本人が入れた意味があればそれを使い、許容訳に必ず含める', () => {
    const w = applyFill(draft({ meaning: '弱体化させる' }), fill(), 'new', now)
    expect(w.meaning).toBe('弱体化させる')
    expect(w.accepted).toEqual(['弱くする', '弱体化する', '弱体化させる'])
  })

  it('AI の許容訳に意味が無ければ足す（正規化して同じなら足さない）', () => {
    expect(applyFill(draft(), fill({ accepted: ['弱体化する'] }), 'new', now).accepted).toEqual([
      '弱体化する',
      '弱くする',
    ])
    // カタカナとひらがなは正規化で同じになる（漢字とかなは別。仕様書 7-1）
    expect(
      applyFill(draft({ meaning: 'ヨワクスル' }), fill({ accepted: ['よわくする', '弱体化する'] }), 'new', now).accepted,
    ).toEqual(['よわくする', '弱体化する'])
  })

  it('種類は AI の値。フレーズなら穴埋めは入れない', () => {
    const w = applyFill(draft({ term: 'my bad' }), fill({ kind: 'phrase' }), 'new', now)
    expect(w.kind).toBe('phrase')
    expect('cloze' in w).toBe(false)
    expect('clozeAnswer' in w).toBe(false)
  })

  it('一覧の重複は 1 つにする', () => {
    const w = applyFill(draft(), fill({ acceptedEn: ['nerf', 'Nerf!', 'weaken'] }), 'new', now)
    expect(w.acceptedEn).toEqual(['nerf', 'weaken'])
  })

  it('許容訳にある訳は紛らわしい誤訳に入れない（本人の意味を AI が紛らわしい誤訳に挙げても）', () => {
    const w = applyFill(
      draft({ term: 'sick', meaning: '病気の' }),
      fill({ meaning: 'すごい', accepted: ['すごい', '最高'], nearMiss: ['病気の', '気分が悪い'] }),
      'new',
      now,
    )
    expect(w.accepted).toEqual(['すごい', '最高', '病気の'])
    expect(w.nearMiss).toEqual(['気分が悪い'])
  })
})

describe("applyFill(…, 'supplement')（AI で補う。仕様書 8-4）", () => {
  // AI が使えないときに意味だけ入れて保存した語（8-2 の初めの値）
  function saved(over: Partial<Word> = {}): Word {
    return {
      id: 'w2',
      term: 'give up',
      kind: 'word',
      context: 'He Gave Up early',
      meaning: 'あきらめる',
      accepted: ['あきらめる'],
      nearMiss: [],
      acceptedEn: ['give up'],
      exampleEn: 'I never give up.',
      note: '',
      needsAi: true,
      createdAt: created,
      updatedAt: created,
      ...over,
    }
  }

  const ai = fill({
    kind: 'phrase',
    meaning: '諦める',
    tone: 'ふつう',
    accepted: ['諦める', 'アキラメル', '断念する'],
    nearMiss: ['負ける'],
    acceptedEn: ['give up', 'Give up!', 'quit'],
    exampleEn: "Don't give up.",
    exampleJa: '諦めるな。',
    note: '熟語',
    cloze: 'He ___ ___ early',
    clozeAnswer: 'Gave Up',
  })

  it('意味と種類は変えず、一覧は足すだけ、空の項目だけ埋める', () => {
    const w = applyFill(saved(), ai, 'supplement', now)
    expect(w).toEqual({
      id: 'w2',
      term: 'give up',
      kind: 'word',
      context: 'He Gave Up early',
      meaning: 'あきらめる',
      tone: 'ふつう',
      accepted: ['あきらめる', '諦める', '断念する'],
      nearMiss: ['負ける'],
      acceptedEn: ['give up', 'quit'],
      exampleEn: 'I never give up.',
      note: '熟語',
      cloze: 'He ___ ___ early',
      clozeAnswer: 'Gave Up',
      needsAi: false,
      createdAt: created,
      updatedAt: now,
    })
  })

  it('例文は英語と訳の組で扱う（英語の例文があれば、訳だけを別の例文から入れない）', () => {
    expect('exampleJa' in applyFill(saved(), ai, 'supplement', now)).toBe(false)
    const w = applyFill(saved({ exampleEn: undefined }), ai, 'supplement', now)
    expect([w.exampleEn, w.exampleJa]).toEqual(["Don't give up.", '諦めるな。'])
  })

  it('穴埋めがすでにあれば変えない', () => {
    const w = applyFill(saved({ cloze: '___ ___!', clozeAnswer: 'give up' }), ai, 'supplement', now)
    expect([w.cloze, w.clozeAnswer]).toEqual(['___ ___!', 'give up'])
  })

  it('口調とメモは、入っていれば変えない（空の項目だけ埋める）', () => {
    const w = applyFill(saved({ tone: '本人の口調', note: '本人のメモ' }), ai, 'supplement', now)
    expect([w.tone, w.note]).toEqual(['本人の口調', '本人のメモ'])
  })

  it('穴埋めの答えが空なら、文があっても穴埋めを入れない（new も、穴埋めの無い語への supplement も）', () => {
    const noAnswer = fill({ clozeAnswer: '' })
    const made = applyFill(draft(), noAnswer, 'new', now)
    const filled = applyFill(saved(), noAnswer, 'supplement', now)
    expect(['cloze' in made, 'clozeAnswer' in made]).toEqual([false, false])
    expect(['cloze' in filled, 'clozeAnswer' in filled]).toEqual([false, false])
  })

  it('フレーズの語には穴埋めを入れない（種類は本人のまま）', () => {
    const w = applyFill(saved({ term: 'my bad', kind: 'phrase' }), ai, 'supplement', now)
    expect(w.kind).toBe('phrase')
    expect('cloze' in w).toBe(false)
  })

  it('元の語は変えない', () => {
    const original = saved()
    const snapshot = structuredClone(original)
    applyFill(original, ai, 'supplement', now)
    expect(original).toEqual(snapshot)
  })

  it('紛らわしい誤訳にある訳は許容訳に足さない（× に直して紛らわしい誤訳に入れた訳を、許容訳に戻さない）。許容訳にある訳は紛らわしい誤訳に足さない', () => {
    // 本人が × に直して紛らわしい誤訳に入れた「断念する」を、AI が許容訳に挙げても戻さない
    const w = applyFill(saved({ nearMiss: ['断念する'] }), ai, 'supplement', now)
    expect(w.accepted).toEqual(['あきらめる', '諦める'])
    expect(w.nearMiss).toEqual(['断念する', '負ける'])
    // 本人が ○ に直して許容訳に入れた「負ける」を、AI が紛らわしい誤訳に挙げても足さない
    expect(applyFill(saved({ accepted: ['あきらめる', '負ける'] }), ai, 'supplement', now).nearMiss).toEqual([])
  })
})
