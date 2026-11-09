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
    expect(redoFields(cur, base, fill()).fields).toEqual({
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
    const out = redoFields({ ...cur, note: '本人のメモ', tone: '本人の口調', acceptedEn: 'marble\nglass ball' }, base, fill()).fields
    expect([out.note, out.tone, out.acceptedEn]).toEqual(['本人のメモ', '本人の口調', 'marble\nglass ball'])
  })

  it('空にした欄は、直したかどうかに関わらず作り直す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, note: '', accepted: '' }, base, fill()).fields
    expect(out.note).toBe('遊び道具')
    expect(out.accepted).toBe('ビー玉\nビーだま\nガラス玉')
  })

  it('一覧の前後の空白と空の行の違いは、直したとみなさない', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, accepted: ' 大理石 \n\nだいりせき\n  ' }, base, fill()).fields
    expect(out.accepted).toBe('ビー玉\nビーだま\nガラス玉')
  })

  it('例文と訳は組: 訳だけ直しても、組ごと残す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, exampleJa: '床は大理石だ。' }, base, fill()).fields
    expect([out.exampleEn, out.exampleJa]).toEqual(['The floor is made of marble.', '床は大理石だ。'])
  })

  it('穴埋めの文と穴の答えも組: 答えだけ直しても、組ごと残す', () => {
    const { base, cur } = opened()
    const out = redoFields(
      { ...cur, clozeAnswer: 'Marble' },
      base,
      fill({ cloze: 'Kids were playing ___.', clozeAnswer: 'marbles' }),
    ).fields
    expect([out.cloze, out.clozeAnswer]).toEqual(['I found a ___ under the bed', 'Marble'])
  })

  it('組の片方を空にしたら、もう片方を直していても組ごと作り直す（片方だけの組を残さない）', () => {
    const { base, cur } = opened()
    const ex = redoFields({ ...cur, exampleEn: '', exampleJa: '自分の訳' }, base, fill()).fields
    expect([ex.exampleEn, ex.exampleJa]).toEqual(['Kids were playing marbles.', '子どもたちがビー玉で遊んでいた。'])
    const cz = redoFields({ ...cur, cloze: '', clozeAnswer: 'Marble' }, base, fill()).fields
    expect([cz.cloze, cz.clozeAnswer]).toEqual(['I found a ___ under the bed', 'marble'])
  })

  it('意味が空なら AI の意味を入れる', () => {
    const { base, cur } = opened()
    expect(redoFields({ ...cur, meaning: '' }, base, fill()).fields.meaning).toBe('ビー玉')
  })

  it('AI の許容訳に意味が無ければ足す', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, meaning: 'びー玉遊びの玉' }, base, fill({ accepted: ['ビー玉', 'ガラス玉'] })).fields
    expect(out.accepted).toBe('ビー玉\nガラス玉\nびー玉遊びの玉')
  })

  it('紛らわしい誤訳から、許容訳と意味にある訳を除く（許容訳を残したときは、残した許容訳で見る）', () => {
    const { base, cur } = opened()
    expect(redoFields(cur, base, fill({ nearMiss: ['ビー玉', 'ガラス玉', '大理石'] })).fields.nearMiss).toBe('大理石')
    const kept = redoFields({ ...cur, accepted: 'ビー玉\n大理石' }, base, fill({ nearMiss: ['大理石', '石ころ'] })).fields
    expect(kept.accepted).toBe('ビー玉\n大理石')
    expect(kept.nearMiss).toBe('石ころ')
  })

  it('許容訳を残し、その中に意味が無くても、AI の紛らわしい誤訳から意味を除く', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, accepted: 'ガラス玉' }, base, fill({ nearMiss: ['ビー玉', '石ころ'] })).fields
    expect(out.accepted).toBe('ガラス玉')
    expect(out.nearMiss).toBe('石ころ')
  })

  it('紛らわしい誤訳を残したときは、作り直す許容訳から、残した紛らわしい誤訳にある訳を除く（意味は除かない）', () => {
    const { base, cur } = opened()
    const out = redoFields({ ...cur, nearMiss: 'ガラス玉\n大理石' }, base, fill()).fields
    expect(out.nearMiss).toBe('ガラス玉\n大理石')
    expect(out.accepted).toBe('ビー玉\nビーだま')
    // 意味は許容訳に必ず入れる（意味を紛らわしい誤訳に入れていれば、保存のときに知らせて止まる）
    expect(redoFields({ ...cur, nearMiss: 'ビー玉' }, base, fill()).fields.accepted).toBe('ビーだま\nガラス玉\nビー玉')
  })

  it('種類は、直していなければ AI の値。フレーズなら穴埋めは空', () => {
    const { base, cur } = opened()
    const out = redoFields(cur, base, fill({ kind: 'phrase' })).fields
    expect(out.kind).toBe('phrase')
    expect([out.cloze, out.clozeAnswer]).toEqual(['', ''])
  })

  it('種類を直していれば残す', () => {
    const { base, cur } = opened()
    expect(redoFields({ ...cur, kind: 'phrase' }, base, fill({ kind: 'word' })).fields.kind).toBe('phrase')
  })

  it('AI の穴埋めの文か答えが空なら、穴埋めは空', () => {
    const { base, cur } = opened()
    const out = redoFields(cur, base, fill({ clozeAnswer: '' })).fields
    expect([out.cloze, out.clozeAnswer]).toEqual(['', ''])
  })

  it('2 回続けて作り直すと、1 回目に AI が入れた値は直した欄に数えない', () => {
    const { base, cur } = opened()
    const first = redoFields(cur, base, fill())
    const second = redoFields(
      first.fields,
      first.base,
      fill({ note: '2 回目', exampleEn: 'Marbles rolled away.', exampleJa: 'ビー玉が転がっていった。' }),
    ).fields
    expect([second.note, second.exampleEn, second.exampleJa]).toEqual(['2 回目', 'Marbles rolled away.', 'ビー玉が転がっていった。'])
  })

  it('1 回目で残した本人の直しは、2 回目に押しても残す（2026-11-09 の審査の指摘で直した）', () => {
    const { base, cur } = opened()
    const edited = { ...cur, note: '本人のメモ', kind: 'phrase' as const, acceptedEn: 'marble\nglass ball', exampleJa: '床は大理石だ。' }
    const first = redoFields(edited, base, fill())
    // 作り直した後の比べる値: 残した欄は前の比べる値のまま、作り直した欄は新しい値
    expect([first.base.note, first.base.kind, first.base.tone]).toEqual(['建材', 'word', '子どもの遊び'])
    const second = redoFields(
      first.fields,
      first.base,
      fill({ note: 'AI のメモ 2', kind: 'word', acceptedEn: ['marble', 'marbles'], tone: '2 回目の口調' }),
    ).fields
    expect([second.note, second.kind, second.acceptedEn, second.exampleEn, second.exampleJa]).toEqual([
      '本人のメモ',
      'phrase',
      'marble\nglass ball',
      'The floor is made of marble.',
      '床は大理石だ。',
    ])
    // 本人が直していない口調は、2 回目の AI の値になる
    expect(second.tone).toBe('2 回目の口調')
  })

  it('元の欄は変えない', () => {
    const { base, cur } = opened()
    const snapshot = structuredClone({ base, cur })
    redoFields(cur, base, fill())
    expect({ base, cur }).toEqual(snapshot)
  })
})
