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
// 判定の待ち時間の上限。T10 で測った返事の最大（約 1.5 秒）× 1.5 を 8〜20 秒に収めた値（仕様書 7-3・18-2）
export const JUDGE_TIMEOUT_MS = 8_000
export const FILL_TIMEOUT_MS = 25_000
// AI で補う・動作確認の呼ぶ間隔。AI Studio の 1 分 15 回から 60 ÷ 15 × 1.2 = 4.8 秒を切り上げた値（仕様書 8-4・18-1）
export const FILL_INTERVAL_MS = 5_000
export const SPEAK_RESTART_DELAY_MS = 250
export const SPEAK_START_TIMEOUT_MS = 1_500
// 読み上げの速さの選択肢（仕様書 10 章）。0.5〜2.0 の 0.1 刻み。iPhone では 2.0 が端末の最大の速さに当たる
export const VOICE_RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2] as const
