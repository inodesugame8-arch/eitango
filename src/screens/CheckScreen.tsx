// 動作確認（仕様書 13-2）。iPhone でしか分からないことと Gemini の書き方を、ホーム画面に追加した状態で試す。
// 動作確認の段（T09）で作るので、src/lib/db.ts と useAppData は使わない。
// キーはこの画面の欄で入れ、自分のデータベース eitango-check に保存する（本番の設定とは別）
import Dexie, { type EntityTable } from 'dexie'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { caseWord, JUDGE_CASES, type JudgeCase } from '../check/judgeCases.ts'
import { replaceLink } from '../components/ui.ts'
import { CHECK_DB_NAME, DEFAULT_MODEL, FILL_INTERVAL_MS, FILL_TIMEOUT_MS, MODELS, VOICE_RATES } from '../lib/config.ts'
import { callGemini, GeminiError, type FormatStyle } from '../lib/gemini/client.ts'
import { judgePrompt, parseJudge } from '../lib/gemini/prompts.ts'
import { iosVersion, isIOS, isPersisted, isStandalone, requestPersist } from '../lib/platform.ts'
import { canShareFile, copyText, makeBackupFile, shareFile } from '../lib/share.ts'
import { speak, speechSupported, stopSpeech, unlockSpeech, type SpeechLog } from '../lib/speech.ts'
import type { Verdict } from '../lib/types.ts'

// ---- この画面だけのデータベース（eitango-check）----

interface CheckRow {
  key: string
  value: unknown
}

type CheckDB = Dexie & { kv: EntityTable<CheckRow, 'key'> }

let checkDb: CheckDB | undefined

function getCheckDb(): CheckDB {
  if (!checkDb) {
    const db = new Dexie(CHECK_DB_NAME) as CheckDB
    db.version(1).stores({ kv: 'key' })
    checkDb = db
  }
  return checkDb
}

const KEY_ROW = 'apiKey'

// ---- 共通の道具 ----

type SectionKey = 'env' | 'speech' | 'gemini' | 'cases' | 'ime' | 'share' | 'storage' | 'update'
type Report = (key: SectionKey, text: string) => void

const TITLES: Record<SectionKey, string> = {
  env: '1. 環境',
  speech: '2. 読み上げ',
  gemini: '3. Gemini の接続',
  cases: '4. 判定の 20 問',
  ime: '5. 日本語入力と改行',
  share: '6. 書き出しと読み込み',
  storage: '7. 保存',
  update: '8. 更新',
}
const ORDER: readonly SectionKey[] = ['env', 'speech', 'gemini', 'cases', 'ime', 'share', 'storage', 'update']

const PHRASE = 'Do you even wanna win?'
const pageStart = performance.now()

// 画面を開いてからの秒数（記録の頭に付ける）
function stamp(): string {
  return `+${((performance.now() - pageStart) / 1000).toFixed(1)}s`
}

const yesNo = (v: boolean): string => (v ? 'はい' : 'いいえ')

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

// 止めた後に呼ばれたら待たない（止める知らせは 1 回しか来ないため）
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function buildText(): string {
  return `${new Date(__BUILD_TIME__).toLocaleString('ja-JP')}（コミット ${__COMMIT__}）`
}

