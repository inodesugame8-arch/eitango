import { describe, expect, it } from 'vitest'
import { exportReminderDue, parseBackup, toBackupJson } from './backup.ts'
import { newCard, reviewCard } from './srs.ts'
import type { BackupData, CardRecord, ReviewRecord, Settings, Word } from './types.ts'

const created = new Date(2026, 9, 18, 12, 0)
const t1 = new Date(2026, 9, 18, 21, 0)
const t2 = new Date(2026, 9, 20, 22, 30)
const exportedAt = new Date(2026, 9, 21, 7, 15)

function data(): BackupData {
  const word: Word = {
    id: 'w1',
    term: 'give up',
    kind: 'word',
    context: "don't give up, we can still win",
    source: 'ゲーム',
    meaning: '諦める',
    tone: 'ふつう',
    accepted: ['諦める', 'あきらめる'],
    nearMiss: ['負ける'],
    acceptedEn: ['give up', 'quit'],
    exampleEn: 'Never give up.',
    exampleJa: '決して諦めるな。',
    note: '',
    cloze: "don't ___ ___, we can still win",
    clozeAnswer: 'give up',
    needsAi: false,
    createdAt: created,
    updatedAt: t2,
  }
  const plain: Word = {
    id: 'w2',
    term: 'nerf',
    kind: 'word',
    meaning: '弱くする',
    accepted: ['弱くする'],
    nearMiss: [],
    acceptedEn: ['nerf'],
    needsAi: true,
    createdAt: created,
    updatedAt: created,
  }
  const first = reviewCard(newCard(created), t1, 3).card
  const second = reviewCard(first, t2, 3).card
  const cards: CardRecord[] = [
    { id: 'w1:en-ja', wordId: 'w1', direction: 'en-ja', card: second },
    { id: 'w1:ja-en', wordId: 'w1', direction: 'ja-en', card: newCard(created) },
    { id: 'w2:en-ja', wordId: 'w2', direction: 'en-ja', card: newCard(created) },
    { id: 'w2:ja-en', wordId: 'w2', direction: 'ja-en', card: newCard(created) },
  ]
  const reviews: ReviewRecord[] = [
    {
      id: 'r1',
      cardId: 'w1:en-ja',
      wordId: 'w1',
      direction: 'en-ja',
      at: t2,
      day: '2026-10-20',
      answer: 'あきらめる',
      verdict: 'correct',
      judgedBy: 'ai',
      rating: 3,
      thinkMs: 1500,
      totalMs: 4200,
      usedHint: false,
      appealed: false,
      practice: false,
      before: first,
      aiReason: '意味が合う',
    },
  ]
  const settings: Omit<Settings, 'apiKey'> = {
    model: 'gemini-3.5-flash-lite',
    newWordsPerDay: 5,
    voiceRate: 1.5, // 1.0・0.8 のほかの速さも書き出して読み込めるか（2026-10-20 に 0.5〜2.0 倍へ広げた）
    lastExportAt: t1,
    mutedNoticeShown: true,
  }
  return { words: [word, plain], cards, reviews, settings }
}

