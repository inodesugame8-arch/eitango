// 登録の確認の画面と、編集の画面（仕様書 8-1・9-4、設計書 2026-11-09 の 3 章）。Word の項目を直す（id・作った日時・AI で補う前の印を除く）。
// 一覧の項目は 1 行に 1 つ。保存のときに applyEdit で決まり（英語か出会った英文を変えたら穴埋めを空にして
// AI で補う前の印を付ける、フレーズにしたら穴埋めを空にする、許容訳に意味を入れる）を当てはめる。
// 「AI で作り直す」は、今の英語・出会った英文・意味を Gemini に送り、この画面で直していない欄と空の欄を作り直す（保存はしない）。
// 作り直したときの英語・出会った英文のまま保存すると、穴埋めを残して AI で補う前の印を外す。
// 許容訳と紛らわしい誤訳の両方にある訳があれば、保存せずに知らせる
// 最後に AI を呼んだときの返事から、英語の欄の下に打ち間違いの知らせと「候補で作り直す」、意味の欄の下に AI が別の意味で
// 作ったかもしれない知らせを出す（設計書 2026-11-10 の 4-2 の 3・5-1）。知らせの材料は語のデータに入れない
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { AREA, BUTTON, EN_INPUT, FIELD, JA_INPUT, NOTE, PRIMARY, SAVE_FAILED } from '../../components/ui.ts'
import { FILL_TIMEOUT_MS } from '../../lib/config.ts'
import { callGemini, fillErrorText, GeminiError } from '../../lib/gemini/client.ts'
import { fillPrompt, parseFill } from '../../lib/gemini/prompts.ts'
import { sameJa } from '../../lib/match.ts'
import { meaningNotice, notesFrom, typoNotice, type AiNotes } from '../../lib/notice.ts'
import { redoFields, toFields, type EditorFields } from '../../lib/redo.ts'
import type { Word } from '../../lib/types.ts'
import { applyEdit, type AiInputs } from '../../lib/words.ts'

const lines = (text: string): string[] => text.split('\n')
const REDO_NOTE = '英語・出会った英文・意味をもとに、この画面で直していない欄と空の欄を作り直します（保存はまだしません）'
const REDO_DONE = '作り直しました。保存はまだです'

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className={NOTE}>{label}</span>
      <div className="mt-1">{children}</div>
      {note && <span className={`mt-1 block ${NOTE}`}>{note}</span>}
    </label>
  )
}

