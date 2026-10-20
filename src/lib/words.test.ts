import { createEmptyCard } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { ReviewRecord, Verdict, Word } from './types.ts'
import { applyEdit, manualWord, sortWords } from './words.ts'

const created = new Date(2026, 9, 18, 12)
const now = new Date(2026, 9, 20, 21, 30)

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'give up',
    kind: 'word',
    context: "don't give up, we can still win",
    meaning: '諦める',
    accepted: ['諦める', 'あきらめる'],
    nearMiss: ['負ける'],
    acceptedEn: ['give up', 'quit'],
    exampleEn: 'Never give up.',
    exampleJa: '決して諦めるな。',
    cloze: "don't ___ ___, we can still win",
    clozeAnswer: 'give up',
    needsAi: false,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

describe('manualWord（AI が使えないときに、意味を自分で入れて保存する語。仕様書 8-2）', () => {
  it('許容訳は意味だけ、許容する英語は英語だけ、穴埋めは 7-5 の決まりで作り、AI で補う前の印を付ける', () => {
    const w = manualWord(
      { term: ' give up ', context: "don't give up, we can still win", meaning: ' あきらめる ', source: 'ゲーム' },
      now,
    )
    expect(w).toEqual({
      id: expect.any(String),
      term: 'give up',
      kind: 'word',
      context: "don't give up, we can still win",
      source: 'ゲーム',
      meaning: 'あきらめる',
      accepted: ['あきらめる'],
      nearMiss: [],
      acceptedEn: ['give up'],
      cloze: "don't ___ ___, we can still win",
      clozeAnswer: 'give up',
      needsAi: true,
      createdAt: now,
      updatedAt: now,
    })
    expect(w.id).not.toBe('')
  })

  it('種類の初めの値は「3 語以上か、? か ! で終わればフレーズ」。フレーズには穴埋めを作らない', () => {
    const w = manualWord({ term: 'Do you even wanna win?', context: 'Do you even wanna win?', meaning: '勝つ気あんの' }, now)
    expect(w.kind).toBe('phrase')
    expect(w.cloze).toBeUndefined()
    expect(w.clozeAnswer).toBeUndefined()
  })

  it('語形が変わったもの（nerfed）は穴埋めを作らない。空の出会った英文・出会った場所は項目ごと入れない', () => {
    const w = manualWord({ term: 'nerf', context: 'they nerfed the sniper', meaning: '弱くする', source: ' ' }, now)
    expect(w.cloze).toBeUndefined()
    expect('source' in w).toBe(false)
    const w2 = manualWord({ term: 'nerf', context: '', meaning: '弱くする' }, now)
    expect('context' in w2).toBe(false)
  })
})