function parseOk(text: string): BackupData {
  const r = parseBackup(text)
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function errorOf(text: string): string {
  const r = parseBackup(text)
  if (r.ok) throw new Error('読めてしまった')
  return r.error
}

// 書き出しの JSON を一部だけ書き換える
function edited(change: (obj: Record<string, any>) => void): string {
  const obj = JSON.parse(toBackupJson(data(), exportedAt))
  change(obj)
  return JSON.stringify(obj)
}

describe('toBackupJson（仕様書 9-3 の形式）', () => {
  it('{ app, version, exportedAt, words, cards, reviews, settings } で、日時は ISO 形式の文字列', () => {
    const obj = JSON.parse(toBackupJson(data(), exportedAt))
    expect(Object.keys(obj)).toEqual(['app', 'version', 'exportedAt', 'words', 'cards', 'reviews', 'settings'])
    expect(obj.app).toBe('eitango')
    expect(obj.version).toBe(1)
    expect(obj.exportedAt).toBe(exportedAt.toISOString())
    expect(obj.words[0].createdAt).toBe(created.toISOString())
    expect(obj.cards[0].card.due).toBe(data().cards[0].card.due.toISOString())
    expect(obj.reviews[0].at).toBe(t2.toISOString())
    expect(obj.settings.lastExportAt).toBe(t1.toISOString())
  })

  it('Gemini のキーは書き出しに入れない（渡した設定にあっても）', () => {
    const d = data()
    const withKey = { ...d, settings: { ...d.settings, apiKey: 'secret-key-123' } as Settings }
    const text = toBackupJson(withKey, exportedAt)
    expect(text).not.toContain('secret-key-123')
    expect(text).not.toContain('apiKey')
  })
})

describe('parseBackup', () => {
  it('書き出した JSON を読むと元に戻り、日時は Date に戻る', () => {
    const back = parseOk(toBackupJson(data(), exportedAt))
    expect(back).toEqual(data())
    expect(back.words[0].createdAt).toBeInstanceOf(Date)
    expect(back.words[0].updatedAt).toBeInstanceOf(Date)
    expect(back.cards[0].card.due).toBeInstanceOf(Date)
    expect(back.cards[0].card.last_review).toBeInstanceOf(Date)
    expect(back.reviews[0].at).toBeInstanceOf(Date)
    expect(back.reviews[0].before.due).toBeInstanceOf(Date)
    expect(back.reviews[0].before.last_review).toBeInstanceOf(Date)
    expect(back.settings.lastExportAt).toBeInstanceOf(Date)
  })

  it('任意の項目が無い語は、無いまま戻る', () => {
    const back = parseOk(toBackupJson(data(), exportedAt))
    expect(Object.keys(back.words[1]).sort()).toEqual(
      ['acceptedEn', 'accepted', 'createdAt', 'id', 'kind', 'meaning', 'nearMiss', 'needsAi', 'term', 'updatedAt'].sort(),
    )
    expect('lastExportAt' in parseOk(edited((o) => delete o.settings.lastExportAt)).settings).toBe(false)
  })

  it('JSON として読めなければエラー', () => {
    expect(errorOf('{ app: ')).toContain('JSON')
  })

  it('app が eitango でなければ読まない', () => {
    expect(errorOf(edited((o) => (o.app = 'diary')))).toContain('eitango')
  })

  it('version が知っている版（1）でなければ読まない', () => {
    expect(errorOf(edited((o) => (o.version = 2)))).toContain('version')
  })

  it('項目が違えば、何番目のどの項目かを日本語で返す', () => {
    expect(errorOf(edited((o) => delete o.words[1].term))).toBe('words の 2 番目の term が文字列ではありません')
    expect(errorOf(edited((o) => (o.words[0].kind = 'noun')))).toBe('words の 1 番目の kind が違います（noun）')
    expect(errorOf(edited((o) => (o.words[0].accepted = '諦める')))).toBe(
      'words の 1 番目の accepted が文字列の配列ではありません',
    )
    expect(errorOf(edited((o) => (o.words[1].createdAt = 'きのう')))).toBe(
      'words の 2 番目の createdAt が日時ではありません',
    )
    expect(errorOf(edited((o) => (o.cards[2].card.due = 'あした')))).toBe(
      'cards の 3 番目の card: カードの due が日時ではありません',
    )
    expect(errorOf(edited((o) => (o.reviews[0].rating = 5)))).toBe('reviews の 1 番目の rating が違います（5）')
    expect(errorOf(edited((o) => (o.reviews[0].before.stability = 'x')))).toBe(
      'reviews の 1 番目の before: カードの stability が数ではありません',
    )
    expect(errorOf(edited((o) => (o.reviews[0].day = '2026/10/20')))).toBe(
      'reviews の 1 番目の day が YYYY-MM-DD ではありません',
    )
    expect(errorOf(edited((o) => (o.settings.voiceRate = 2.1)))).toBe('settings の voiceRate が違います（2.1）')
    expect(errorOf(edited((o) => (o.reviews = {})))).toBe('reviews が配列ではありません')
  })

  it('読み込むファイルにキーがあっても読まない', () => {
    const back = parseOk(edited((o) => (o.settings.apiKey = 'leaked')))
    expect('apiKey' in back.settings).toBe(false)
  })
})

describe('exportReminderDue（最後の書き出しからアプリの日で 7 日。仕様書 9-3）', () => {
  function wordAt(id: string, createdAt: Date): Word {
    return {
      id,
      term: id,
      kind: 'word',
      meaning: id,
      accepted: [id],
      nearMiss: [],
      acceptedEn: [id],
      needsAi: false,
      createdAt,
      updatedAt: createdAt,
    }
  }
  const words = [wordAt('a', new Date(2026, 9, 1, 12)), wordAt('b', new Date(2026, 8, 30, 12))]

  it('最後の書き出しから 6 日なら知らせず、7 日なら知らせる', () => {
    const last = new Date(2026, 9, 12, 21, 0)
    expect(exportReminderDue(last, words, new Date(2026, 9, 18, 23, 0))).toBe(false)
    expect(exportReminderDue(last, words, new Date(2026, 9, 19, 4, 0))).toBe(true)
  })

  it('日はアプリの日（朝 4 時区切り）で数える', () => {
    // 10 月 13 日 3 時 59 分の書き出しは、アプリの日では 10 月 12 日
    const last = new Date(2026, 9, 13, 3, 59)
    expect(exportReminderDue(last, words, new Date(2026, 9, 19, 4, 0))).toBe(true)
    expect(exportReminderDue(last, words, new Date(2026, 9, 19, 3, 59))).toBe(false)
  })

  it('一度も書き出していなければ、最初の語を登録した日から数える', () => {
    expect(exportReminderDue(undefined, words, new Date(2026, 9, 6, 12))).toBe(false)
    expect(exportReminderDue(undefined, words, new Date(2026, 9, 7, 12))).toBe(true)
  })

  it('語が 1 つも無く、書き出してもいなければ知らせない', () => {
    expect(exportReminderDue(undefined, [], new Date(2026, 9, 30, 12))).toBe(false)
  })
})
