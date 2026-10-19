import type { Card } from 'ts-fsrs'

export type Verdict = 'correct' | 'close' | 'wrong'
export type Direction = 'en-ja' | 'ja-en'
export type JudgedBy = 'local' | 'ai' | 'self' | 'giveup'
export type Kind = 'word' | 'phrase'
export type RatingValue = 1 | 2 | 3 | 4

export interface Word {
  id: string
  term: string
  kind: Kind
  context?: string
  source?: string
  meaning: string
  tone?: string
  accepted: string[]
  nearMiss: string[]
  acceptedEn: string[]
  exampleEn?: string
  exampleJa?: string
  note?: string
  cloze?: string
  clozeAnswer?: string
  needsAi: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CardRecord {
  id: string // `${wordId}:${direction}`
  wordId: string
  direction: Direction
  card: Card
}

export interface ReviewRecord {
  id: string
  cardId: string
  wordId: string
  direction: Direction
  at: Date
  day: string
  answer: string
  verdict: Verdict
  judgedBy: JudgedBy
  rating: RatingValue
  thinkMs: number
  totalMs: number
  usedHint: boolean
  appealed: boolean
  practice: boolean
  before: Card
  aiReason?: string
}

export interface Settings {
  apiKey?: string
  model: string
  newWordsPerDay: number
  voiceRate: 1 | 0.8
  lastExportAt?: Date
  mutedNoticeShown: boolean
}

export interface PendingEntry {
  cardId: string
  reason: 'again' | 'step' | 'practice'
  seq: number
  afterAnswers?: number // again・practice
  dueAt?: Date // step
}

export interface SessionState {
  day: string
  answers: number
  seq: number
  pending: PendingEntry[]
  practiced: string[]
  extraNew: number // 「新しい問題を足す」で増やした新しい問題の上限（その日だけ。仕様書 6-9）
}

export interface BackupData {
  words: Word[]
  cards: CardRecord[]
  reviews: ReviewRecord[]
  settings: Omit<Settings, 'apiKey'>
}
