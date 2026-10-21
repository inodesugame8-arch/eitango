// AI が使えなかったときの、自分で ○△× を選ぶ画面（仕様書 5-1・7-4）。正しい意味（日→英は正しい英語）を出す。
// ○△× のボタンは入力欄の下（AnswerForm）に置く。選ぶまでは改行キーで先へ進まない
import { NOTE } from '../../components/ui.ts'
import type { Attempt } from './types.ts'

export default function SelfGradeView({ attempt, message }: { attempt: Attempt; message: string }) {
  const { q } = attempt
  return (
    <div>
      {message && <p className="mb-3">{message}</p>}
      {q.direction === 'en-ja' ? (
        <>
          <p lang="en" className="text-xl font-bold break-words">
            {q.word.term}
          </p>
          <p className={`mt-3 ${NOTE}`}>正しい意味</p>
          <p className="text-2xl font-bold break-words">{q.word.meaning}</p>
          {q.word.tone && <p className={NOTE}>{q.word.tone}</p>}
        </>
      ) : (
        <>
          <p className="break-words">{q.word.meaning}</p>
          <p className={`mt-3 ${NOTE}`}>正しい英語</p>
          <p lang="en" className="text-2xl font-bold break-words">
            {q.mode === 'cloze' && q.word.clozeAnswer ? q.word.clozeAnswer : q.word.term}
          </p>
        </>
      )}
      <p className={`mt-3 ${NOTE}`}>自分の答え</p>
      <p className="break-words">{attempt.answer}</p>
      <p className={`mt-3 ${NOTE}`}>自分で ○△× を選んでください</p>
    </div>
  )
}
