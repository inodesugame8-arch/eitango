import { describe, expect, it } from 'vitest'
import type { FillResult } from './gemini/prompts.ts'
import { redoFields, toFields, type EditorFields } from './redo.ts'
import type { Word } from './types.ts'

const created = new Date(2026, 10, 1, 12)

// AI が「大理石」で作った語（本人は「ビー玉」にしたい。設計書 2026-11-09 の 1 章の例）
function marble(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'marble',
    kind: 'word',
    context: 'I found a marble under the bed',
    source: 'ゲーム',
    meaning: '大理石',
    tone: 'ふつう',
    accepted: ['大理石', 'だいりせき'],
    nearMiss: ['石'],
    acceptedEn: ['marble'],
    exampleEn: 'The floor is made of marble.',
    exampleJa: '床は大理石でできている。',
    note: '建材',
    cloze: 'I found a ___ under the bed',
    clozeAnswer: 'marble',
    needsAi: false,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

// 「ビー玉」で作り直したときの AI の返事
function fill(over: Partial<FillResult> = {}): FillResult {
  return {
    kind: 'word',
    meaning: 'ビー玉',
    tone: '子どもの遊び',
    accepted: ['ビー玉', 'ビーだま', 'ガラス玉'],
    nearMiss: ['大理石'],
    acceptedEn: ['marble', 'marbles'],
    exampleEn: 'Kids were playing marbles.',
    exampleJa: '子どもたちがビー玉で遊んでいた。',
    note: '遊び道具',
    cloze: 'I found a ___ under the bed',
    clozeAnswer: 'marble',
    ...over,
  }
}

// 画面を開いたときの欄（base）と、意味だけをビー玉に直した今の欄（cur）
function opened(): { base: EditorFields; cur: EditorFields } {
  const base = toFields(marble())
  return { base, cur: { ...base, meaning: 'ビー玉' } }
}

describe('toFields（語を確認・編集の画面の欄にする）', () => {
  it('無い項目は空文字、一覧は 1 行に 1 つ', () => {
    expect(toFields(marble({ tone: undefined, note: undefined, source: undefined }))).toEqual({
      term: 'marble',
      kind: 'word',
      context: 'I found a marble under the bed',
      source: '',
      meaning: '大理石',
      tone: '',
      accepted: '大理石\nだいりせき',
      nearMiss: '石',
      acceptedEn: 'marble',
      exampleEn: 'The floor is made of marble.',
      exampleJa: '床は大理石でできている。',
      note: '',
      cloze: 'I found a ___ under the bed',
      clozeAnswer: 'marble',
    })
  })
})

describe('redoFields（AI で作り直す。設計書 2026-11-09 の 3-4）', () => {
  it('意味だけ直したら、英語・出会った英文・出会った場所・意味を残し、ほかは AI の値にする', () => {
    const { base, cur } = opened()
    expect(redoFields(cur, base, fill())).toEqual({
      term: 'marble',
      kind: 'word',
      context: 'I found a marble under the bed',
      source: 'ゲーム',
      meaning: 'ビー玉',
      tone: '子どもの遊び',
      accepted: 'ビー玉\nビーだま\nガラス玉',
      nearMiss: '大理石',
      acceptedEn: 'marble\nmarbles',
      exampleEn: 'Kids were playing marbles.',
      exampleJa: '子どもたちがビー玉で遊んでいた。',
      note: '遊び道具',
      cloze: 'I found a ___ under the bed',
      clozeAnswer: 'marble',
    })
  })

  it('この画面で直した欄（空でない）は残す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, note: '本人のメモ', tone: '本人の口調', acceptedEn: 'marble\nglass ball' }, base, fill())
    expect([out.note, out.tone, out.acceptedEn]).toEqual(['本人のメモ', '本人の口調', 'marble\nglass ball'])
  })

  it('空にした欄は、直したかどうかに関わらず作り直す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, note: '', accepted: '' }, base, fill())
    expect(out.note).toBe('遊び道具')
    expect(out.accepted).toBe('ビー玉\nビーだま\nガラス玉')
  })

  it('一覧の前後の空白と空の行の違いは、直したとみなさない', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, accepted: ' 大理石 \n\nだいりせき\n  ' }, base, fill())
    expect(out.accepted).toBe('ビー玉\nビーだま\nガラス玉')
  })

  it('例文と訳は組: 訳だけ直しても、組ごと残す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, exampleJa: '床は大理石だ。' }, base, fill())
    expect([out.exampleEn, out.exampleJa]).toEqual(['The floor is made of marble.', '床は大理石だ。'])
  })

  it('穴埋めの文と穴の答えも組: 答えだけ直しても、組ごと残す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, clozeAnswer: 'Marble' }, base, fill({ cloze: 'Kids were playing ___.', clozeAnswer: 'marbles' }))
    expect([out.cloze, out.clozeAnswer]).toEqual(['I found a ___ under the bed', 'Marble'])
  })

  it('意味が空なら AI の意味を入れる', () => {
    const { base, cur } = opened()
    expect(redoFields({ ...cur, meaning: '' }, base, fill()).meaning).toBe('ビー玉')
  })

  it('AI の許容訳に意味が無ければ足す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, meaning: 'びー玉遊びの玉' }, base, fill({ accepted: ['ビー玉', 'ガラス玉'] }))
    expect(out.accepted).toBe('ビー玉\nガラス玉\nびー玉遊びの玉')
  })

  it('紛らわしい誤訳から、許容訳と意味にある訳を除く（許容訳を残したときは、残した許容訳で見る）', () => {
    const { base, cur } = opened()
    expect(redoFields(cur, base, fill({ nearMiss: ['ビー玉', 'ガラス玉', '大理石'] })).nearMiss).toBe('大理石')
    const kept = redoFields({ ...cur, accepted: 'ビー玉\n大理石' }, base, fill({ nearMiss: ['大理石', '石ころ'] }))
    expect(kept.accepted).toBe('ビー玉\n大理石')
    expect(kept.nearMiss).toBe('石ころ')
  })

  it('種類は、直していなければ AI の値。フレーズなら穴埋めは空', () => {
    const { base, cur } = opened()
    const out = redoFields(cur, base, fill({ kind: 'phrase' }))
    expect(out.kind).toBe('phrase')
    expect([out.cloze, out.clozeAnswer]).toEqual(['', ''])
  })

  it('種類を直していれば残す', () => {
    const { base, cur } = opened()
    expect(redoFields({ ...cur, kind: 'phrase' }, base, fill({ kind: 'word' })).kind).toBe('phrase')
  })

  it('AI の穴埋めの文か答えが空なら、穴埋めは空', () => {
    const { base, cur } = opened()
    const out = redoFields(cur, base, fill({ clozeAnswer: '' }))
    expect([out.cloze, out.clozeAnswer]).toEqual(['', ''])
  })

  it('2 回続けて作り直すと、1 回目の値は直した欄に数えない', () => {
    const { base, cur } = opened()
    const first = redoFields(cur, base, fill())
    const second = redoFields(
      first,
      first,
      fill({ note: '2 回目', exampleEn: 'Marbles rolled away.', exampleJa: 'ビー玉が転がっていった。' }),
    )
    expect([second.note, second.exampleEn, second.exampleJa]).toEqual(['2 回目', 'Marbles rolled away.', 'ビー玉が転がっていった。'])
  })

  it('元の欄は変えない', () => {
    const { base, cur } = opened()
    const snapshot = structuredClone({ base, cur })
    redoFields(cur, base, fill())
    expect({ base, cur }).toEqual(snapshot)
  })
})
