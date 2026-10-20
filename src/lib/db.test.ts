// fake-indexeddb は Dexie より先に読み込む（Dexie は読み込まれた時点の indexedDB を使うため）
import 'fake-indexeddb/auto'
import { State } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_NAME, DEFAULT_MODEL, DEFAULT_NEW_PER_DAY } from './config.ts'
import {
  addWord,
  addWords,
  cardsForWord,
  defaultSettings,
  deleteWord,
  EitangoDB,
  getSession,
  getSettings,
  loadAll,
  putWord,
  replaceAll,
  saveAnswer,
  saveSession,
  saveSettings,
  updateWord,
} from './db.ts'
import { newSession } from './session.ts'
import { newCard, reviewCard } from './srs.ts'
import type { BackupData, CardRecord, ReviewRecord, SessionState, Settings, Word } from './types.ts'

const created = new Date(2026, 9, 18, 12, 0)
const now = new Date(2026, 9, 20, 21, 0)

// テストごとに名前の違うデータベースを使い、終わったら消す（テストどうしが影響しないように）
let counter = 0
const opened: EitangoDB[] = []
function makeDb(): EitangoDB {
  counter += 1
  const db = new EitangoDB(`eitango-test-${counter}`)
  opened.push(db)
  return db
}
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

function word(id: string, over: Partial<Word> = {}): Word {
  return {
    id,
    term: 'give up',
    kind: 'word',
    context: "don't give up, we can still win",
    meaning: '諦める',
    accepted: ['諦める', 'あきらめる'],
    nearMiss: [],
    acceptedEn: ['give up'],
    needsAi: false,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

function review(id: string, card: CardRecord, over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id,
    cardId: card.id,
    wordId: card.wordId,
    direction: card.direction,
    at: now,
    day: '2026-10-20',
    answer: 'あきらめる',
    verdict: 'correct',
    judgedBy: 'local',
    rating: 3,
    thinkMs: 1200,
    totalMs: 3000,
    usedHint: false,
    appealed: false,
    practice: false,
    before: card.card,
    ...over,
  }
}

describe('EitangoDB', () => {
  it('名前の既定は eitango', () => {
    expect(new EitangoDB().name).toBe(DB_NAME)
  })

  it('4 つの入れ物と索引（仕様書 9-2）', async () => {
    const db = makeDb()
    await db.open()
    const schema = Object.fromEntries(
      db.tables.map((t) => [t.name, [t.schema.primKey.name, ...t.schema.indexes.map((i) => i.name)]]),
    )
    expect(schema).toEqual({
      words: ['id', 'createdAt'],
      cards: ['id', 'wordId'],
      reviews: ['id', 'cardId', 'wordId', 'day'],
      kv: ['key'],
    })
  })
})

describe('defaultSettings・cardsForWord', () => {
  it('設定の既定値', () => {
    expect(defaultSettings()).toEqual({
      model: DEFAULT_MODEL,
      newWordsPerDay: DEFAULT_NEW_PER_DAY,
      voiceRate: 1,
      mutedNoticeShown: false,
    })
  })

  it('cardsForWord は英→日・日→英の新しいカード 2 枚', () => {
    const cards = cardsForWord('w1', now)
    expect(cards.map((c) => [c.id, c.wordId, c.direction])).toEqual([
      ['w1:en-ja', 'w1', 'en-ja'],
      ['w1:ja-en', 'w1', 'ja-en'],
    ])
    for (const c of cards) {
      expect(c.card.state).toBe(State.New)
      expect(c.card.due.getTime()).toBe(now.getTime())
    }
  })
})

describe('語の保存', () => {
  it('addWord は語とカード 2 枚を作り、Date は Date のまま戻る', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    const all = await loadAll(db)
    expect(all.words).toEqual([word('w1')])
    expect(all.words[0].createdAt).toBeInstanceOf(Date)
    expect(all.cards.map((c) => c.id).sort()).toEqual(['w1:en-ja', 'w1:ja-en'])
    expect(all.cards[0].card.due).toBeInstanceOf(Date)
    expect(all.cards[0].card).toEqual(newCard(now))
    expect(all.reviews).toEqual([])
  })

  it('addWords はまとめて足す', async () => {
    const db = makeDb()
    await addWords(db, [word('w1'), word('w2', { term: 'nerf' })], now)
    const all = await loadAll(db)
    expect(all.words.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
    expect(all.cards).toHaveLength(4)
  })

  it('同じ id の語を addWord すると失敗し、カードも増えない', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await expect(addWord(db, word('w1'), now)).rejects.toThrow()
    expect(await db.cards.count()).toBe(2)
  })

  it('putWord は同じ id で上書きする', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await putWord(db, word('w1', { meaning: 'やめる', updatedAt: now }))
    const w = await db.words.get('w1')
    expect(w?.meaning).toBe('やめる')
    expect(w?.updatedAt).toEqual(now)
  })

  it('deleteWord は語とカード 2 枚と、その語の予定を消し、解答記録は残す', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await addWord(db, word('w2'), now)
    const [c1] = cardsForWord('w1', now)
    await saveAnswer(db, {
      card: c1,
      review: review('r1', c1),
      session: {
        ...newSession('2026-10-20'),
        seq: 3,
        pending: [
          { cardId: 'w1:en-ja', reason: 'again', seq: 0, afterAnswers: 4 },
          { cardId: 'w2:en-ja', reason: 'step', seq: 1, dueAt: now },
          { cardId: 'w1:ja-en', reason: 'step', seq: 2, dueAt: now },
        ],
      },
    })
    await deleteWord(db, 'w1')
    const all = await loadAll(db)
    expect(all.words.map((w) => w.id)).toEqual(['w2'])
    expect(all.cards.map((c) => c.id).sort()).toEqual(['w2:en-ja', 'w2:ja-en'])
    expect(all.reviews.map((r) => r.id)).toEqual(['r1'])
    expect((await getSession(db))?.pending.map((p) => p.cardId)).toEqual(['w2:en-ja'])
  })

  it('予定が無くても deleteWord できる', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await deleteWord(db, 'w1')
    expect(await db.words.count()).toBe(0)
    expect(await getSession(db)).toBeUndefined()
  })

  it('1 つのトランザクション: addWord でカードの書き込みに失敗したら、語も残らない', async () => {
    const db = makeDb()
    const [c] = cardsForWord('w9', now)
    await db.cards.add(c)
    await expect(addWord(db, word('w9'), now)).rejects.toThrow()
    expect(await db.words.count()).toBe(0)
  })

  it('1 つのトランザクション: deleteWord で予定を直すところで失敗したら、何も消えない', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await db.kv.put({ key: 'session', value: { ...newSession('2026-10-20'), pending: null } })
    await expect(deleteWord(db, 'w1')).rejects.toThrow()
    const all = await loadAll(db)
    expect(all.words.map((w) => w.id)).toEqual(['w1'])
    expect(all.cards.map((c) => c.id).sort()).toEqual(['w1:en-ja', 'w1:ja-en'])
  })
})