export default function WordEditor({
  original,
  initialNotes,
  title,
  onSave,
  onCancel,
}: {
  original: Word
  initialNotes?: AiNotes
  title: string
  onSave: (word: Word) => Promise<void>
  onCancel: () => void
}) {
  const { settings } = useAppData()
  const [d, setD] = useState<EditorFields>(() => toFields(original))
  // 直した欄を決めるときに比べる値（開いたときの値。作り直した後は、作り直した欄だけ新しい値に替え、残した欄は前のまま）
  const [base, setBase] = useState<EditorFields>(() => toFields(original))
  // 最後に作り直したときに送った英語と出会った英文（保存のときに applyEdit に渡す）
  const [aiFor, setAiFor] = useState<AiInputs | undefined>(undefined)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [redoing, setRedoing] = useState(false)
  const [redoMessage, setRedoMessage] = useState('')
  // 知らせの材料（「作る」の返事から始め、作り直すたびに替える。作り直しに失敗したときは前のまま）
  const [notes, setNotes] = useState<AiNotes | undefined>(initialNotes)
  const abort = useRef<AbortController | null>(null)

  // 画面を閉じたら（保存・やめる・別の画面へ）、AI の呼び出しを止める
  useEffect(() => () => abort.current?.abort(), [])

  const set = (key: keyof EditorFields) => (e: { target: { value: string } }) =>
    setD((x) => ({ ...x, [key]: e.target.value }))

  // term を渡したときは、英語をその値に替えて作り直す（「候補で作り直す」）。失敗したら何も変えない
  const redo = async (term?: string): Promise<void> => {
    if (d.term.trim() === '' || redoing || saving) return
    // 待つ間は欄を書き換えられないので、送る値と、返事を当てはめる値は同じ
    const sent = term === undefined ? d : { ...d, term }
    const ctl = new AbortController()
    abort.current = ctl
    setRedoing(true)
    setRedoMessage('')
    setError('')
    try {
      const raw = await callGemini({
        apiKey: settings.apiKey,
        model: settings.model,
        ...fillPrompt({ term: sent.term, context: sent.context, meaning: sent.meaning }),
        timeoutMs: FILL_TIMEOUT_MS,
        signal: ctl.signal,
      })
      const fill = parseFill(raw)
      const redone = redoFields(sent, base, fill)
      setD(redone.fields)
      setBase(redone.base)
      setAiFor({ term: sent.term, context: sent.context })
      setNotes(notesFrom(sent, fill))
      setRedoMessage(REDO_DONE)
    } catch (e) {
      if (ctl.signal.aborted) return
      const kind = e instanceof GeminiError ? e.kind : 'bad-response'
      setRedoMessage(fillErrorText(kind))
    } finally {
      if (abort.current === ctl) abort.current = null
      setRedoing(false)
    }
  }

  const save = async (): Promise<void> => {
    if (redoing) return
    if (d.term.trim() === '' || d.meaning.trim() === '') {
      setError('英語と意味は必須です')
      return
    }
    const draft: Word = {
      ...original,
      term: d.term,
      kind: d.kind,
      context: d.context,
      source: d.source,
      meaning: d.meaning,
      tone: d.tone,
      accepted: lines(d.accepted),
      nearMiss: lines(d.nearMiss),
      acceptedEn: lines(d.acceptedEn),
      exampleEn: d.exampleEn,
      exampleJa: d.exampleJa,
      note: d.note,
      cloze: d.cloze,
      clozeAnswer: d.clozeAnswer,
    }
    const next = applyEdit(original, draft, new Date(), aiFor)
    // 許容訳（意味を含む）と紛らわしい誤訳の両方にある訳（7-1 の日本語の正規化で同じもの）があれば保存しない。
    // 照合で ○ になり、誤訳の側が効かないため。どちらを残すかは本人が決める
    const both = [...new Set(next.nearMiss.filter((t) => next.accepted.some((a) => sameJa(a, t))))]
    if (both.length > 0) {
      setError(`${both.map((t) => `「${t}」`).join('')}が許容訳と紛らわしい誤訳の両方にあります。どちらかから消してください`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(next)
    } catch {
      setError(SAVE_FAILED)
      setSaving(false)
    }
  }

  const typo = typoNotice(notes, d.term)
  const drift = meaningNotice(notes)

  return (
    <section className="py-4">
      <h2 className="font-bold">{title}</h2>
      <Field label="英語（必須）">
        <input value={d.term} onChange={set('term')} readOnly={redoing} {...EN_INPUT} className={FIELD} />
      </Field>
      {typo && (
        <div className="mt-1">
          <p>
            打ち間違いかもしれません。「{typo.suggestion}」では？{typo.reason !== '' && `（${typo.reason}）`}
          </p>
          <button
            type="button"
            onClick={() => void redo(typo.suggestion)}
            disabled={redoing || saving}
            className={`mt-1 ${BUTTON}`}
          >
            候補で作り直す
          </button>
        </div>
      )}
      <Field label="種類">
        <select
          value={d.kind}
          onChange={(e) => setD((x) => ({ ...x, kind: e.target.value === 'phrase' ? 'phrase' : 'word' }))}
          disabled={redoing}
          className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
        >
          <option value="word">単語・熟語</option>
          <option value="phrase">フレーズ</option>
        </select>
      </Field>
      <Field label="出会った英文" note="ほかの人の名前は消してから入れる">
        <textarea value={d.context} onChange={set('context')} readOnly={redoing} rows={2} {...EN_INPUT} className={AREA} />
      </Field>
      <Field label="出会った場所（ゲーム名など）">
        <input value={d.source} onChange={set('source')} readOnly={redoing} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="意味（必須）">
        <input value={d.meaning} onChange={set('meaning')} readOnly={redoing} {...JA_INPUT} className={FIELD} />
      </Field>
      {drift !== '' && <p className="mt-1">AI は「{drift}」の意味で作ったかもしれません。例文などを確かめてください</p>}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => void redo()}
          disabled={redoing || saving || d.term.trim() === ''}
          className={BUTTON}
        >
          {redoing ? '作り直しています' : 'AI で作り直す'}
        </button>
        <p className={`mt-1 ${NOTE}`}>{REDO_NOTE}</p>
        {redoMessage && <p className="mt-1">{redoMessage}</p>}
      </div>
      <Field label="口調・使う場面">
        <input value={d.tone} onChange={set('tone')} readOnly={redoing} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="許容訳（1 行に 1 つ）">
        <textarea value={d.accepted} onChange={set('accepted')} readOnly={redoing} rows={3} {...JA_INPUT} className={AREA} />
      </Field>
      <Field label="紛らわしい誤訳（1 行に 1 つ）">
        <textarea value={d.nearMiss} onChange={set('nearMiss')} readOnly={redoing} rows={2} {...JA_INPUT} className={AREA} />
      </Field>
      <Field label="許容する英語（日→英。1 行に 1 つ）">
        <textarea value={d.acceptedEn} onChange={set('acceptedEn')} readOnly={redoing} rows={2} {...EN_INPUT} className={AREA} />
      </Field>
      <Field label="例文">
        <input value={d.exampleEn} onChange={set('exampleEn')} readOnly={redoing} {...EN_INPUT} className={FIELD} />
      </Field>
      <Field label="例文の訳">
        <input value={d.exampleJa} onChange={set('exampleJa')} readOnly={redoing} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="メモ">
        <input value={d.note} onChange={set('note')} readOnly={redoing} {...JA_INPUT} className={FIELD} />
      </Field>
      {d.kind === 'word' && (
        <>
          <Field label="穴埋めの文">
            <input value={d.cloze} onChange={set('cloze')} readOnly={redoing} {...EN_INPUT} className={FIELD} />
          </Field>
          <Field label="穴の答え">
            <input value={d.clozeAnswer} onChange={set('clozeAnswer')} readOnly={redoing} {...EN_INPUT} className={FIELD} />
          </Field>
        </>
      )}
      {error && <p className="mt-3 font-bold">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || redoing} className={PRIMARY}>
          保存
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BUTTON}>
          やめる
        </button>
      </div>
    </section>
  )
}
