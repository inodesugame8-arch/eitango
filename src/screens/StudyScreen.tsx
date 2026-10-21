// 学習（仕様書 5-1・6 章・7 章・12 章）。始める前 → 出題 →（AI の判定）→ 答えた後（または自分で採点）→ 次の問題 …
// 判定が決まったらすぐ FSRS に渡して保存し、保存に失敗したら開き直すまで先へ進ませない
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useAppData, type Snapshot } from '../app/useAppData.ts'
import { BUTTON, LOAD_FAILED, PRIMARY, SAVE_FAILED, VERDICT_COLOR, VERDICT_LABEL, VERDICT_MARK } from '../components/ui.ts'
import { useVisualViewport } from '../hooks/useVisualViewport.ts'
import { settleAnswer, type Settled } from '../lib/answer.ts'
import { appealChoices, applyAppeal } from '../lib/appeal.ts'
import { exportReminderDue } from '../lib/backup.ts'
import { scrambleWords } from '../lib/cloze.ts'
import { AHEAD_PER_PRESS, DEFAULT_NEW_PER_DAY, JUDGE_TIMEOUT_MS, TAP_GUARD_MS } from '../lib/config.ts'
import { getSession, saveAnswer, saveSession, type EitangoDB } from '../lib/db.ts'
import { dayOf } from '../lib/day.ts'
import { callGemini, errorText, GeminiError } from '../lib/gemini/client.ts'
import { judgePrompt, parseJudge, type JudgeResult } from '../lib/gemini/prompts.ts'
import { newId } from '../lib/id.ts'
import { matchLocal } from '../lib/match.ts'
import { buildToday, estimateMinutes, pickAhead, type TodayPlan } from '../lib/queue.ts'
import { addExtraNew, addStepEntries, ensureSession, pickNext, remainingCount, removeCard } from '../lib/session.ts'
import { speak, stopSpeech, unlockSpeech } from '../lib/speech.ts'
import { isClockError } from '../lib/srs.ts'
import type { CardRecord, Direction, JudgedBy, SessionState, Verdict, Word } from '../lib/types.ts'
import AnswerForm from './study/AnswerForm.tsx'
import AnswerView from './study/AnswerView.tsx'
import QuestionView from './study/QuestionView.tsx'
import SelfGradeView from './study/SelfGradeView.tsx'
import StartView from './study/StartView.tsx'
import type { Attempt, Phase, Progress, Question, QuestionMode, Result, StartInfo } from './study/types.ts'

const CLOCK_TEXT = '端末の時計を確認してください'
const NO_MORE_NEW = '新しい語はもうありません。単語を登録すると増えます'
const MANY_REVIEWS = '復習が多い日です。新しい問題は、先の日の復習を増やします'
const NO_AHEAD = '先取りできる復習はありません'
const VERDICTS: readonly Verdict[] = ['correct', 'close', 'wrong']

// その日の学習の材料（メモリの中）。保存したものと同じ内容を持ち、答えるたびに更新する
interface Run {
  snap: Snapshot // 並びを作ったときの語・カード・解答記録・設定
  session: SessionState // もう一度出す予定（保存してあるものと同じ）
  queue: string[] // 今日の並び（「先取りで復習する」で足した分を含む。答えたら外す）
  plan: TodayPlan
  ahead: Set<string> // 「先取りで復習する」で足したカード（保存しない。開き直したら、もう一度押す）
  cards: Map<string, CardRecord> // 最新のカード（答えるたびに更新）
  words: Map<string, Word> // 最新の語（判定を直すたびに更新）
  keyNoticeShown: boolean // キーが無いときの案内を、この学習で出したか（学習 1 回につき 1 回だけ）
}

// queuedCardIds: 「先取りで復習する」で並びに足し、まだ解いていないカード（その語の新しい日→英を選ばない。仕様書 6-9）
function planToday(snap: Snapshot, session: SessionState, now: Date, queuedCardIds?: ReadonlySet<string>): TodayPlan {
  return buildToday({
    words: snap.words,
    cards: snap.cards,
    reviews: snap.reviews,
    now,
    newPerDay: snap.settings.newWordsPerDay,
    extraNew: session.extraNew,
    pendingCardIds: new Set(session.pending.map((p) => p.cardId)),
    queuedCardIds,
  })
}

