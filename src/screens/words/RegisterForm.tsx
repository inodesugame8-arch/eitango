// 登録欄（仕様書 5-2・8-1・8-2）。「作る」で AI が残りを埋め、確認の画面（WordEditor）で直してから保存する。
// AI が使えないときは、意味を自分で入れれば保存できる（AI で補う前の印を付け、あとで「AI で補う」で埋める）
import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { AREA, BUTTON, EN_INPUT, FIELD, JA_INPUT, NOTE, PRIMARY } from '../../components/ui.ts'
import { FILL_TIMEOUT_MS } from '../../lib/config.ts'
import { applyFill } from '../../lib/fill.ts'
import { callGemini, fillErrorText, GeminiError } from '../../lib/gemini/client.ts'
import { fillPrompt, parseFill } from '../../lib/gemini/prompts.ts'
import { sameEn } from '../../lib/match.ts'
import type { Word } from '../../lib/types.ts'
import { manualWord } from '../../lib/words.ts'

const MANUAL_HINT = '意味を自分で入れて保存し、あとで AI で補えます'
// 「作る」の返事を待つ間に一覧の「編集」を開いていたとき（確認の画面で置き換えず、打ちかけの直しを残す）
const EDITING_OPEN = '編集を閉じてから、もう一度「作る」を押してください'
const LONG_TERM_WORDS = 10

// onConfirm は確認の画面を開いたら true、編集の画面を開いているので開かなかったら false を返す
export default function RegisterForm({ onConfirm }: { onConfirm: (word: Word) => boolean }) {
  const { settings, words } = useAppData()
  const [term, setTerm] = useState('')
  const [context, setContext] = useState('')
  const [meaning, setMeaning] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const abort = useRef<AbortController | null>(null)

  // 画面を離れたら AI の呼び出しを止める
  useEffect(() => () => abort.current?.abort(), [])

  const termWords = term.trim() === '' ? 0 : term.trim().split(/\s+/).length
  const same = term.trim() === '' ? [] : words.filter((w) => sameEn(w.term, term))

  const openConfirm = (word: Word): void => {
    setNotice(onConfirm(word) ? '' : EDITING_OPEN)
  }

  const create = async (): Promise<void> => {
    if (term.trim() === '' || busy) return
    const ctl = new AbortController()
    abort.current = ctl
    setBusy(true)
    setFailure('')
    setNotice('')
    try {
      const parts = fillPrompt({ term, context, meaning })
      const raw = await callGemini({
        apiKey: settings.apiKey,
        model: settings.model,
        ...parts,
        timeoutMs: FILL_TIMEOUT_MS,
        signal: ctl.signal,
      })
      const fill = parseFill(raw)
      const now = new Date()
      openConfirm(applyFill(manualWord({ term, context, meaning }, now), fill, 'new', now))
    } catch (e) {
      if (ctl.signal.aborted) return
      const kind = e instanceof GeminiError ? e.kind : 'bad-response'
      setFailure(`${fillErrorText(kind)}。${MANUAL_HINT}`)
    } finally {
      if (abort.current === ctl) abort.current = null
      setBusy(false)
    }
  }

  return (
    <section className="py-4">
      <h2 className="mb-2 font-bold">登録</h2>
      <label className="block">
        <span className={NOTE}>英語（必須）</span>
        <input value={term} onChange={(e) => setTerm(e.target.value)} {...EN_INPUT} className={`mt-1 ${FIELD}`} />
      </label>
      {termWords > LONG_TERM_WORDS && <p className={`mt-1 ${NOTE}`}>短く区切ると覚えやすい</p>}
      {same.length > 0 && (
        <p className={`mt-1 ${NOTE}`}>同じ英語があります（意味: {same.map((w) => w.meaning).join('・')}）</p>
      )}
      <label className="mt-3 block">
        <span className={NOTE}>出会った英文（任意・おすすめ）</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          {...EN_INPUT}
          className={`mt-1 ${AREA}`}
        />
      </label>
      <p className={`mt-1 ${NOTE}`}>ほかの人の名前は消してから入れる</p>
      <label className="mt-3 block">
        <span className={NOTE}>意味（任意）</span>
        <input value={meaning} onChange={(e) => setMeaning(e.target.value)} {...JA_INPUT} className={`mt-1 ${FIELD}`} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void create()} disabled={busy || term.trim() === ''} className={PRIMARY}>
          {busy ? '作っています' : '作る'}
        </button>
        {failure && (
          <button
            type="button"
            onClick={() => openConfirm(manualWord({ term, context, meaning }, new Date()))}
            disabled={meaning.trim() === '' || term.trim() === ''}
            className={BUTTON}
          >
            意味を自分で入れて保存
          </button>
        )}
      </div>
      {failure && <p className="mt-2">{failure}</p>}
      {notice && <p className="mt-2">{notice}</p>}
    </section>
  )
}
