// 書き出し・読み込みの JSON（仕様書 9-3）
import type { Card } from 'ts-fsrs'
import { EXPORT_REMIND_DAYS, VOICE_RATES } from './config.ts'
import { dayDiff, dayOf } from './day.ts'
import { reviveCard } from './srs.ts'
import type { BackupData, CardRecord, ReviewRecord, Settings, Word } from './types.ts'

const APP = 'eitango'
const VERSION = 1

export function toBackupJson(data: BackupData, now: Date): string {
  // キーは書き出しに入れない（渡した設定に入っていても、項目を選んで写す）
  const s = data.settings
  const settings: Omit<Settings, 'apiKey'> = {
    model: s.model,
    newWordsPerDay: s.newWordsPerDay,
    voiceRate: s.voiceRate,
    mutedNoticeShown: s.mutedNoticeShown,
  }
  if (s.lastExportAt !== undefined) settings.lastExportAt = s.lastExportAt
  return JSON.stringify({
    app: APP,
    version: VERSION,
    exportedAt: now.toISOString(),
    words: data.words,
    cards: data.cards,
    reviews: data.reviews,
    settings,
  })
}

export type ParseBackupResult = { ok: true; data: BackupData } | { ok: false; error: string }

// 形式の誤り。message は「何番目のどの項目が違うか」
class FormatError extends Error {}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// where は「words の 3 番目」「settings」など
function obj(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new FormatError(`${where}が正しい形ではありません`)
  return v
}

function str(o: Obj, key: string, where: string): string {
  const v = o[key]
  if (typeof v !== 'string') throw new FormatError(`${where}の ${key} が文字列ではありません`)
  return v
}

function id(o: Obj, key: string, where: string): string {
  const v = str(o, key, where)
  if (v === '') throw new FormatError(`${where}の ${key} が空です`)
  return v
}

function num(o: Obj, key: string, where: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new FormatError(`${where}の ${key} が数ではありません`)
  return v
}

function bool(o: Obj, key: string, where: string): boolean {
  const v = o[key]
  if (typeof v !== 'boolean') throw new FormatError(`${where}の ${key} が true か false ではありません`)
  return v
}

function strList(o: Obj, key: string, where: string): string[] {
  const v = o[key]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new FormatError(`${where}の ${key} が文字列の配列ではありません`)
  }
  return [...v]
}

function toDate(v: unknown, key: string, where: string): Date {
  const d = typeof v === 'string' ? new Date(v) : undefined
  if (!d || Number.isNaN(d.getTime())) throw new FormatError(`${where}の ${key} が日時ではありません`)
  return d
}

function date(o: Obj, key: string, where: string): Date {
  return toDate(o[key], key, where)
}

function oneOf<T>(o: Obj, key: string, where: string, values: readonly T[]): T {
  const v = o[key]
  if (!values.includes(v as T)) throw new FormatError(`${where}の ${key} が違います（${String(v)}）`)
  return v as T
}

