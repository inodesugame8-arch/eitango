// 学習の画面の状態（start → question →（judging）→ answer または self → answer → question … ）
import type { CardRecord, Direction, JudgedBy, RatingValue, SessionState, Verdict, Word } from '../../lib/types.ts'

// 問題の 4 通り（仕様書 5-1 の表）: 英→日・日→英の穴埋め・日→英（穴埋めの文が無い単語・熟語）・日→英のフレーズ
export type QuestionMode = 'en-ja' | 'cloze' | 'ja-en' | 'phrase'

// 進み具合（左 = この日に答えた回数、右 = それに今日の並びと、もう一度出す予定に残っている数を足したもの）
export interface Progress {
  done: number
  total: number
}

export interface Question {
  cardId: string
  practice: boolean // △ の練習（FSRS に渡さない）
  record: CardRecord // 解く前のカード
  word: Word
  direction: Direction
  mode: QuestionMode
  scramble: string[] // 並べ替えヒントの語（フレーズの日→英で 2 語以上のときだけ。それ以外は空）
  shownAt: number // 問題が出た時刻（ミリ秒）
}

export interface Attempt {
  q: Question
  answer: string // わからないのときは空文字
  at: Date // 解いた時刻（判定を直すときもこの時刻で付け直す）
  thinkMs: number
  totalMs: number
  usedHint: boolean
}

export interface Result extends Attempt {
  verdict: Verdict
  judgedBy: JudgedBy
  aiReason?: string
  better?: string
  rating: RatingValue
  easy: boolean
  appealed: boolean
  reviewId: string // 判定を直したときは同じ id で上書きする
  sessionBefore: SessionState // 答える前の予定（判定を直したときはここから作り直す）
  word: Word // 判定を直した後の語（許容訳などが変わる）
}

// 始める前の画面に出すもの
export interface StartInfo {
  empty: boolean // 語が 1 つも無い
  done: boolean // 今日の分は終わり
  reviews: number
  fresh: number
  ahead: number // 「先取りで復習する」で足した枚数（仕様書 6-9）
  minutes: number
  exportDue: boolean // 最後の書き出しから 7 日
  neverExported: boolean
}

export type Phase =
  | { name: 'loading' }
  | { name: 'start'; info: StartInfo }
  | { name: 'question'; q: Question; progress: Progress }
  | { name: 'judging'; attempt: Attempt; progress: Progress }
  | { name: 'self'; attempt: Attempt; message: string; progress: Progress }
  | { name: 'answer'; result: Result; progress: Progress }
  | { name: 'clock'; q: Question; progress: Progress } // 端末の時計の誤りで飛ばした問題
  | { name: 'fatal'; message: string } // 保存の失敗など。開き直すまで先へ進ませない
