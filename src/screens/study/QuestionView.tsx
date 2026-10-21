// 出題中の画面（仕様書 5-1 の表の 4 通り）。日→英には再生ボタンを置かない（答えが分かってしまうため）
import { NOTE } from '../../components/ui.ts'
import PlayButton from './PlayButton.tsx'
import type { Question } from './types.ts'

export default function QuestionView({
  q,
  speakMissed,
  hintShown,
  onPlay,
  onHint,
}: {
  q: Question
  speakMissed: boolean
  hintShown: boolean
  onPlay: () => void
  onHint: () => void
}) {
  const { word } = q
  return (
    <div>
      {q.practice && <p className={NOTE}>練習（次に出す日は変わりません）</p>}
      {q.mode === 'en-ja' ? (
        <>
          <div className="flex items-start gap-2">
            <p lang="en" className="flex-1 text-3xl font-bold break-words">
              {word.term}
            </p>
            <PlayButton missed={speakMissed} onPlay={onPlay} label="英語を読み上げる" />
          </div>
          {word.context && (
            <p lang="en" className="mt-2 break-words text-neutral-500">
              {word.context}
            </p>
          )}
          <p className={`mt-3 ${NOTE}`}>日本語で意味を入れる</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold break-words">{word.meaning}</p>
          {word.tone && <p className={`mt-1 ${NOTE}`}>{word.tone}</p>}
          {q.mode === 'cloze' && (
            <p lang="en" className="mt-3 text-xl break-words">
              {word.cloze}
            </p>
          )}
          <p className={`mt-3 ${NOTE}`}>
            {q.mode === 'cloze' ? '穴に入る英語を入れる' : q.mode === 'phrase' ? '英語の全文を入れる' : '英語で入れる'}
          </p>
          {q.mode === 'phrase' &&
            q.scramble.length > 1 &&
            (hintShown ? (
              <p lang="en" className="mt-2 flex flex-wrap gap-2">
                {q.scramble.map((w, i) => (
                  <span key={i} className="rounded border border-neutral-400 px-2 py-1 dark:border-neutral-600">
                    {w}
                  </span>
                ))}
              </p>
            ) : (
              <button
                type="button"
                onClick={onHint}
                onMouseDown={(e) => e.preventDefault()}
                className="mt-2 min-h-11 text-[13px] underline"
              >
                並べ替えヒント
              </button>
            ))}
        </>
      )}
    </div>
  )
}