function card(o: Obj, key: string, where: string): Card {
  try {
    return reviveCard(o[key])
  } catch (e) {
    throw new FormatError(`${where}の ${key}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// 任意の文字列の項目。無い（undefined・null）なら写さない
function copyOptStr<T extends object>(target: T, o: Obj, keys: readonly (keyof T & string)[], where: string): void {
  const t = target as Obj
  for (const key of keys) {
    if (o[key] === undefined || o[key] === null) continue
    t[key] = str(o, key, where)
  }
}

function list(root: Obj, key: string): unknown[] {
  const v = root[key]
  if (!Array.isArray(v)) throw new FormatError(`${key} が配列ではありません`)
  return v
}

const KINDS = ['word', 'phrase'] as const
const DIRECTIONS = ['en-ja', 'ja-en'] as const
const VERDICTS = ['correct', 'close', 'wrong'] as const
const JUDGED_BY = ['local', 'ai', 'self', 'giveup'] as const
const RATINGS = [1, 2, 3, 4] as const

function readWord(v: unknown, where: string): Word {
  const o = obj(v, where)
  const word: Word = {
    id: id(o, 'id', where),
    term: str(o, 'term', where),
    kind: oneOf(o, 'kind', where, KINDS),
    meaning: str(o, 'meaning', where),
    accepted: strList(o, 'accepted', where),
    nearMiss: strList(o, 'nearMiss', where),
    acceptedEn: strList(o, 'acceptedEn', where),
    needsAi: bool(o, 'needsAi', where),
    createdAt: date(o, 'createdAt', where),
    updatedAt: date(o, 'updatedAt', where),
  }
  copyOptStr(
    word,
    o,
    ['context', 'source', 'tone', 'exampleEn', 'exampleJa', 'note', 'cloze', 'clozeAnswer'],
    where,
  )
  return word
}

function readCard(v: unknown, where: string): CardRecord {
  const o = obj(v, where)
  return {
    id: id(o, 'id', where),
    wordId: id(o, 'wordId', where),
    direction: oneOf(o, 'direction', where, DIRECTIONS),
    card: card(o, 'card', where),
  }
}

function readReview(v: unknown, where: string): ReviewRecord {
  const o = obj(v, where)
  const day = str(o, 'day', where)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new FormatError(`${where}の day が YYYY-MM-DD ではありません`)
  const review: ReviewRecord = {
    id: id(o, 'id', where),
    cardId: id(o, 'cardId', where),
    wordId: id(o, 'wordId', where),
    direction: oneOf(o, 'direction', where, DIRECTIONS),
    at: date(o, 'at', where),
    day,
    answer: str(o, 'answer', where),
    verdict: oneOf(o, 'verdict', where, VERDICTS),
    judgedBy: oneOf(o, 'judgedBy', where, JUDGED_BY),
    rating: oneOf(o, 'rating', where, RATINGS),
    thinkMs: num(o, 'thinkMs', where),
    totalMs: num(o, 'totalMs', where),
    usedHint: bool(o, 'usedHint', where),
    appealed: bool(o, 'appealed', where),
    practice: bool(o, 'practice', where),
    before: card(o, 'before', where),
  }
  copyOptStr(review, o, ['aiReason'], where)
  return review
}

function readSettings(v: unknown): Omit<Settings, 'apiKey'> {
  // 「settings の voiceRate」のように英字の後ろに空白を入れる
  const where = 'settings '
  const o = obj(v, where)
  const settings: Omit<Settings, 'apiKey'> = {
    model: str(o, 'model', where),
    newWordsPerDay: num(o, 'newWordsPerDay', where),
    voiceRate: oneOf(o, 'voiceRate', where, VOICE_RATES),
    mutedNoticeShown: bool(o, 'mutedNoticeShown', where),
  }
  if (o.lastExportAt !== undefined && o.lastExportAt !== null) {
    settings.lastExportAt = date(o, 'lastExportAt', where)
  }
  return settings
}

// 日時を Date に戻す。エラーは「何番目のどの項目が違うか」を日本語で
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'JSON として読めませんでした' }
  }
  try {
    const root = obj(raw, 'ファイル')
    if (root.app !== APP) return { ok: false, error: 'eitango の書き出しではありません' }
    if (root.version !== VERSION) {
      return { ok: false, error: `この版（version ${String(root.version)}）の書き出しは読めません` }
    }
    const data: BackupData = {
      words: list(root, 'words').map((v, i) => readWord(v, `words の ${i + 1} 番目`)),
      cards: list(root, 'cards').map((v, i) => readCard(v, `cards の ${i + 1} 番目`)),
      reviews: list(root, 'reviews').map((v, i) => readReview(v, `reviews の ${i + 1} 番目`)),
      settings: readSettings(root.settings),
    }
    return { ok: true, data }
  } catch (e) {
    if (e instanceof FormatError) return { ok: false, error: e.message }
    throw e
  }
}

// 学習の始める前の画面に「書き出し」を知らせるか。最後の書き出しからアプリの日で 7 日たったら知らせる。
// 一度も書き出していなければ、最初の語を登録した日から数える。語が無ければ知らせない（仕様書 9-3）
export function exportReminderDue(lastExportAt: Date | undefined, words: readonly Word[], now: Date): boolean {
  let from = lastExportAt
  if (from === undefined) {
    for (const w of words) if (from === undefined || w.createdAt.getTime() < from.getTime()) from = w.createdAt
  }
  if (from === undefined) return false
  return dayDiff(dayOf(from), dayOf(now)) >= EXPORT_REMIND_DAYS
}