// 記録の行を足していく（画面を開いてからの秒数つき）
function useLog(): [string[], (line: string) => void, () => void] {
  const [lines, setLines] = useState<string[]>([])
  const add = useCallback((line: string) => setLines((l) => [...l, `${stamp()} ${line}`]), [])
  const clear = useCallback(() => setLines([]), [])
  return [lines, add, clear]
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-neutral-300 py-4 dark:border-neutral-700">
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Button({
  onClick,
  children,
  disabled,
  keepFocus,
}: {
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  keepFocus?: boolean // 押しても入力欄から選択を外さない（キーボードを閉じないかを見るため）
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      disabled={disabled}
      className="min-h-11 rounded-lg border border-neutral-400 px-3 disabled:opacity-40 dark:border-neutral-600"
    >
      {children}
    </button>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="my-2 flex flex-wrap items-center gap-2">{children}</div>
}

function Log({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded border border-neutral-300 p-2 text-[13px] break-all whitespace-pre-wrap dark:border-neutral-700">
      {lines.join('\n')}
    </pre>
  )
}

// ---- Gemini を呼ぶ ----

interface AiOptions {
  apiKey: string
  model: string
  format: FormatStyle
  levelCase: 'upper' | 'lower'
}

type Attempt =
  | { ok: true; ms: number; verdict: Verdict; reason: string; better: string }
  | { ok: false; ms: number; kind: string; status?: number; message: string }

// 照合を通さず、直接 AI で判定する。実際の時間を測るため、待ち時間の上限は長い方（FILL_TIMEOUT_MS）にする
async function tryJudge(c: JudgeCase, ai: AiOptions, signal?: AbortSignal): Promise<Attempt> {
  const p = judgePrompt(caseWord(c), c.direction, c.answer)
  const t0 = performance.now()
  const ms = (): number => Math.round(performance.now() - t0)
  try {
    const raw = await callGemini({
      apiKey: ai.apiKey,
      model: ai.model,
      system: p.system,
      user: p.user,
      schema: p.schema,
      timeoutMs: FILL_TIMEOUT_MS,
      format: ai.format,
      thinkingLevelCase: ai.levelCase,
      signal,
    })
    return { ok: true, ms: ms(), ...parseJudge(raw) }
  } catch (e) {
    if (e instanceof GeminiError) return { ok: false, ms: ms(), kind: e.kind, status: e.status, message: e.message }
    return { ok: false, ms: ms(), kind: 'unknown', message: errorMessage(e) }
  }
}

function attemptText(a: Attempt): string {
  if (a.ok) return `成功 ${a.ms} ms ${a.verdict}「${a.reason}」`
  return `失敗 ${a.ms} ms ${a.kind}${a.status !== undefined ? ` ${a.status}` : ''} ${a.message.slice(0, 300)}`
}

function aiLabel(ai: AiOptions): string {
  return `${ai.model}・${ai.format}・thinkingLevel ${ai.levelCase === 'upper' ? '大文字' : '小文字'}`
}

// ---- 1. 環境 ----

function persistedText(p: boolean | undefined): string {
  return p === undefined ? '使えない（安全なページでない）' : yesNo(p)
}

function EnvSection({ report }: { report: Report }) {
  const [persisted, setPersisted] = useState('確認中')
  const [persistResult, setPersistResult] = useState('')

  useEffect(() => {
    let alive = true
    void isPersisted().then((p) => {
      if (alive) setPersisted(persistedText(p))
    })
    return () => {
      alive = false
    }
  }, [])

  const rows: [string, string][] = [
    ['iOS の版（UA から見た目安。正しくは 設定 → 一般 → 情報）', iosVersion() ?? 'iOS ではない'],
    ['iPhone・iPad か', yesNo(isIOS())],
    ['ホーム画面のアプリか', yesNo(isStandalone())],
    ['安全なページか', yesNo(window.isSecureContext)],
    ['保存の永続化（persisted）', persisted],
    ['読み上げがあるか', yesNo(speechSupported())],
    ['サービスワーカーが使えるか', yesNo('serviceWorker' in navigator)],
    ['ビルド', buildText()],
    ['UA', navigator.userAgent],
  ]
  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(persistResult ? [`永続化を頼んだ結果: ${persistResult}`] : []),
  ].join('\n')

  useEffect(() => report('env', text), [report, text])

  return (
    <Section title={TITLES.env}>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[13px] text-neutral-500">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <Row>
        <Button
          onClick={async () => {
            const ok = await requestPersist()
            setPersistResult(ok ? '許された' : '許されなかった')
            setPersisted(persistedText(await isPersisted()))
          }}
        >
          永続化を頼む
        </Button>
        {persistResult && <span>{persistResult}</span>}
      </Row>
    </Section>
  )
}

// ---- 2. 読み上げ ----

interface AudioSessionLike {
  type: string
}

function audioSession(): AudioSessionLike | undefined {
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
}

function SpeechSection({ report, ai }: { report: Report; ai: AiOptions }) {
  const [lines, add, clear] = useLog()
  const [rate, setRate] = useState(1)
  const session = audioSession()

  const onEvent: SpeechLog = useCallback((event, detail) => add(`on${event} ${detail}`), [add])

  // 画面を離れたら、待っている読み上げと Gemini の呼び出しを止める（この画面は本番にも残るため）
  const life = useRef<AbortController | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    life.current = ctl
    return () => ctl.abort()
  }, [])

  const say = useCallback(
    async (label: string) => {
      const r = await speak(PHRASE, rate, onEvent)
      add(`${label} → ${r}（${rate.toFixed(1)} 倍）`)
    },
    [add, onEvent, rate],
  )

  const text = [
    `速さ ${rate}`,
    `navigator.audioSession: ${session ? `ある（type ${session.type}）` : '無い'}`,
    ...lines,
  ].join('\n')
  useEffect(() => report('speech', text), [report, text])

  return (
    <Section title={TITLES.speech}>
      <p className="text-[13px] text-neutral-500">先に「準備」を押す。消音モードでも試す</p>
      <Row>
        <Button
          onClick={() => {
            unlockSpeech()
            add('準備（音量 0 の ok を読んだ）')
          }}
        >
          準備（音量 0）
        </Button>
        <Button
          onClick={() => {
            // 本番の「始める」と同じ順番: 準備の 'ok' を読んだ直後に、同じ押す操作の中で読み上げる
            unlockSpeech()
            add('準備（音量 0 の ok を読んだ）')
            void say('準備してすぐ読み上げる（「始める」と同じ順番）')
          }}
        >
          準備してすぐ読み上げる
        </Button>
        <Button onClick={() => void say('読み上げる')}>読み上げる</Button>
        <Button
          onClick={() => {
            add('3 秒待つ')
            setTimeout(() => {
              if (!life.current?.signal.aborted) void say('3 秒後に読み上げる')
            }, 3000)
          }}
        >
          3 秒後に読み上げる
        </Button>
        <Button
          onClick={async () => {
            if (ai.apiKey.trim() === '') {
              add('キーがありません（3. の欄で入れる）')
              return
            }
            add('Gemini を呼ぶ')
            const signal = life.current?.signal
            const a = await tryJudge(JUDGE_CASES[0], ai, signal)
            if (signal?.aborted) return
            add(`Gemini ${attemptText(a)}`)
            await say('Gemini の返事の後に読み上げる')
          }}
        >
          Gemini の返事の後に読み上げる
        </Button>
        <Button
          onClick={() => {
            stopSpeech()
            add('止めた')
          }}
        >
          止める
        </Button>
      </Row>
      <Row>
        <label className="flex items-center gap-2">
          速さ
          <select
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
          >
            {VOICE_RATES.map((r) => (
              <option key={r} value={r}>
                {r.toFixed(1)} 倍
              </option>
            ))}
          </select>
        </label>
      </Row>
      {session ? (
        <Row>
          <span>audioSession（今 {session.type}）</span>
          {(['playback', 'auto'] as const).map((type) => (
            <Button
              key={type}
              onClick={() => {
                try {
                  session.type = type
                  add(`audioSession.type を ${type} にした → ${session.type}`)
                } catch (e) {
                  add(`audioSession.type を ${type} にできない: ${errorMessage(e)}`)
                }
              }}
            >
              {type}
            </Button>
          ))}
        </Row>
      ) : (
        <p className="my-2">navigator.audioSession は無い</p>
      )}
      <Row>
        <Button onClick={clear}>記録を消す</Button>
      </Row>
      <Log lines={lines} />
    </Section>
  )
}