// 今日の並びを作り、学習ステップの予定を足して保存する（始める前の画面に入るとき）
async function prepare(db: EitangoDB, snap: Snapshot, saved: SessionState | undefined, now: Date): Promise<Run> {
  const s0 = ensureSession(saved, now)
  const plan = planToday(snap, s0, now)
  const session = addStepEntries(s0, plan.stepEntries)
  await saveSession(db, session)
  return {
    snap,
    session,
    queue: [...plan.queue],
    plan,
    ahead: new Set(),
    cards: new Map(snap.cards.map((c) => [c.id, c])),
    words: new Map(snap.words.map((w) => [w.id, w])),
    keyNoticeShown: false,
  }
}

// 開いたとき: 保存した予定を読んでから並びを作る。失敗したら画面に出す文を返す
async function boot(db: EitangoDB, snap: Snapshot, saved?: SessionState): Promise<Run | string> {
  let session = saved
  if (session === undefined) {
    try {
      session = await getSession(db)
    } catch {
      return LOAD_FAILED
    }
  }
  try {
    return await prepare(db, snap, session, new Date())
  } catch {
    return SAVE_FAILED
  }
}

// 始める前の画面の数。先取りの枚数は分けて出し、目安の時間は復習と同じに数える（仕様書 6-9）
function startInfo(r: Run, now: Date): StartInfo {
  const reviews = r.plan.reviewRemaining
  const fresh = r.plan.newRemaining
  const ahead = r.queue.filter((id) => r.ahead.has(id)).length
  return {
    empty: r.snap.words.length === 0,
    done: pickNext(r.session, r.queue, now).kind === 'done',
    reviews,
    fresh,
    ahead,
    minutes: estimateMinutes(reviews + ahead, fresh),
    exportDue: exportReminderDue(r.snap.settings.lastExportAt, r.snap.words, now),
    neverExported: r.snap.settings.lastExportAt === undefined,
  }
}

function progressOf(r: Run): Progress {
  return { done: r.session.answers, total: r.session.answers + remainingCount(r.session, r.queue) }
}

// 穴埋めを使うのは単語・熟語で、穴埋めの文と穴の答えの両方があるときだけ（仕様書 7-5）
function modeOf(word: Word, direction: Direction): QuestionMode {
  if (direction === 'en-ja') return 'en-ja'
  if (word.kind === 'phrase') return 'phrase'
  if ((word.cloze ?? '').trim() !== '' && (word.clozeAnswer ?? '').trim() !== '') return 'cloze'
  return 'ja-en'
}

