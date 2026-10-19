export const DAY_START_HOUR = 4
export const REVIEW_CAP_FOR_NEW = 80
export const SLOW_THINK_MS = 10_000
export const AGAIN_AFTER_ANSWERS = 3
export const PRACTICE_AFTER_ANSWERS = 5
export const LEARN_AHEAD_MS = 20 * 60_000
export const SECONDS_PER_CARD = 20
export const NEW_CARD_FACTOR = 2.6
export const DEFAULT_NEW_PER_DAY = 5
export const EXPORT_REMIND_DAYS = 7
export const AHEAD_PER_PRESS = 10 // 「先取りで復習する」を 1 回押して足す枚数（仕様書 6-9）
export const DB_NAME = 'eitango'
export const CHECK_DB_NAME = 'eitango-check'
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
export interface ModelInfo {
  id: string
  label: string
  thinkingLevel?: string
}
export const MODELS: readonly ModelInfo[] = [
  { id: 'gemini-3.5-flash-lite', label: '3.5 Flash-Lite（既定）' },
  { id: 'gemini-3.8-flash', label: '3.8 Flash（予備）', thinkingLevel: 'LOW' },
]
export const JUDGE_TIMEOUT_MS = 12_000
export const FILL_TIMEOUT_MS = 25_000
export const FILL_INTERVAL_MS = 4_000
export const SPEAK_RESTART_DELAY_MS = 250
export const SPEAK_START_TIMEOUT_MS = 1_500