describe('updateWord（今の行を読んでから変える）', () => {
  it('消した語には書かず false を返し、語もカードも作り直さない', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await deleteWord(db, 'w1')
    expect(await updateWord(db, 'w1', (cur) => ({ ...cur, meaning: 'やめる' }))).toBe(false)
    const all = await loadAll(db)
    expect(all.words).toEqual([])
    expect(all.cards).toEqual([])
  })

  it('change は今の行に当たる（古い写しではなく、間に putWord した値）', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await putWord(db, word('w1', { meaning: 'やめる', updatedAt: now }))
    const seen: Word[] = []
    const ok = await updateWord(db, 'w1', (cur) => {
      seen.push(cur)
      return { ...cur, accepted: [...cur.accepted, '投げ出す'] }
    })
    expect(ok).toBe(true)
    expect(seen).toEqual([word('w1', { meaning: 'やめる', updatedAt: now })])
    expect(await db.words.get('w1')).toEqual(
      word('w1', { meaning: 'やめる', updatedAt: now, accepted: ['諦める', 'あきらめる', '投げ出す'] }),
    )
  })

  it('change が undefined を返したら書かずに false', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    expect(await updateWord(db, 'w1', () => undefined)).toBe(false)
    expect(await db.words.get('w1')).toEqual(word('w1'))
  })

  it('deleteWord と同時に走らせても、消した語を戻さない（読んでから書くまでが 1 つのトランザクション）', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), now)
    await Promise.all([
      updateWord(db, 'w1', (cur) => ({ ...cur, needsAi: false, updatedAt: now })),
      deleteWord(db, 'w1'),
    ])
    const all = await loadAll(db)
    expect(all.words).toEqual([])
    expect(all.cards).toEqual([])
  })
})