// ---- 3. Gemini の接続 ----

interface ConnectionRun {
  label: string
  attempts: Attempt[]
}

function runSummary(attempts: readonly Attempt[]): string {
  const ok = attempts.filter((a) => a.ok)
  const times = ok.map((a) => a.ms).sort((a, b) => a - b)
  const time =
    times.length > 0
      ? `時間 最小 ${times[0]} ms・中央 ${times[Math.floor((times.length - 1) / 2)]} ms・最大 ${times[times.length - 1]} ms`
      : '時間 —'
  return `成功 ${ok.length}/${attempts.length}・${time}`
}

function GeminiSection({
  report,
  ai,
  setAi,
}: {
  report: Report
  ai: AiOptions
  setAi: (update: (ai: AiOptions) => AiOptions) => void
}) {
  const [draft, setDraft] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState('')
  const [runs, setRuns] = useState<ConnectionRun[]>([])
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // 画面を離れたら呼び出しを止める（この画面は本番にも残り、裏で呼び続けると学習の判定と回数の上限を取り合うため）
  useEffect(() => () => abort.current?.abort(), [])

  useEffect(() => {
    getCheckDb()
      .kv.get(KEY_ROW)
      .then((row) => {
        const key = typeof row?.value === 'string' ? row.value : ''
        setDraft(key)
        setAi((a) => ({ ...a, apiKey: key }))
        setKeyStatus(key ? '保存したキーを読みました' : 'キーはまだありません')
      })
      .catch((e: unknown) => setKeyStatus(`キーを読めませんでした: ${errorMessage(e)}`))
  }, [setAi])

  const saveKey = async (): Promise<void> => {
    const key = draft.trim()
    try {
      await getCheckDb().kv.put({ key: KEY_ROW, value: key })
      setAi((a) => ({ ...a, apiKey: key }))
      setKeyStatus('保存しました')
    } catch (e) {
      setKeyStatus(`保存できませんでした: ${errorMessage(e)}`)
    }
  }

  const run = async (): Promise<void> => {
    const ctl = new AbortController()
    abort.current = ctl
    setRunning(true)
    const index = runs.length
    setRuns((r) => [...r, { label: aiLabel(ai), attempts: [] }])
    for (let i = 0; i < 10; i++) {
      if (i > 0) await sleep(FILL_INTERVAL_MS, ctl.signal)
      if (ctl.signal.aborted) break
      const a = await tryJudge(JUDGE_CASES[0], ai, ctl.signal)
      if (ctl.signal.aborted) break // 止めた 1 回は記録しない（失敗に数えないため）
      setRuns((r) => r.map((x, j) => (j === index ? { ...x, attempts: [...x.attempts, a] } : x)))
    }
    setRunning(false)
  }

  const text = runs
    .map((r) =>
      [`${r.label}: ${runSummary(r.attempts)}`, ...r.attempts.map((a, i) => `  ${i + 1}: ${attemptText(a)}`)].join('\n'),
    )
    .join('\n')
  useEffect(() => report('gemini', text), [report, text])

  const last = runs[runs.length - 1]

  return (
    <Section title={TITLES.gemini}>
      <label className="block">
        <span className="text-[13px] text-neutral-500">Gemini のキー（この画面だけで使う。本番の設定とは別）</span>
        <input
          type={showKey ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-400 px-3 dark:border-neutral-600"
        />
      </label>
      <Row>
        <Button onClick={() => void saveKey()}>保存</Button>
        <Button onClick={() => setShowKey((v) => !v)}>{showKey ? '隠す' : '表示'}</Button>
        <span className="text-[13px]">{keyStatus}</span>
      </Row>
      <Row>
        <label className="flex items-center gap-2">
          モデル
          <select
            value={ai.model}
            onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
            className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </Row>
      <Row>
        <label className="flex items-center gap-2">
          構造化出力
          <select
            value={ai.format}
            onChange={(e) => setAi((a) => ({ ...a, format: e.target.value as FormatStyle }))}
            className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
          >
            <option value="responseFormat">responseFormat</option>
            <option value="responseJsonSchema">responseJsonSchema</option>
          </select>
        </label>
      </Row>
      <Row>
        <label className="flex items-center gap-2">
          thinkingLevel
          <select
            value={ai.levelCase}
            onChange={(e) => setAi((a) => ({ ...a, levelCase: e.target.value === 'lower' ? 'lower' : 'upper' }))}
            className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
          >
            <option value="upper">大文字（LOW）</option>
            <option value="lower">小文字（low）</option>
          </select>
        </label>
        <span className="text-[13px] text-neutral-500">送るのは 3.8 Flash のときだけ</span>
      </Row>
      <Row>
        <Button onClick={() => void run()} disabled={running || ai.apiKey === ''}>
          接続を 10 回試す
        </Button>
        <Button onClick={() => abort.current?.abort()} disabled={!running}>
          止める
        </Button>
      </Row>
      <p className="text-[13px] text-neutral-500">
        1 回ずつ順に、{FILL_INTERVAL_MS / 1000} 秒あけて呼ぶ。問題は 20 問の 1 番。待ち時間の上限は {FILL_TIMEOUT_MS / 1000} 秒
      </p>
      {last && (
        <div className="mt-2">
          <p>{last.label}</p>
          <p>{runSummary(last.attempts)}</p>
          <ol className="mt-1 space-y-1 text-[13px] break-all">
            {last.attempts.map((a, i) => (
              <li key={i}>
                {i + 1}: {attemptText(a)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  )
}

// ---- 4. 判定の 20 問 ----

interface CaseRun {
  label: string
  results: Attempt[]
}

const DIRECTION_TEXT = { 'en-ja': '英→日', 'ja-en': '日→英' } as const

function matchCount(results: readonly Attempt[]): number {
  return results.filter((a, i) => a.ok && a.verdict === JUDGE_CASES[i].expected).length
}

function CasesSection({ report, ai }: { report: Report; ai: AiOptions }) {
  const [runs, setRuns] = useState<CaseRun[]>([])
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)

  // 画面を離れたら呼び出しを止める（3. と同じ理由）
  useEffect(() => () => abort.current?.abort(), [])

  const run = async (again: boolean): Promise<void> => {
    const ctl = new AbortController()
    abort.current = ctl
    setRunning(true)
    const index = again ? runs.length : 0
    const fresh: CaseRun = { label: aiLabel(ai), results: [] }
    setRuns((r) => (again ? [...r, fresh] : [fresh]))
    for (let i = 0; i < JUDGE_CASES.length; i++) {
      if (i > 0) await sleep(FILL_INTERVAL_MS, ctl.signal)
      if (ctl.signal.aborted) break
      const a = await tryJudge(JUDGE_CASES[i], ai, ctl.signal)
      if (ctl.signal.aborted) break // 止めた 1 回は記録しない（3. と同じ）
      setRuns((r) => r.map((x, j) => (j === index ? { ...x, results: [...x.results, a] } : x)))
    }
    setRunning(false)
  }

  const first = runs[0]
  const last = runs.length > 1 ? runs[runs.length - 1] : undefined
  // 1 回目と最後の回で判定が変わった問題
  const changed = last
    ? JUDGE_CASES.filter((_, i) => {
        const a = first.results[i]
        const b = last.results[i]
        return a !== undefined && b !== undefined && (a.ok ? a.verdict : a.kind) !== (b.ok ? b.verdict : b.kind)
      }).map((c) => c.no)
    : []

  const verdictText = (a: Attempt | undefined): string => (a === undefined ? '' : a.ok ? a.verdict : `エラー ${a.kind}`)

  const text = runs
    .map((r, n) =>
      [
        `${n + 1} 回目（${r.label}）: 期待と合った数 ${matchCount(r.results)}/${r.results.length}`,
        ...r.results.map((a, i) => {
          const c = JUDGE_CASES[i]
          const reason = a.ok ? `「${a.reason}」${a.better ? ` より自然: ${a.better}` : ''}` : a.message.slice(0, 300)
          return `  ${c.no} ${DIRECTION_TEXT[c.direction]} 答え「${c.answer}」 期待 ${c.expected} → ${verdictText(a)} ${a.ms} ms ${reason}`
        }),
      ].join('\n'),
    )
    .concat(last ? [`1 回目と最後の回で変わった問題: ${changed.length > 0 ? changed.join('・') : 'なし'}`] : [])
    .join('\n')
  useEffect(() => report('cases', text), [report, text])

  return (
    <Section title={TITLES.cases}>
      <p className="text-[13px] text-neutral-500">
        照合を通さず直接 AI で判定する。{FILL_INTERVAL_MS / 1000} 秒あけて 1 問ずつ
      </p>
      {/* 押す前に見えるようにする（3. で最後に選んだ設定のまま走るため） */}
      <p>使う設定: {aiLabel(ai)}（3. で選んだもの）</p>
      <Row>
        <Button onClick={() => void run(false)} disabled={running || ai.apiKey === ''}>
          20 問を判定する
        </Button>
        <Button onClick={() => void run(true)} disabled={running || runs.length === 0}>
          同じものをもう一度
        </Button>
        <Button onClick={() => abort.current?.abort()} disabled={!running}>
          止める
        </Button>
      </Row>
      {runs.map((r, n) => (
        <p key={n}>
          {n + 1} 回目（{r.label}）: 期待と合った数 {matchCount(r.results)}/{r.results.length}
        </p>
      ))}
      {last && <p>1 回目と最後の回で変わった問題: {changed.length > 0 ? changed.join('・') : 'なし'}</p>}
      {first && (
        <div className="mt-2 overflow-x-auto">
          <table className="text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="pr-2">番号</th>
                <th className="pr-2">向き</th>
                <th className="pr-2">答え</th>
                <th className="pr-2">期待</th>
                <th className="pr-2">AI</th>
                {last && <th className="pr-2">最後の回</th>}
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {JUDGE_CASES.map((c, i) => {
                const a = first.results[i]
                return (
                  <tr key={c.no} className="align-top">
                    <td className="pr-2">{c.no}</td>
                    <td className="pr-2">{DIRECTION_TEXT[c.direction]}</td>
                    <td className="pr-2">{c.answer}</td>
                    <td className="pr-2">{c.expected}</td>
                    <td className="pr-2">{verdictText(a)}</td>
                    {last && <td className="pr-2">{verdictText(last.results[i])}</td>}
                    <td className="break-all">{a === undefined ? '' : a.ok ? a.reason : a.message.slice(0, 120)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ---- 5. 日本語入力と改行 ----

type InputMode = 'en' | 'ja'

// 学習の画面と同じ付け替え（英語: lang en・autocorrect off・autocapitalize none・spellcheck false、日本語: lang ja だけ）
function inputAttrs(
  mode: InputMode,
): Pick<InputHTMLAttributes<HTMLInputElement>, 'lang' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck'> {
  return mode === 'en'
    ? { lang: 'en', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false }
    : { lang: 'ja' }
}

function domAttrs(el: HTMLInputElement | null): string {
  if (!el) return ''
  const names = ['lang', 'autocorrect', 'autocapitalize', 'spellcheck', 'enterkeyhint']
  return names.map((n) => `${n}=${el.getAttribute(n) ?? '(無し)'}`).join(' ')
}

function keyText(e: KeyboardEvent<HTMLInputElement>): string {
  return `keydown key=${e.key} keyCode=${e.keyCode} isComposing=${e.nativeEvent.isComposing}`
}

function ImeSection({ report }: { report: Report }) {
  const [lines, add, clear] = useLog()
  const [mode, setMode] = useState<InputMode>('ja')
  const [hint, setHint] = useState<'send' | 'next'>('send')
  const [autoSwap, setAutoSwap] = useState(false)
  const guarded = useRef<HTMLInputElement>(null)
  const plain = useRef<HTMLInputElement>(null)
  const justComposed = useRef(false)
  const busy = useRef(false)

  // 付け替えた後の実際の属性を記録する
  useEffect(() => {
    add(`属性: ${domAttrs(guarded.current)}`)
  }, [add, mode, hint])

  const text = [`送るたびに入れ替える: ${yesNo(autoSwap)}`, ...lines].join('\n')
  useEffect(() => report('ime', text), [report, text])

  // 対策あり: 1. form の submit で送る 2. 変換中の改行の keydown を止める
  // 3. 変換の確定の直後（setTimeout 0 まで）の送信は無視 4. 判定中（ここでは送ってから 1 秒）の送信は無視
  const onGuardedKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229
    const stop = composing && e.key === 'Enter'
    add(`対策あり ${keyText(e)}${stop ? ' → 止めた' : ''}`)
    if (stop) e.preventDefault()
  }

  const onGuardedSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    const value = guarded.current?.value ?? ''
    if (justComposed.current) {
      add(`対策あり submit → 無視（変換の確定の直後） value="${value}"`)
      return
    }
    if (busy.current) {
      add(`対策あり submit → 無視（判定中） value="${value}"`)
      return
    }
    add(`対策あり submit → 送った value="${value}"`)
    if (guarded.current) guarded.current.value = ''
    busy.current = true
    setTimeout(() => {
      busy.current = false
    }, 1000)
    if (autoSwap) setMode((m) => (m === 'en' ? 'ja' : 'en'))
  }

  const onPlainSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    add(`対策なし submit value="${plain.current?.value ?? ''}"`)
    if (plain.current) plain.current.value = ''
  }

  return (
    <Section title={TITLES.ime}>
      <p className="text-[13px] text-neutral-500">
        ローマ字・かなの両方で、変換を確定する改行を試す。送ると欄が空になる（次の問題の代わり）
      </p>
      <form onSubmit={onGuardedSubmit} className="my-2">
        <span className="text-[13px]">対策あり（学習の画面と同じ作り）</span>
        <div className="flex gap-2">
          <input
            ref={guarded}
            {...inputAttrs(mode)}
            enterKeyHint={hint}
            onKeyDown={onGuardedKeyDown}
            onCompositionStart={() => add('対策あり compositionstart')}
            onCompositionEnd={(e) => {
              add(`対策あり compositionend data="${e.data}"`)
              justComposed.current = true
              setTimeout(() => {
                justComposed.current = false
              }, 0)
            }}
            className="min-h-11 flex-1 rounded-lg border border-neutral-400 px-3 dark:border-neutral-600"
          />
          <button type="submit" className="min-h-11 rounded-lg border border-neutral-400 px-3 dark:border-neutral-600">
            送る
          </button>
        </div>
      </form>
      <form onSubmit={onPlainSubmit} className="my-2">
        <span className="text-[13px]">対策なし</span>
        <div className="flex gap-2">
          <input
            ref={plain}
            lang="ja"
            onKeyDown={(e) => add(`対策なし ${keyText(e)}`)}
            onCompositionStart={() => add('対策なし compositionstart')}
            onCompositionEnd={(e) => add(`対策なし compositionend data="${e.data}"`)}
            className="min-h-11 flex-1 rounded-lg border border-neutral-400 px-3 dark:border-neutral-600"
          />
          <button type="submit" className="min-h-11 rounded-lg border border-neutral-400 px-3 dark:border-neutral-600">
            送る
          </button>
        </div>
      </form>
      <p className="text-[13px] text-neutral-500">
        下のボタンは押しても入力欄の選択を外さない。対策ありの欄を選んだまま押し、キーボードが閉じないかを見る
      </p>
      <Row>
        <Button keepFocus onClick={() => setMode('en')} disabled={mode === 'en'}>
          英語に切り替え
        </Button>
        <Button keepFocus onClick={() => setMode('ja')} disabled={mode === 'ja'}>
          日本語に切り替え
        </Button>
        <Button keepFocus onClick={() => setHint((h) => (h === 'send' ? 'next' : 'send'))}>
          改行キーの表示を {hint === 'send' ? 'next' : 'send'} に
        </Button>
      </Row>
      <Row>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={autoSwap} onChange={(e) => setAutoSwap(e.target.checked)} />
          送るたびに英語と日本語を入れ替える（英→日から日→英へ移るときの代わり）
        </label>
      </Row>
      <Row>
        <Button onClick={clear}>記録を消す</Button>
      </Row>
      <Log lines={lines} />
    </Section>
  )
}

// ---- 6. 書き出しと読み込み ----

function ShareSection({ report }: { report: Report }) {
  const [lines, add] = useLog()
  // 共有はタップから 5 秒以内に呼ばないと断られるので、ファイルは画面を開いたときに作っておく
  const [sample] = useState(() => {
    const json = JSON.stringify(
      { app: 'eitango-check', exportedAt: new Date().toISOString(), words: ['give up', 'nerf', 'あきらめる'] },
      null,
      1,
    )
    return { json, file: makeBackupFile(json, new Date()) }
  })
  const shareable = canShareFile(sample.file)

  const onPick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const body = await f.text()
      add(`読んだ: ${f.name}（${f.size} バイト・種類 ${f.type || '(無し)'}）書き出したものと同じ: ${yesNo(body === sample.json)}`)
    } catch (err) {
      add(`読めませんでした: ${errorMessage(err)}`)
    }
  }

  const text = [`ファイル ${sample.file.name}（${sample.file.size} バイト）・共有できるか ${yesNo(shareable)}`, ...lines].join(
    '\n',
  )
  useEffect(() => report('share', text), [report, text])

  return (
    <Section title={TITLES.share}>
      <p>
        {sample.file.name}（{sample.file.size} バイト）・共有できるか {yesNo(shareable)}
      </p>
      <Row>
        <Button onClick={async () => add(`共有 → ${await shareFile(sample.file)}`)}>共有</Button>
        <Button onClick={async () => add(`JSON をコピー → ${(await copyText(sample.json)) ? 'できた' : 'できない'}`)}>
          JSON をコピー
        </Button>
      </Row>
      <label className="my-2 block">
        <span className="text-[13px] text-neutral-500">「ファイル」に保存したものを選ぶ</span>
        <input type="file" accept="application/json,.json" onChange={(e) => void onPick(e)} className="mt-1 block" />
      </label>
      <Log lines={lines} />
    </Section>
  )
}

// ---- 7. 保存 ----

function StorageSection({ report }: { report: Report }) {
  const [lines, add] = useLog()

  useEffect(() => {
    const onVisible = (): void => add(`画面が${document.visibilityState === 'visible' ? '前に戻った' : '裏に回った'}`)
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [add])

  const probe = async (label: string): Promise<void> => {
    try {
      const db = getCheckDb()
      const at = new Date()
      await db.kv.put({ key: 'probe', value: at })
      const row = await db.kv.get('probe')
      const ok = row?.value instanceof Date && row.value.getTime() === at.getTime()
      add(`${label}: ${ok ? '書いて読めた' : '読めた値が違う'}`)
    } catch (e) {
      add(`${label}: 失敗 ${errorMessage(e)}`)
    }
  }

  const text = lines.join('\n')
  useEffect(() => report('storage', text), [report, text])

  return (
    <Section title={TITLES.storage}>
      <p className="text-[13px] text-neutral-500">データベース {CHECK_DB_NAME} に 1 件書いて読む</p>
      <Row>
        <Button onClick={() => void probe('書いて読む')}>書いて読む</Button>
        <Button onClick={() => void probe('裏に回して戻った後')}>裏に回して戻ったら押す</Button>
      </Row>
      <Log lines={lines} />
    </Section>
  )
}

// ---- 8. 更新 ----

function UpdateSection({ report }: { report: Report }) {
  const [lines, add] = useLog()

  const check = async (): Promise<void> => {
    if (!('serviceWorker' in navigator)) {
      add('サービスワーカーが使えない（安全なページでない）')
      return
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) {
        add('登録がありません（開発のビルドか、まだ登録されていない）')
        return
      }
      await reg.update()
      if (reg.installing) add('新しい版を入れています')
      else if (reg.waiting) add('新しい版が待っています（上の「新しい版があります」を押す）')
      else add('新しい版はありません')
    } catch (e) {
      add(`確認できませんでした: ${errorMessage(e)}`)
    }
  }

  const text = [`ビルド ${buildText()}`, ...lines].join('\n')
  useEffect(() => report('update', text), [report, text])

  return (
    <Section title={TITLES.update}>
      <p>ビルド {buildText()}</p>
      <Row>
        <Button onClick={() => void check()}>更新を確認する</Button>
      </Row>
      <Log lines={lines} />
    </Section>
  )
}

// ---- 画面 ----

export default function CheckScreen() {
  const [results, setResults] = useState<Partial<Record<SectionKey, string>>>({})
  const [copyStatus, setCopyStatus] = useState('')
  const [ai, setAiState] = useState<AiOptions>({
    apiKey: '',
    model: DEFAULT_MODEL,
    format: 'responseFormat',
    levelCase: 'upper',
  })

  const report: Report = useCallback(
    (key, text) => setResults((r) => (r[key] === text ? r : { ...r, [key]: text })),
    [],
  )
  const setAi = useCallback((update: (a: AiOptions) => AiOptions) => setAiState(update), [])

  const copyAll = async (): Promise<void> => {
    const text = [
      `動作確認の結果（${new Date().toLocaleString('ja-JP')}）`,
      ...ORDER.map((k) => `## ${TITLES[k]}\n${results[k] || '（まだ試していない）'}`),
    ].join('\n\n')
    setCopyStatus((await copyText(text)) ? 'コピーしました' : 'コピーできませんでした')
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">動作確認</h1>
        <a href="#/" onClick={replaceLink} className="inline-flex min-h-11 items-center px-2 underline">
          戻る
        </a>
      </div>
      <p className="text-[13px] text-neutral-500">ホーム画面に追加したアプリで試す。結果は最後にまとめてコピーできる</p>
      <Row>
        <Button onClick={() => void copyAll()}>結果をコピー</Button>
        <span>{copyStatus}</span>
      </Row>
      <EnvSection report={report} />
      <SpeechSection report={report} ai={ai} />
      <GeminiSection report={report} ai={ai} setAi={setAi} />
      <CasesSection report={report} ai={ai} />
      <ImeSection report={report} />
      <ShareSection report={report} />
      <StorageSection report={report} />
      <UpdateSection report={report} />
      <Row>
        <Button onClick={() => void copyAll()}>結果をコピー</Button>
        <span>{copyStatus}</span>
      </Row>
    </main>
  )
}