// 学習の途中の画面。キーボードの上に見えている範囲に合わせて、上から「進み具合 → 問題 → 入力欄 → ボタン」。
// 親の余白を受けないので、横向きのときに左右の安全領域にかからないよう、ここで余白を付ける（縦向きでは 0）
function SessionLayout({ children }: { children: ReactNode }) {
  useVisualViewport()
  return (
    <div
      className="fixed inset-x-0 z-20 flex flex-col bg-white dark:bg-black"
      style={{
        top: 'var(--vvt, 0px)',
        height: 'var(--vvh, 100dvh)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {children}
    </div>
  )
}

const keep = (e: { preventDefault: () => void }): void => e.preventDefault()

// 画面か中身が替わった時刻（performance.now()。phaseAt・changedAt）から TAP_GUARD_MS 経っていないか。経っていない
// 押しは無視する（2 度押しの 2 回目が、替わった直後の画面の同じ場所のボタンに当たって記録されるのを防ぐ）
const justChanged = (since: number): boolean => performance.now() - since < TAP_GUARD_MS

export default function StudyScreen() {
  const { db, settings, reload, setInSession, needRefresh, applyUpdate } = useAppData()
  const [phase, setPhaseState] = useState<Phase>({ name: 'loading' })
  const [more, setMore] = useState('')
  const [value, setValue] = useState('')
  const [speakMissed, setSpeakMissed] = useState(false)
  const [hintShown, setHintShown] = useState(false)
  const [choicesOpen, setChoicesOpen] = useState(false)
  const phaseRef = useRef<Phase>(phase)
  const run = useRef<Run | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const firstInputAt = useRef<number | undefined>(undefined)
  const usedHint = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const busy = useRef(false) // 答え・判定を直す・自分で採点の処理中（二重に送らない）
  const saving = useRef(false) // 保存の途中（「やめる」で予定を古いもので上書きしない）
  const speakToken = useRef(0)
  // 画面（phase の name）が替わった時刻（performance.now()）。判定を直す（答えた後の画面のまま）では替えない
  const phaseAt = useRef(0)
  // 画面の中身が替わった時刻（判定を直す・簡単すぎ・もっとやるの数え直しのように、名前が同じままでも替える）。
  // 判定を直すの選択肢が閉じて中身が縮むと、スクロールの位置が詰められて上の行（判定を直す・簡単すぎ）が下がり、
  // 2 度押しの 2 回目が「簡単すぎ」に当たる。同じボタンの 2 度押しで「もっとやる」を 2 回足すのも防ぐ
  const changedAt = useRef(0)

  const setPhase = useCallback((p: Phase) => {
    const t = performance.now()
    if (p.name !== phaseRef.current.name) phaseAt.current = t
    changedAt.current = t
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  // 並びを作り直して始める前の画面へ（終わったとき・やめたとき・朝 4 時をまたいだとき）
  const restart = useCallback(async (): Promise<void> => {
    setPhase({ name: 'loading' })
    let snap: Snapshot
    try {
      snap = await reload()
    } catch {
      setPhase({ name: 'fatal', message: LOAD_FAILED })
      return
    }
    const res = await boot(db, snap, run.current?.session)
    if (typeof res === 'string') {
      setPhase({ name: 'fatal', message: res })
      return
    }
    run.current = res
    setMore('')
    setPhase({ name: 'start', info: startInfo(res, new Date()) })
  }, [db, reload, setPhase])

  // 開いたとき。AppData の写しではなく、データベースから読み直したもので並びを作る（学習の途中の保存は AppData に
  // 反映しないので、途中で画面が外れて開き直したときや、全部の置き換えの読み込みが終わる前に開いたときに、
  // 古いカードから FSRS を計算して上書きしないため）
  useEffect(() => {
    let alive = true
    void (async () => {
      let snap: Snapshot
      try {
        snap = await reload()
      } catch {
        if (alive) setPhase({ name: 'fatal', message: LOAD_FAILED })
        return
      }
      // 読み直す間に画面が外れていたら（StrictMode で effect が 2 回走ったときの 1 回目も）並びを作らない
      if (!alive) return
      const res = await boot(db, snap)
      if (!alive) return
      if (typeof res === 'string') {
        setPhase({ name: 'fatal', message: res })
        return
      }
      run.current = res
      setPhase({ name: 'start', info: startInfo(res, new Date()) })
    })()
    return () => {
      alive = false
    }
  }, [db, reload, setPhase])

  // 画面を離れたら、判定の呼び出しと読み上げを止め、下の切り替えを戻す
  useEffect(
    () => () => {
      abortRef.current?.abort()
      stopSpeech()
      setInSession(false)
    },
    [setInSession],
  )

  // 画面が前に戻ったとき、始める前の画面でアプリの日が変わっていたら数え直す（仕様書 6-4）
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      const r = run.current
      if (phaseRef.current.name === 'start' && r && dayOf(new Date()) !== r.session.day) void restart()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [restart])

  // 読み上げる。1.5 秒たっても始まらなければ再生ボタンを目立たせる
  const playTerm = (text: string): void => {
    speakToken.current += 1
    const token = speakToken.current
    setSpeakMissed(false)
    void speak(text, settings.voiceRate).then((r) => {
      if (r === 'not-started' && speakToken.current === token) setSpeakMissed(true)
    })
  }

  // 次の 1 問を出す。どれも無ければ「今日の分は終わりです」（始める前の画面）へ
  const showNext = (now: Date): void => {
    const r = run.current
    if (!r) return
    for (;;) {
      const pick = pickNext(r.session, r.queue, now)
      if (pick.kind === 'done') {
        setInSession(false)
        void restart()
        return
      }
      const record = r.cards.get(pick.cardId)
      const word = record ? r.words.get(record.wordId) : undefined
      if (!record || !word) {
        // 語が見つからないカード（念のため）。予定と並びから外して次へ
        r.session = removeCard(r.session, pick.cardId)
        r.queue = r.queue.filter((id) => id !== pick.cardId)
        continue
      }
      const mode = modeOf(word, record.direction)
      const scramble = mode === 'phrase' ? scrambleWords(word.term, `${r.session.day}:${record.id}`) : []
      const q: Question = {
        cardId: record.id,
        practice: pick.practice,
        record,
        word,
        direction: record.direction,
        mode,
        scramble: scramble.length > 1 ? scramble : [],
        shownAt: Date.now(),
      }
      setValue('')
      firstInputAt.current = undefined
      usedHint.current = false
      setHintShown(false)
      setChoicesOpen(false)
      setSpeakMissed(false)
      setPhase({ name: 'question', q, progress: progressOf(r) })
      // 英→日は出た時に英語を読み上げる。日→英は答える前に読み上げない（答えが分かってしまうため）
      if (q.direction === 'en-ja') playTerm(word.term)
      return
    }
  }

  // 判定が決まったら、FSRS に渡してカードと解答記録と予定を 1 つのトランザクションで保存する
  const settle = async (
    attempt: Attempt,
    verdict: Verdict,
    judgedBy: JudgedBy,
    aiReason?: string,
    better?: string,
  ): Promise<void> => {
    const r = run.current
    if (!r) return
    const { q } = attempt
    const sessionBefore = r.session
    const reviewId = newId()
    let out: Settled
    try {
      out = settleAnswer({
        record: q.record,
        practice: q.practice,
        sessionBefore,
        at: attempt.at,
        answer: attempt.answer,
        verdict,
        judgedBy,
        thinkMs: attempt.thinkMs,
        totalMs: attempt.totalMs,
        usedHint: attempt.usedHint,
        easy: false,
        appealed: false,
        reviewId,
        aiReason,
      })
    } catch (e) {
      if (!isClockError(e)) {
        setPhase({ name: 'fatal', message: `${SAVE_FAILED}（${e instanceof Error ? e.message : String(e)}）` })
        return
      }
      // 解いた時刻が前回より前の日付（端末の時計を戻したときなど）。カードを変えずに、その問題を飛ばす（仕様書 12 章）
      r.session = removeCard(r.session, q.cardId)
      r.queue = r.queue.filter((id) => id !== q.cardId)
      saving.current = true
      try {
        await saveSession(db, r.session)
      } catch {
        setPhase({ name: 'fatal', message: SAVE_FAILED })
        return
      } finally {
        saving.current = false
      }
      setPhase({ name: 'clock', q, progress: progressOf(r) })
      return
    }
    saving.current = true
    try {
      await saveAnswer(db, { card: out.card, review: out.review, session: out.session })
    } catch {
      setPhase({ name: 'fatal', message: SAVE_FAILED })
      return
    } finally {
      saving.current = false
    }
    r.session = out.session
    r.cards.set(out.card.id, out.card)
    r.queue = r.queue.filter((id) => id !== q.cardId)
    const result: Result = {
      ...attempt,
      verdict,
      judgedBy,
      aiReason,
      better,
      rating: out.rating,
      easy: false,
      appealed: false,
      reviewId,
      sessionBefore,
      word: q.word,
    }
    setChoicesOpen(false)
    setPhase({ name: 'answer', result, progress: progressOf(r) })
    // 答えた後は英語（term）を読み上げる
    playTerm(q.word.term)
  }

  // 答える（空のまま答えたら「わからない」と同じ）。照合 → AI → 自分で採点（仕様書 7 章）
  const answer = async (text: string, giveUp: boolean): Promise<void> => {
    const p = phaseRef.current
    const r = run.current
    if (p.name !== 'question' || !r || busy.current || justChanged(phaseAt.current)) return
    busy.current = true
    try {
      const at = new Date()
      const t = at.getTime()
      const attempt: Attempt = {
        q: p.q,
        answer: giveUp ? '' : text.trim(),
        at,
        thinkMs: Math.max(0, (firstInputAt.current ?? t) - p.q.shownAt),
        totalMs: Math.max(0, t - p.q.shownAt),
        usedHint: usedHint.current,
      }
      if (attempt.answer === '') {
        await settle(attempt, 'wrong', 'giveup')
        return
      }
      if (matchLocal(p.q.word, p.q.direction, attempt.answer)) {
        await settle(attempt, 'correct', 'local')
        return
      }
      const apiKey = settings.apiKey?.trim() ?? ''
      if (apiKey === '') {
        const message = r.keyNoticeShown ? '' : errorText('no-key')
        r.keyNoticeShown = true
        setPhase({ name: 'self', attempt, message, progress: p.progress })
        return
      }
      const ctl = new AbortController()
      abortRef.current = ctl
      setPhase({ name: 'judging', attempt, progress: p.progress })
      let judged: JudgeResult
      try {
        const raw = await callGemini({
          apiKey,
          model: settings.model,
          ...judgePrompt(p.q.word, p.q.direction, attempt.answer),
          timeoutMs: JUDGE_TIMEOUT_MS,
          signal: ctl.signal,
        })
        judged = parseJudge(raw)
      } catch (e) {
        // 「やめる」で止めたときは何も出さない。ほかは原因ごとの文を出して自分で採点（仕様書 7-4・12 章）
        if (ctl.signal.aborted) return
        setPhase({
          name: 'self',
          attempt,
          message: errorText(e instanceof GeminiError ? e.kind : 'bad-response'),
          progress: p.progress,
        })
        return
      } finally {
        if (abortRef.current === ctl) abortRef.current = null
      }
      if (ctl.signal.aborted) return
      await settle(attempt, judged.verdict, 'ai', judged.reason, judged.better)
    } finally {
      busy.current = false
    }
  }

  const selfGrade = async (verdict: Verdict): Promise<void> => {
    const p = phaseRef.current
    if (p.name !== 'self' || busy.current || justChanged(phaseAt.current)) return
    busy.current = true
    try {
      // 自分で ○ にした答えは許容訳に加えない（加えるのは「正解にする」を押したときだけ）
      await settle(p.attempt, verdict, 'self')
    } finally {
      busy.current = false
    }
  }

  // 判定を直す・簡単すぎ（仕様書 6-6）。解く前のカードに元の解答の時刻で付け直し、答える前の予定から作り直して、
  // 同じ解答記録の id で保存し直す。練習なら FSRS には渡さず、変わるのは許容訳などの一覧だけ
  const redo = async (to: Verdict, easy: boolean): Promise<void> => {
    const p = phaseRef.current
    const r = run.current
    if (p.name !== 'answer' || !r || busy.current || justChanged(changedAt.current)) return
    busy.current = true
    saving.current = true
    try {
      const res = p.result
      const appealed = res.appealed || to !== res.verdict
      const out = settleAnswer({
        record: res.q.record,
        practice: res.q.practice,
        sessionBefore: res.sessionBefore,
        at: res.at,
        answer: res.answer,
        verdict: to,
        judgedBy: res.judgedBy,
        thinkMs: res.thinkMs,
        totalMs: res.totalMs,
        usedHint: res.usedHint,
        easy,
        appealed,
        reviewId: res.reviewId,
        aiReason: res.aiReason,
      })
      // 許容訳などは、学習を始めたときの語の写しではなく今の行に当てて直す（その後に AI で補った内容を消さないため）。
      // 書いた語が返る。判定を変えないとき（簡単すぎ）と語の行が無いときは返らないので、元の語のまま
      const saved = await saveAnswer(db, {
        card: out.card,
        review: out.review,
        session: out.session,
        wordChange:
          to !== res.verdict ? (cur) => applyAppeal(cur, res.q.direction, res.answer, to, new Date()) : undefined,
      })
      const wordAfter = saved ?? res.word
      r.session = out.session
      r.cards.set(out.card.id, out.card)
      r.words.set(wordAfter.id, wordAfter)
      setChoicesOpen(false)
      setPhase({
        name: 'answer',
        result: { ...res, verdict: to, rating: out.rating, easy, appealed, word: wordAfter },
        progress: progressOf(r),
      })
    } catch {
      setPhase({ name: 'fatal', message: SAVE_FAILED })
    } finally {
      saving.current = false
      busy.current = false
    }
  }

  // 次へ。朝 4 時をまたいでいたら、今の 1 問を終えたところで予定を捨てて並びを作り直す（仕様書 6-4）
  const next = (): void => {
    const p = phaseRef.current
    if ((p.name !== 'answer' && p.name !== 'clock') || busy.current || justChanged(phaseAt.current)) return
    const r = run.current
    if (!r) return
    const now = new Date()
    if (dayOf(now) !== r.session.day) {
      // 始める前の画面には入力欄が無いので選ばない
      setInSession(false)
      void restart()
      return
    }
    // 次の問題の向きの属性を入力欄に付けてから、押した処理の中で選ぶ（キーボードが閉じていたら開く）。
    // iPhone はキーボードの設定を選んだ時の属性で作るので、選ぶのは描いた後（begin と同じ）
    flushSync(() => {
      setMore('')
      showNext(now)
    })
    inputRef.current?.focus({ preventScroll: true })
  }

  // 入力欄の改行（form の submit）。答える前は「答える」、答えた後は「次へ」。判定中と自分で採点の間は無視する
  const onSubmit = (): void => {
    const p = phaseRef.current
    if (p.name === 'question') void answer(value, false)
    else if (p.name === 'answer' || p.name === 'clock') next()
  }

  // 学習を始める。「始める」と、終わりの画面の「もっとやる」の、押した処理の中で呼ぶ。notice は最初の問題の上に出す 1 行
  const begin = (now: Date, notice: string): void => {
    const r = run.current
    if (!r) return
    // 押した処理の中で、音量 0 の短い英語を読み上げて準備する（仕様書 10 章）
    unlockSpeech()
    r.keyNoticeShown = false
    setMore(notice)
    setInSession(true)
    // 入力欄を描いてから、押した処理の中で選ぶ（キーボードを開く）
    flushSync(() => showNext(now))
    inputRef.current?.focus({ preventScroll: true })
  }

  const onStart = (): void => {
    const r = run.current
    if (!r || phaseRef.current.name !== 'start') return
    const now = new Date()
    if (dayOf(now) !== r.session.day) {
      void restart()
      return
    }
    begin(now, '')
  }

  // やめる。判定を待っていれば止める。答える前なら何も保存しない。答えた後なら、その答えはもう保存してある
  const quit = (): void => {
    if (saving.current) return
    abortRef.current?.abort()
    abortRef.current = null
    stopSpeech()
    setInSession(false)
    void restart()
  }

  // もっとやるのボタンを押した後。始める前の画面なら数え直して出し直し、終わりの画面なら足した問題をそのまま出す（仕様書 5-1）
  const afterMore = (wasDone: boolean, now: Date, notice: string): void => {
    const r = run.current
    if (!r) return
    if (wasDone) {
      begin(now, notice)
      return
    }
    setMore(notice)
    setPhase({ name: 'start', info: startInfo(r, now) })
  }

  // もっとやる: 新しい問題を足す（仕様書 6-9）。今日の新しい問題の上限を「1 日の新しい語の数」だけ増やして並びを作り直す。
  // 終わりの画面では押した処理の中で問題を出す（キーボードと読み上げの準備のため）ので、予定の保存は待たない
  const addNew = (): void => {
    const r = run.current
    const p = phaseRef.current
    if (!r || p.name !== 'start' || saving.current || justChanged(changedAt.current)) return
    const now = new Date()
    if (dayOf(now) !== r.session.day) {
      void restart()
      return
    }
    const perDay = r.snap.settings.newWordsPerDay
    const s1 = addExtraNew(r.session, perDay > 0 ? perDay : DEFAULT_NEW_PER_DAY)
    // 先取りで足して、まだ解いていない英→日の語は、日→英を選ばない（同じ語の 2 枚を同じ日に出さない。仕様書 6-9）
    const plan = planToday(r.snap, s1, now, new Set(r.queue.filter((id) => r.ahead.has(id))))
    if (plan.newRemaining <= r.plan.newRemaining) {
      // 足せる新しいカードが無ければ、上限は増やさない
      setMore(NO_MORE_NEW)
      return
    }
    // 先取りで足した分は並びの後ろに残す
    const aheadLeft = r.queue.filter((id) => r.ahead.has(id) && !plan.queue.includes(id))
    r.session = addStepEntries(s1, plan.stepEntries)
    r.plan = plan
    r.queue = [...plan.queue, ...aheadLeft]
    // 増やした分は、その日のうちは保存しておく（開き直しても続く）。保存に失敗したら開き直すまで先へ進ませない
    saveSession(db, r.session).catch(() => setPhase({ name: 'fatal', message: SAVE_FAILED }))
    afterMore(p.info.done, now, plan.allowNew ? '' : MANY_REVIEWS)
  }

  // もっとやる: 先取りで復習する（仕様書 6-9）。出題日の近い順に 10 枚を並びの後ろに足す。足した分は保存しない
  const addAhead = (): void => {
    const r = run.current
    const p = phaseRef.current
    if (!r || p.name !== 'start' || justChanged(changedAt.current)) return
    const now = new Date()
    if (dayOf(now) !== r.session.day) {
      void restart()
      return
    }
    const busyIds = new Set([...r.queue, ...r.session.pending.map((x) => x.cardId)])
    const ids = pickAhead({
      cards: [...r.cards.values()],
      reviews: r.snap.reviews,
      now,
      busyCardIds: busyIds,
      limit: AHEAD_PER_PRESS,
    })
    if (ids.length === 0) {
      setMore(NO_AHEAD)
      return
    }
    r.queue = [...r.queue, ...ids]
    for (const id of ids) r.ahead.add(id)
    afterMore(p.info.done, now, '')
  }

  // ---- 描画 ----

  if (phase.name === 'loading') return <p className="p-4">読み込み中</p>
  if (phase.name === 'fatal') {
    return (
      <main className="p-4">
        <p className="font-bold">{phase.message}</p>
      </main>
    )
  }
  if (phase.name === 'start') {
    return (
      <StartView
        info={phase.info}
        more={more}
        needRefresh={needRefresh}
        onUpdate={() => void applyUpdate()}
        onStart={onStart}
        onAddNew={addNew}
        onAddAhead={addAhead}
      />
    )
  }

  const q =
    phase.name === 'question' || phase.name === 'clock'
      ? phase.q
      : phase.name === 'answer'
        ? phase.result.q
        : phase.attempt.q
  const { done, total } = phase.progress
  // 本文の入れ物の key。新しい問題が出たときと、答えた後（自分で採点・時計の誤り）の画面に替わったときに入れ物を
  // 作り直し、前の画面でスクロールした位置を残さない（判定中は問題の画面のまま）。入力欄は兄弟なので作り直さない
  const view = phase.name === 'judging' ? 'question' : phase.name
  const bodyKey = `${q.cardId}:${q.shownAt}:${view}`

  let body: ReactNode
  if (phase.name === 'question' || phase.name === 'judging') {
    body = (
      <QuestionView
        q={q}
        speakMissed={speakMissed}
        hintShown={hintShown}
        onPlay={() => playTerm(q.word.term)}
        onHint={() => {
          // 押した時点でヒントを使った印を付ける（○ でも Hard になる。仕様書 6-5）
          usedHint.current = true
          setHintShown(true)
        }}
      />
    )
  } else if (phase.name === 'self') {
    body = <SelfGradeView attempt={phase.attempt} message={phase.message} />
  } else if (phase.name === 'answer') {
    const res = phase.result
    body = (
      <AnswerView
        result={res}
        speakMissed={speakMissed}
        choices={appealChoices(res.word, res.q.direction, res.answer, res.verdict, res.judgedBy)}
        choicesOpen={choicesOpen}
        onPlay={() => playTerm(res.word.term)}
        onToggleChoices={() => {
          // 判定を直した直後の 2 回目で、閉じた選択肢をまた開かない
          if (!justChanged(changedAt.current)) setChoicesOpen((v) => !v)
        }}
        onAppeal={(to) => void redo(to, false)}
        onEasy={() => void redo('correct', true)}
      />
    )
  } else {
    body = <p className="text-xl">{CLOCK_TEXT}</p>
  }

  // 入力欄の下のボタン。押しても入力欄の選択を外さないのは、AnswerForm のボタンの行の入れ物で行う
  let buttons: ReactNode
  if (phase.name === 'question') {
    buttons = (
      <>
        <button type="button" onClick={() => void answer('', true)} className={`${BUTTON} flex-1`}>
          わからない
        </button>
        <button type="submit" className={`${PRIMARY} flex-1`}>
          答える
        </button>
      </>
    )
  } else if (phase.name === 'judging') {
    buttons = (
      // disabled にしない。disabled のフォームの部品を的にした本物の mousedown は、WebKit（EventPath::adjustForDisabledFormControl）
      // でも Chrome でも祖先に届かず、ボタンの行の入れ物の preventDefault が効かずに入力欄の選択が外れるため。押しても何もしない
      <button type="button" aria-disabled="true" className={`${BUTTON} flex-1 aria-disabled:opacity-40`}>
        判定中
      </button>
    )
  } else if (phase.name === 'self') {
    buttons = VERDICTS.map((v) => (
      <button
        key={v}
        type="button"
        onClick={() => void selfGrade(v)}
        className={`${BUTTON} flex-1 font-bold ${VERDICT_COLOR[v]}`}
      >
        {VERDICT_MARK[v]} {VERDICT_LABEL[v]}
      </button>
    ))
  } else {
    buttons = (
      <button type="submit" className={`${PRIMARY} flex-1`}>
        次へ
      </button>
    )
  }

  return (
    <SessionLayout>
      <header className="flex items-center gap-3 px-4 pt-2">
        {/* 押せる範囲は 44×44 以上（仕様書 11 章）。13px の 3 文字では幅が 39px なので min-w-11 で広げる */}
        <button type="button" onClick={quit} onMouseDown={keep} className="min-h-11 min-w-11 text-[13px] underline">
          やめる
        </button>
        <div className="h-1.5 flex-1 rounded bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-1.5 rounded bg-neutral-900 dark:bg-neutral-100"
            style={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}
          />
        </div>
        <span className="text-[13px] tabular-nums">
          {done}/{total}
        </span>
      </header>
      {more && <p className="px-4 pt-2 text-[13px]">{more}</p>}
      <div
        key={bodyKey}
        className="flex-1 overflow-y-auto px-4 py-3"
        onMouseDown={(e) => {
          // 2 度押しの 2 回目が、替わった直後の本文の何も無い所に当たっても、入力欄の選択を外さない（キーボードを閉じない）
          if (justChanged(changedAt.current)) e.preventDefault()
        }}
      >
        {body}
      </div>
      <AnswerForm
        inputRef={inputRef}
        value={value}
        english={q.direction === 'ja-en'}
        onChange={setValue}
        onFirstInput={() => {
          if (firstInputAt.current === undefined) firstInputAt.current = Date.now()
        }}
        onSubmit={onSubmit}
      >
        {buttons}
      </AnswerForm>
    </SessionLayout>
  )
}