describe('saveAnswer', () => {
  function solved(): { card: CardRecord; before: CardRecord } {
    const [before] = cardsForWord('w1', created)
    return { before, card: { ...before, card: reviewCard(before.card, now, 3).card } }
  }

  it('カード・解答記録・予定・語を書き、Date は Date のまま戻る', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const { card, before } = solved()
    const session: SessionState = {
      ...newSession('2026-10-20'),
      answers: 1,
      seq: 1,
      pending: [{ cardId: card.id, reason: 'step', seq: 0, dueAt: card.card.due }],
    }
    await saveAnswer(db, {
      card,
      review: review('r1', before),
      session,
      wordChange: (cur) => ({ ...cur, accepted: [...cur.accepted, '投げ出す'], updatedAt: now }),
    })
    const all = await loadAll(db)
    const savedCard = all.cards.find((c) => c.id === card.id)
    expect(savedCard).toEqual(card)
    expect(savedCard?.card.last_review).toBeInstanceOf(Date)
    expect(all.reviews).toEqual([review('r1', before)])
    expect(all.reviews[0].at).toBeInstanceOf(Date)
    expect(all.reviews[0].before.due).toBeInstanceOf(Date)
    expect(all.words[0].accepted).toEqual(['諦める', 'あきらめる', '投げ出す'])
    const s = await getSession(db)
    expect(s).toEqual(session)
    expect(s?.pending[0].dueAt).toBeInstanceOf(Date)
  })

  it('wordChange を渡さなければ語は書かず、undefined を返す', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const { card, before } = solved()
    const got = await saveAnswer(db, { card, review: review('r1', before), session: newSession('2026-10-20') })
    expect(got).toBeUndefined()
    expect(await db.words.get('w1')).toEqual(word('w1'))
  })

  it('語の行が無ければ wordChange を当てずに undefined を返す（カードと解答記録は書く）', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const { card, before } = solved()
    await deleteWord(db, 'w1')
    const got = await saveAnswer(db, {
      card,
      review: review('r1', before),
      session: newSession('2026-10-20'),
      wordChange: (cur) => ({ ...cur, accepted: [...cur.accepted, '投げ出す'] }),
    })
    expect(got).toBeUndefined()
    const all = await loadAll(db)
    expect(all.words).toEqual([])
    expect(all.reviews.map((r) => r.id)).toEqual(['r1'])
  })

  it('wordChange は今の行に当たる（前に putWord した値に当てて書き、その語を返す）', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    await putWord(db, word('w1', { meaning: 'やめる', updatedAt: now }))
    const { card, before } = solved()
    const got = await saveAnswer(db, {
      card,
      review: review('r1', before),
      session: newSession('2026-10-20'),
      wordChange: (cur) => ({ ...cur, accepted: [...cur.accepted, '投げ出す'] }),
    })
    const expected = word('w1', { meaning: 'やめる', updatedAt: now, accepted: ['諦める', 'あきらめる', '投げ出す'] })
    expect(got).toEqual(expected)
    expect(await db.words.get('w1')).toEqual(expected)
  })

  it('判定を直したときは、同じ解答記録の id で上書きする', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const { card, before } = solved()
    const session = newSession('2026-10-20')
    await saveAnswer(db, { card, review: review('r1', before, { verdict: 'close', rating: 2 }), session })
    await saveAnswer(db, {
      card,
      review: review('r1', before, { verdict: 'correct', rating: 3, appealed: true }),
      session,
    })
    const all = await loadAll(db)
    expect(all.reviews).toHaveLength(1)
    expect(all.reviews[0]).toMatchObject({ id: 'r1', verdict: 'correct', rating: 3, appealed: true })
  })

  it('1 つのトランザクション: 途中で失敗したら、カードも予定も書かない', async () => {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const { card, before } = solved()
    // 保存できない値（関数）を入れた解答記録で、書き込みを失敗させる
    const bad = review('r1', before, { answer: (() => 'x') as unknown as string })
    const session: SessionState = { ...newSession('2026-10-20'), answers: 1 }
    await expect(saveAnswer(db, { card, review: bad, session })).rejects.toThrow()
    const all = await loadAll(db)
    expect(all.cards.find((c) => c.id === card.id)?.card).toEqual(before.card)
    expect(all.reviews).toEqual([])
    expect(await getSession(db)).toBeUndefined()
  })
})

