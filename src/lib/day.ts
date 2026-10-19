// アプリの日（朝 4 時で区切る。仕様書 6-1）
// 端末の時計の get 系の関数で計算し、toISOString()（世界標準時の日付）は使わない
import { DAY_START_HOUR } from './config.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// t から 4 時間引いた時刻
function shifted(t: Date): Date {
  return new Date(t.getTime() - DAY_START_HOUR * HOUR_MS)
}

// t のアプリの日（YYYY-MM-DD）
export function dayOf(t: Date): string {
  const s = shifted(t)
  return `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`
}

// t のアプリの日の朝 4 時
export function startOfDay(t: Date): Date {
  const s = shifted(t)
  return new Date(s.getFullYear(), s.getMonth(), s.getDate(), DAY_START_HOUR)
}

// t のアプリの日の次の朝 4 時
export function endOfDay(t: Date): Date {
  const s = shifted(t)
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, DAY_START_HOUR)
}

function parseDay(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) throw new Error(`日付の形式が違います: ${day}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// YYYY-MM-DD どうしの日数の差（to − from）
export function dayDiff(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS)
}

// 端末の時計での YYYY-MM-DD HH:mm（設定の版の 1 行・最後の書き出しの日時に使う。toISOString は使わない）
export function formatDateTime(t: Date): string {
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`
}
