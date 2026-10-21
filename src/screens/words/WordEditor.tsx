// 登録の確認の画面と、編集の画面（仕様書 8-1・9-4）。Word の項目を直す（id・作った日時・AI で補う前の印を除く）。
// 一覧の項目は 1 行に 1 つ。保存のときに applyEdit で決まり（英語か出会った英文を変えたら穴埋めを空にして
// AI で補う前の印を付ける、フレーズにしたら穴埋めを空にする、許容訳に意味を入れる）を当てはめる。
// 許容訳と紛らわしい誤訳の両方にある訳があれば、保存せずに知らせる
import { useState, type ReactNode } from 'react'
import { AREA, BUTTON, EN_INPUT, FIELD, JA_INPUT, NOTE, PRIMARY, SAVE_FAILED } from '../../components/ui.ts'
import { sameJa } from '../../lib/match.ts'
import type { Kind, Word } from '../../lib/types.ts'
import { applyEdit } from '../../lib/words.ts'

interface Draft {
  term: string
  kind: Kind
  context: string
  source: string
  meaning: string
  tone: string
  accepted: string
  nearMiss: string
  acceptedEn: string
  exampleEn: string
  exampleJa: string
  note: string
  cloze: string
  clozeAnswer: string
}

function toDraft(w: Word): Draft {
  return {
    term: w.term,
    kind: w.kind,
    context: w.context ?? '',
    source: w.source ?? '',
    meaning: w.meaning,
    tone: w.tone ?? '',
    accepted: w.accepted.join('\n'),
    nearMiss: w.nearMiss.join('\n'),
    acceptedEn: w.acceptedEn.join('\n'),
    exampleEn: w.exampleEn ?? '',
    exampleJa: w.exampleJa ?? '',
    note: w.note ?? '',
    cloze: w.cloze ?? '',
    clozeAnswer: w.clozeAnswer ?? '',
  }
}

const lines = (text: string): string[] => text.split('\n')

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
  title,
  onSave,
  onCancel,
}: {
  original: Word
  title: string
  onSave: (word: Word) => Promise<void>
  onCancel: () => void
}) {
  const [d, setD] = useState<Draft>(() => toDraft(original))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [key]: e.target.value }))

  const save = async (): Promise<void> => {
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
    const next = applyEdit(original, draft, new Date())
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

  return (
    <section className="py-4">
      <h2 className="font-bold">{title}</h2>
      <Field label="英語（必須）">
        <input value={d.term} onChange={set('term')} {...EN_INPUT} className={FIELD} />
      </Field>
      <Field label="種類">
        <select
          value={d.kind}
          onChange={(e) => setD((x) => ({ ...x, kind: e.target.value === 'phrase' ? 'phrase' : 'word' }))}
          className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
        >
          <option value="word">単語・熟語</option>
          <option value="phrase">フレーズ</option>
        </select>
      </Field>
      <Field label="出会った英文" note="ほかの人の名前は消してから入れる">
        <textarea value={d.context} onChange={set('context')} rows={2} {...EN_INPUT} className={AREA} />
      </Field>
      <Field label="出会った場所（ゲーム名など）">
        <input value={d.source} onChange={set('source')} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="意味（必須）">
        <input value={d.meaning} onChange={set('meaning')} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="口調・使う場面">
        <input value={d.tone} onChange={set('tone')} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="許容訳（1 行に 1 つ）">
        <textarea value={d.accepted} onChange={set('accepted')} rows={3} {...JA_INPUT} className={AREA} />
      </Field>
      <Field label="紛らわしい誤訳（1 行に 1 つ）">
        <textarea value={d.nearMiss} onChange={set('nearMiss')} rows={2} {...JA_INPUT} className={AREA} />
      </Field>
      <Field label="許容する英語（日→英。1 行に 1 つ）">
        <textarea value={d.acceptedEn} onChange={set('acceptedEn')} rows={2} {...EN_INPUT} className={AREA} />
      </Field>
      <Field label="例文">
        <input value={d.exampleEn} onChange={set('exampleEn')} {...EN_INPUT} className={FIELD} />
      </Field>
      <Field label="例文の訳">
        <input value={d.exampleJa} onChange={set('exampleJa')} {...JA_INPUT} className={FIELD} />
      </Field>
      <Field label="メモ">
        <input value={d.note} onChange={set('note')} {...JA_INPUT} className={FIELD} />
      </Field>
      {d.kind === 'word' && (
        <>
          <Field label="穴埋めの文">
            <input value={d.cloze} onChange={set('cloze')} {...EN_INPUT} className={FIELD} />
          </Field>
          <Field label="穴の答え">
            <input value={d.clozeAnswer} onChange={set('clozeAnswer')} {...EN_INPUT} className={FIELD} />
          </Field>
        </>
      )}
      {error && <p className="mt-3 font-bold">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={() => void save()} disabled={saving} className={PRIMARY}>
          保存
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={BUTTON}>
          やめる
        </button>
      </div>
    </section>
  )
}