describe('applyEdit（編集の保存。仕様書 9-4）', () => {
  it('意味・例文などを直しても、穴埋めと AI で補う前の印はそのまま。id と作った日時は元のまま、updatedAt は now', () => {
    const original = word()
    const out = applyEdit(original, { ...original, id: 'x', createdAt: now, exampleEn: 'I never give up.', tone: 'ふつう' }, now)
    expect(out.id).toBe('w1')
    expect(out.createdAt).toBe(created)
    expect(out.updatedAt).toBe(now)
    expect(out.exampleEn).toBe('I never give up.')
    expect(out.tone).toBe('ふつう')
    expect(out.cloze).toBe("don't ___ ___, we can still win")
    expect(out.clozeAnswer).toBe('give up')
    expect(out.needsAi).toBe(false)
  })

  it('英語を変えたら、穴埋めを空にし、AI で補う前の印を付ける', () => {
    const out = applyEdit(word(), { ...word(), term: 'give in' }, now)
    expect(out.term).toBe('give in')
    expect('cloze' in out).toBe(false)
    expect('clozeAnswer' in out).toBe(false)
    expect(out.needsAi).toBe(true)
  })

  it('英語を変えたら、許容する英語に入っている元の英語も新しい英語に替える（重なれば 1 つにする）', () => {
    const original = word({ term: 'give in', acceptedEn: ['give in', 'quit'] })
    expect(applyEdit(original, { ...original, term: 'give up' }, now).acceptedEn).toEqual(['give up', 'quit'])
    // 編集の画面で許容する英語も直していれば、その値で替える
    const edited = applyEdit(original, { ...original, term: 'give up', acceptedEn: ['Give in!', 'give up', 'surrender'] }, now)
    expect(edited.acceptedEn).toEqual(['give up', 'surrender'])
  })

  it('出会った英文を変えた（消した）ときも、穴埋めを空にし、AI で補う前の印を付ける', () => {
    const changed = applyEdit(word(), { ...word(), context: "never give up, we can win" }, now)
    expect('cloze' in changed).toBe(false)
    expect(changed.needsAi).toBe(true)
    const removed = applyEdit(word(), { ...word(), context: '  ' }, now)
    expect('context' in removed).toBe(false)
    expect('cloze' in removed).toBe(false)
    expect(removed.needsAi).toBe(true)
  })

  it('前後の空白だけの違いは、変えたとみなさない', () => {
    const out = applyEdit(word(), { ...word(), term: ' give up ' }, now)
    expect(out.term).toBe('give up')
    expect(out.cloze).toBe("don't ___ ___, we can still win")
    expect(out.needsAi).toBe(false)
  })

  it('種類をフレーズに変えたら、穴埋めを空にする（AI で補う前の印は変えない）', () => {
    const out = applyEdit(word(), { ...word(), kind: 'phrase' }, now)
    expect(out.kind).toBe('phrase')
    expect('cloze' in out).toBe(false)
    expect('clozeAnswer' in out).toBe(false)
    expect(out.needsAi).toBe(false)
  })

  it('種類を単語・熟語に変えて穴埋めが空で、出会った英文があれば、7-5 の決まりで作る（英語も変えたときは作らずに AI で補う）', () => {
    const w = manualWord({ term: 'take care of', context: 'take care of yourself', meaning: '世話をする' }, now)
    expect([w.kind, 'cloze' in w]).toEqual(['phrase', false])
    const out = applyEdit(w, { ...w, kind: 'word' }, now)
    expect([out.cloze, out.clozeAnswer]).toEqual(['___ ___ ___ yourself', 'take care of'])
    const renamed = applyEdit(w, { ...w, kind: 'word', term: 'take care' }, now)
    expect(['cloze' in renamed, 'clozeAnswer' in renamed, renamed.needsAi]).toEqual([false, false, true])
  })

  it('穴埋めの文と穴の答えの片方だけなら、両方を空にする', () => {
    const out = applyEdit(word(), { ...word(), clozeAnswer: '' }, now)
    expect('cloze' in out).toBe(false)
    expect('clozeAnswer' in out).toBe(false)
  })

  it('一覧は前後の空白と空の行を除く。空の任意の項目は項目ごと消す', () => {
    const out = applyEdit(
      word(),
      { ...word(), accepted: [' 諦める ', '', 'あきらめる'], acceptedEn: ['give up', '  '], note: ' ', exampleJa: '' },
      now,
    )
    expect(out.accepted).toEqual(['諦める', 'あきらめる'])
    expect(out.acceptedEn).toEqual(['give up'])
    expect('note' in out).toBe(false)
    expect('exampleJa' in out).toBe(false)
  })

  it('意味を変えたら、許容訳に入れる（許容訳には意味を必ず入れておく。7-2）', () => {
    const out = applyEdit(word(), { ...word(), meaning: '断念する' }, now)
    expect(out.accepted).toEqual(['諦める', 'あきらめる', '断念する'])
    const same = applyEdit(word(), { ...word(), meaning: 'アキラメル' }, now)
    expect(same.accepted).toEqual(['諦める', 'あきらめる'])
  })

  it('AI で補う前の印は、編集の画面の値ではなく元の語の値を使う', () => {
    const out = applyEdit(word({ needsAi: true }), { ...word(), needsAi: false, note: 'くだけた' }, now)
    expect(out.needsAi).toBe(true)
  })

  it('元の語は変えない', () => {
    const original = word()
    const copy = structuredClone(original)
    applyEdit(original, { ...original, term: 'give in', kind: 'phrase' }, now)
    expect(original).toEqual(copy)
  })
})

describe('sortWords（一覧の並び。仕様書 5-2）', () => {
  let n = 0
  function review(wordId: string, at: Date, verdict: Verdict): ReviewRecord {
    n += 1
    return {
      id: `r${n}`,
      cardId: `${wordId}:en-ja`,
      wordId,
      direction: 'en-ja',
      at,
      day: '2026-10-20',
      answer: '',
      verdict,
      judgedBy: 'local',
      rating: verdict === 'wrong' ? 1 : 3,
      thinkMs: 1000,
      totalMs: 2000,
      usedHint: false,
      appealed: false,
      practice: false,
      before: createEmptyCard(at),
    }
  }
  const a = word({ id: 'a', createdAt: new Date(2026, 9, 1) })
  const b = word({ id: 'b', createdAt: new Date(2026, 9, 2) })
  const c = word({ id: 'c', createdAt: new Date(2026, 9, 3) })
  const d = word({ id: 'd', createdAt: new Date(2026, 9, 4) })
  const words = [a, b, c, d]

  it('新しい順は登録の新しい順', () => {
    expect(sortWords(words, [], 'new').map((w) => w.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('最近まちがえた順は、最後に × になった時刻の新しい順。× になったことの無い語は後ろに登録の新しい順', () => {
    const reviews = [
      review('b', new Date(2026, 9, 19, 9), 'wrong'),
      review('a', new Date(2026, 9, 20, 9), 'wrong'),
      // b はその後に ○ になっても、最後に × になった時刻で並べる
      review('b', new Date(2026, 9, 21, 9), 'correct'),
      review('c', new Date(2026, 9, 21, 10), 'correct'),
      // 消した語の記録は無視する
      review('gone', new Date(2026, 9, 22, 9), 'wrong'),
    ]
    expect(sortWords(words, reviews, 'wrong').map((w) => w.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('最後に × になった時刻は、いちばん新しい × の時刻（記録の並びの順ではない）。△ は × に数えない', () => {
    const reviews = [
      review('a', new Date(2026, 9, 21, 9), 'wrong'),
      review('a', new Date(2026, 9, 10, 9), 'wrong'),
      review('b', new Date(2026, 9, 20, 9), 'wrong'),
      review('b', new Date(2026, 9, 22, 9), 'close'),
    ]
    expect(sortWords([a, b], reviews, 'wrong').map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('元の配列は変えない', () => {
    const list = [...words]
    sortWords(list, [], 'new')
    expect(list.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})