describe('設定と予定', () => {
  it('何も保存していなければ、getSettings は既定値', async () => {
    expect(await getSettings(makeDb())).toEqual(defaultSettings())
  })

  it('saveSettings した値を getSettings で読む（lastExportAt は Date のまま）', async () => {
    const db = makeDb()
    const s: Settings = {
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      newWordsPerDay: 7,
      voiceRate: 0.8,
      lastExportAt: now,
      mutedNoticeShown: true,
    }
    await saveSettings(db, s)
    const got = await getSettings(db)
    expect(got).toEqual(s)
    expect(got.lastExportAt).toBeInstanceOf(Date)
  })

  it('保存した設定に無い項目は既定値で埋める', async () => {
    const db = makeDb()
    await db.kv.put({ key: 'settings', value: { model: 'gemini-3.8-flash' } })
    expect(await getSettings(db)).toEqual({ ...defaultSettings(), model: 'gemini-3.8-flash' })
  })

  it('予定は保存していなければ undefined、保存すれば同じものが戻る', async () => {
    const db = makeDb()
    expect(await getSession(db)).toBeUndefined()
    const s: SessionState = {
      day: '2026-10-20',
      answers: 2,
      seq: 2,
      pending: [{ cardId: 'w1:en-ja', reason: 'step', seq: 1, dueAt: now }],
      practiced: ['w2:en-ja'],
      extraNew: 5,
    }
    await saveSession(db, s)
    expect(await getSession(db)).toEqual(s)
  })
})

describe('replaceAll（バックアップから戻す。仕様書 9-3）', () => {
  function backup(): BackupData {
    const w = word('b1', { term: 'nerf', meaning: '弱くする', accepted: ['弱くする'] })
    const cards = cardsForWord('b1', created)
    return {
      words: [w],
      cards,
      reviews: [review('br1', cards[0])],
      settings: {
        model: 'gemini-3.8-flash',
        newWordsPerDay: 3,
        voiceRate: 0.8,
        lastExportAt: now,
        mutedNoticeShown: true,
      },
    }
  }

  async function filled(): Promise<EitangoDB> {
    const db = makeDb()
    await addWord(db, word('w1'), created)
    const [c] = cardsForWord('w1', created)
    await saveAnswer(db, {
      card: c,
      review: review('r1', c),
      session: { ...newSession('2026-10-20'), pending: [{ cardId: c.id, reason: 'again', seq: 0, afterAnswers: 3 }] },
    })
    await saveSettings(db, { ...defaultSettings(), apiKey: 'old-key' })
    return db
  }

  it('今のデータを全部置き換え、キーは残し、予定は捨てる', async () => {
    const db = await filled()
    await replaceAll(db, backup(), 'old-key')
    const all = await loadAll(db)
    expect(all.words).toEqual(backup().words)
    expect(all.cards).toEqual(backup().cards)
    expect(all.reviews).toEqual(backup().reviews)
    expect(await getSettings(db)).toEqual({ ...backup().settings, apiKey: 'old-key' })
    expect(await getSession(db)).toBeUndefined()
  })

  it('キーが無ければ、設定にキーを入れない', async () => {
    const db = await filled()
    await replaceAll(db, backup(), undefined)
    const s = await getSettings(db)
    expect(s.apiKey).toBeUndefined()
    expect('apiKey' in s).toBe(false)
  })

  it('途中で失敗したら、何も変えない', async () => {
    const db = await filled()
    const bad = backup()
    bad.reviews[0] = { ...bad.reviews[0], answer: (() => 'x') as unknown as string }
    await expect(replaceAll(db, bad, 'old-key')).rejects.toThrow()
    const all = await loadAll(db)
    expect(all.words.map((w) => w.id)).toEqual(['w1'])
    expect(all.reviews.map((r) => r.id)).toEqual(['r1'])
    expect((await getSettings(db)).apiKey).toBe('old-key')
    expect(await getSession(db)).toBeDefined()
  })
})
