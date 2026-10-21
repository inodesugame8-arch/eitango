// 答えた後の画面（仕様書 5-1・6-6）。○△×、正しい意味（英→日）か正しい英語（日→英）、自分の答え、
// AI の理由（AI で判定したときだけ）、より自然な言い方（空でなく、正規化すると自分の答えと違うときだけ）、例文、メモ。
// 小さく「判定を直す」と、○ のときだけ「簡単すぎ」。ボタンは押しても入力欄の選択を外さない（改行で「次へ」を続けられる）
import { APPEAL_LABEL, NOTE, VERDICT_COLOR, VERDICT_LABEL, VERDICT_MARK } from '../../components/ui.ts'
import { sameEn, sameJa } from '../../lib/match.ts'
import type { Verdict } from '../../lib/types.ts'
import PlayButton from './PlayButton.tsx'
import type { Result } from './types.ts'

const keep = (e: { preventDefault: () => void }): void => e.preventDefault()

function Line({ label, text, en }: { label: string; text: string | undefined; en?: boolean }) {
  if (text === undefined || text.trim() === '') return null
  return (
    <div className="mt-3">
      <p className={NOTE}>{label}</p>
      <p lang={en ? 'en' : undefined} className="break-words">
        {text}
      </p>
    </div>
  )
}

export default function AnswerView({
  result,
  speakMissed,
  choices,
  choicesOpen,
  onPlay,
  onToggleChoices,
  onAppeal,
  onEasy,
}: {
  result: Result
  speakMissed: boolean
  choices: Verdict[] // 「判定を直す」で出す選択肢（空なら「判定を直す」を出さない）
  choicesOpen: boolean
  onPlay: () => void
  onToggleChoices: () => void
  onAppeal: (to: Verdict) => void
  onEasy: () => void
}) {
  const { verdict, word, q } = result
  const same = q.direction === 'en-ja' ? sameJa : sameEn
  const better =
    result.judgedBy === 'ai' && result.better && !same(result.better, result.answer) ? result.better : undefined
  const clozeAnswer =
    q.mode === 'cloze' && word.clozeAnswer && !sameEn(word.clozeAnswer, word.term) ? word.clozeAnswer : undefined

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`text-4xl font-bold ${VERDICT_COLOR[verdict]}`}>{VERDICT_MARK[verdict]}</span>
        <span className={`text-xl font-bold ${VERDICT_COLOR[verdict]}`}>{VERDICT_LABEL[verdict]}</span>
        {result.easy && <span className={NOTE}>簡単すぎ</span>}
        {q.practice && <span className={NOTE}>練習</span>}
      </div>

      {q.direction === 'ja-en' && <p className={`mt-3 ${NOTE}`}>正しい英語</p>}
      <div className="flex items-start gap-2">
        <p lang="en" className="flex-1 text-2xl font-bold break-words">
          {word.term}
        </p>
        <PlayButton missed={speakMissed} onPlay={onPlay} label="英語を読み上げる" />
      </div>
      {q.direction === 'en-ja' ? (
        <>
          <Line label="正しい意味" text={word.meaning} />
          {word.tone && <p className={NOTE}>{word.tone}</p>}
        </>
      ) : (
        <>
          <Line label="穴の答え" text={clozeAnswer} en />
          <Line label="意味" text={word.meaning} />
        </>
      )}
      <Line label="自分の答え" text={result.answer === '' ? '（わからない）' : result.answer} en={q.direction === 'ja-en'} />
      <Line label="AI の理由" text={result.judgedBy === 'ai' ? result.aiReason : undefined} />
      <Line label="より自然な言い方" text={better} en={q.direction === 'ja-en'} />
      <Line label="例文" text={word.exampleEn} en />
      <Line label="例文の訳" text={word.exampleJa} />
      <Line label="メモ" text={word.note} />

      <div className="mt-4 flex flex-wrap items-center gap-x-4">
        {choices.length > 0 && (
          <button type="button" onClick={onToggleChoices} onMouseDown={keep} className="min-h-11 text-[13px] underline">
            判定を直す
          </button>
        )}
        {verdict === 'correct' && !result.easy && (
          <button type="button" onClick={onEasy} onMouseDown={keep} className="min-h-11 text-[13px] underline">
            簡単すぎ
          </button>
        )}
      </div>
      {choicesOpen && choices.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {choices.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onAppeal(v)}
              onMouseDown={keep}
              className={`min-h-11 rounded-lg border border-current px-3 ${VERDICT_COLOR[v]}`}
            >
              {VERDICT_MARK[v]} {APPEAL_LABEL[v]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
