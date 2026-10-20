// Dexie での保存（仕様書 9-2）。入れ物や索引を変えるときは version() を 1 つ上げて足す
import Dexie, { type EntityTable } from 'dexie'
import { DB_NAME, DEFAULT_MODEL, DEFAULT_NEW_PER_DAY } from './config.ts'
import { removeCard } from './session.ts'
import { newCard } from './srs.ts'
import type { BackupData, CardRecord, ReviewRecord, SessionState, Settings, Word } from './types.ts'

export interface KvRow {
  key: string
  value: unknown
}

const SETTINGS_KEY = 'settings'
const SESSION_KEY = 'session'

export class EitangoDB extends Dexie {
  words!: EntityTable<Word, 'id'>
  cards!: EntityTable<CardRecord, 'id'>
  reviews!: EntityTable<ReviewRecord, 'id'>
  kv!: EntityTable<KvRow, 'key'>

  constructor(name: string = DB_NAME) {
    super(name)
    this.version(1).stores({
      words: 'id, createdAt',
      cards: 'id, wordId',
      reviews: 'id, cardId, wordId, day',
      kv: 'key',
    })
  }
}

export function defaultSettings(): Settings {
  return {
    model: DEFAULT_MODEL,
    newWordsPerDay: DEFAULT_NEW_PER_DAY,
    voiceRate: 1,
    mutedNoticeShown: false,
  }
}

// 1 語につき英→日・日→英の 2 枚
export function cardsForWord(wordId: string, now: Date): CardRecord[] {
  return (['en-ja', 'ja-en'] as const).map((direction) => ({
    id: `${wordId}:${direction}`,
    wordId,
    direction,
    card: newCard(now),
  }))
}

export async function loadAll(
  db: EitangoDB,
): Promise<{ words: Word[]; cards: CardRecord[]; reviews: ReviewRecord[] }> {
  return db.transaction('r', db.words, db.cards, db.reviews, async () => {
    const [words, cards, reviews] = await Promise.all([
      db.words.toArray(),
      db.cards.toArray(),
      db.reviews.toArray(),
    ])
    return { words, cards, reviews }
  })
}

// 語とカード 2 枚を 1 つのトランザクションで
export async function addWord(db: EitangoDB, word: Word, now: Date): Promise<void> {
  await addWords(db, [word], now)
}

export async function addWords(db: EitangoDB, words: readonly Word[], now: Date): Promise<void> {
  await db.transaction('rw', db.words, db.cards, async () => {
    await db.words.bulkAdd([...words])
    await db.cards.bulkAdd(words.flatMap((w) => cardsForWord(w.id, now)))
  })
}

export async function putWord(db: EitangoDB, word: Word): Promise<void> {
  await db.words.put(word)
}

// 今の行を読んでから変えて書く（1 つのトランザクション）。AI で補う途中や編集の途中に一覧で消した語・直した語を、
// 押した時点の古い写しで丸ごと上書きしない（消した語をカード無しで戻さない）ための口。
// 行が無い、または change が undefined を返したら書かずに false
export async function updateWord(
  db: EitangoDB,
  id: string,
  change: (cur: Word) => Word | undefined,
): Promise<boolean> {
  return db.transaction('rw', db.words, async () => {
    const cur = await db.words.get(id)
    if (!cur) return false
    const next = change(cur)
    if (next === undefined) return false
    await db.words.put(next)
    return true
  })
}

// 語とカード 2 枚と、その語のもう一度出す予定を消す。解答記録は残す（仕様書 9-4）
export async function deleteWord(db: EitangoDB, wordId: string): Promise<void> {
  await db.transaction('rw', db.words, db.cards, db.kv, async () => {
    const cardIds = (await db.cards.where('wordId').equals(wordId).primaryKeys()) as string[]
    await db.words.delete(wordId)
    await db.cards.bulkDelete(cardIds)
    const row = await db.kv.get(SESSION_KEY)
    if (row) {
      let session = row.value as SessionState
      for (const id of cardIds) session = removeCard(session, id)
      await db.kv.put({ key: SESSION_KEY, value: session })
    }
  })
}

// カード・解答記録・予定（・語）を 1 つのトランザクションで書く。判定を直したときも同じ id で上書き。
// 語は wordChange を今の行に当てて書き、その語を返す（学習を始めたときの古い写しで、AI で補った内容を消さないため）。
// wordChange が無い、または語の行が無ければ、語は書かずに undefined
export async function saveAnswer(
  db: EitangoDB,
  args: { card: CardRecord; review: ReviewRecord; session: SessionState; wordChange?: (cur: Word) => Word },
): Promise<Word | undefined> {
  const { card, review, session, wordChange } = args
  return db.transaction('rw', db.cards, db.reviews, db.kv, db.words, async () => {
    await db.cards.put(card)
    await db.reviews.put(review)
    await db.kv.put({ key: SESSION_KEY, value: session })
    if (!wordChange) return undefined
    const cur = await db.words.get(card.wordId)
    if (!cur) return undefined
    const next = wordChange(cur)
    await db.words.put(next)
    return next
  })
}

// 保存した設定に無い項目は既定値で埋める
export async function getSettings(db: EitangoDB): Promise<Settings> {
  const row = await db.kv.get(SETTINGS_KEY)
  return { ...defaultSettings(), ...(row?.value as Partial<Settings> | undefined) }
}

export async function saveSettings(db: EitangoDB, settings: Settings): Promise<void> {
  await db.kv.put({ key: SETTINGS_KEY, value: settings })
}

export async function getSession(db: EitangoDB): Promise<SessionState | undefined> {
  const row = await db.kv.get(SESSION_KEY)
  return row?.value as SessionState | undefined
}

export async function saveSession(db: EitangoDB, session: SessionState): Promise<void> {
  await db.kv.put({ key: SESSION_KEY, value: session })
}

// バックアップから戻す。全部を 1 つのトランザクションで置き換え、今の端末のキーは残し、予定は捨てる（仕様書 9-3）
export async function replaceAll(
  db: EitangoDB,
  data: BackupData,
  keepApiKey: string | undefined,
): Promise<void> {
  const settings: Settings = keepApiKey === undefined ? { ...data.settings } : { ...data.settings, apiKey: keepApiKey }
  await db.transaction('rw', db.words, db.cards, db.reviews, db.kv, async () => {
    await Promise.all([db.words.clear(), db.cards.clear(), db.reviews.clear(), db.kv.clear()])
    await db.words.bulkAdd(data.words)
    await db.cards.bulkAdd(data.cards)
    await db.reviews.bulkAdd(data.reviews)
    await db.kv.put({ key: SETTINGS_KEY, value: settings })
  })
}
