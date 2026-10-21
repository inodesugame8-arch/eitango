// 「AI で補う語が N 個」（仕様書 5-2・8-4）。押すと、AI で補う前の印の付いた語を古い順に 1 つずつ Gemini に送り、
// 確認の画面は出さずにそのまま保存する。本人が入れた意味と種類は変えない。1 つでも失敗したらそこで止め、
// できた分は保存したまま「残り N 個」と理由を出す。送る前に今の行を読み直し、押した後に消した語は呼ばずに飛ばし、
// 直した語は直した中身で送る。Gemini に送った後に消した・直した語は、書かずに飛ばす（エラーにはしない）
import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { BUTTON, SAVE_FAILED } from '../../components/ui.ts'
import { FILL_INTERVAL_MS, FILL_TIMEOUT_MS } from '../../lib/config.ts'
import { updateWord } from '../../lib/db.ts'
import { applyFill } from '../../lib/fill.ts'
import { callGemini, fillErrorText, GeminiError } from '../../lib/gemini/client.ts'
import { fillPrompt, parseFill } from '../../lib/gemini/prompts.ts'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export default function FillBanner() {
  const { db, words, settings, reload } = useAppData()
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const abort = useRef<AbortController | null>(null)

  // 画面を離れたら止める（できた分は保存してある）
  useEffect(() => () => abort.current?.abort(), [])

  const targets = words.filter((w) => w.needsAi)
  if (targets.length === 0 && !running && status === '') return null

  const run = async (): Promise<void> => {
    const list = [...targets].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    const ctl = new AbortController()
    abort.current = ctl
    setRunning(true)
    setStatus('')
    let done = 0 // 補った数
    let skipped = 0 // 途中で消したか直したので飛ばした数
    let called = false // Gemini を 1 回でも呼んだか（呼ぶ間隔をあけるため）
    try {
      for (const w of list) {
        if (ctl.signal.aborted) return
        // 送る前に今の行を読み直す。押した後に消した語・もう補った語は、呼ばずに飛ばす。直した語は直した中身で送る
        // （押した時点の写しを送らない。名前を消した英文の古い写しを送らないため）
        const cur = await db.words.get(w.id)
        if (!cur || !cur.needsAi) {
          skipped += 1
          continue
        }
        // 呼ぶ間隔をあける（1 分あたりの回数の上限に当たらないように）
        if (called) await sleep(FILL_INTERVAL_MS, ctl.signal)
        if (ctl.signal.aborted) return
        setStatus(`補っています（${done + skipped + 1}/${list.length}）`)
        called = true
        const raw = await callGemini({
          apiKey: settings.apiKey,
          model: settings.model,
          ...fillPrompt({ term: cur.term, context: cur.context, meaning: cur.meaning }),
          timeoutMs: FILL_TIMEOUT_MS,
          signal: ctl.signal,
        })
        const fill = parseFill(raw)
        // 送ったときのままのときだけ書く（送った後に消した語は戻さず、直した語は古い中身で上書きしない）
        const ok = await updateWord(db, w.id, (latest) =>
          latest.updatedAt.getTime() === cur.updatedAt.getTime()
            ? applyFill(latest, fill, 'supplement', new Date())
            : undefined,
        )
        if (ok) {
          done += 1
          // 一覧を今の行にする（補い終えた語を、補っている途中に開いて直せるように）
          await reload().catch(() => undefined)
        } else skipped += 1
      }
      const skippedNote = skipped > 0 ? `（${skipped} 個は途中で消したか直したので飛ばしました）` : ''
      setStatus(`${done} 個を補いました${skippedNote}`)
    } catch (e) {
      if (ctl.signal.aborted) return
      const reason = e instanceof GeminiError ? fillErrorText(e.kind) : SAVE_FAILED
      // 残りは、処理した数（補った数と飛ばした数の和）から出す
      setStatus(`残り ${list.length - done - skipped} 個。${reason}`)
    } finally {
      if (abort.current === ctl) abort.current = null
      setRunning(false)
      if (done > 0) await reload().catch(() => undefined)
    }
  }

  return (
    <section className="my-2 rounded-lg border border-neutral-400 p-3 dark:border-neutral-600">
      {targets.length > 0 && <p>AI で補う語が {targets.length} 個</p>}
      {targets.length > 0 && (
        <button type="button" onClick={() => void run()} disabled={running} className={`${BUTTON} mt-2`}>
          AI で補う
        </button>
      )}
      {status && <p className="mt-2">{status}</p>}
    </section>
  )
}
