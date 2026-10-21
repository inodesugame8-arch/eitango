// 一覧の 1 行（仕様書 5-2）。意味を隠し、英語と再生ボタンだけを出す。再生ボタン以外の所を押すと、その場で
// 意味・口調・例文・メモ・出会った場所が開く。再生ボタンを押しても行は開かない。見た結果は記録せず、出題日も変えない
import Icon from '../../components/Icon.tsx'
import { BUTTON, NOTE } from '../../components/ui.ts'
import { speak } from '../../lib/speech.ts'
import type { Word } from '../../lib/types.ts'

function Item({ label, text, en }: { label: string; text: string | undefined; en?: boolean }) {
  if (text === undefined || text.trim() === '') return null
  return (
    <div className="mt-2">
      <div className={NOTE}>{label}</div>
      <div lang={en ? 'en' : undefined} className="break-words">
        {text}
      </div>
    </div>
  )
}

export default function WordRow({
  word,
  open,
  rate,
  onToggle,
  onEdit,
  onDelete,
}: {
  word: Word
  open: boolean
  rate: number
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="border-b border-neutral-300 dark:border-neutral-700">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-11 flex-1 items-center gap-2 py-2 text-left"
        >
          <Icon name="chevron" className={`shrink-0 ${open ? 'rotate-90' : ''}`} />
          <span lang="en" className="break-words">
            {word.term}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void speak(word.term, rate)}
          aria-label={`${word.term} を読み上げる`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center"
        >
          <Icon name="play" />
        </button>
      </div>
      {open && (
        <div className="pb-3 pl-8">
          <Item label="意味" text={word.meaning} />
          <Item label="口調・使う場面" text={word.tone} />
          <Item label="例文" text={word.exampleEn} en />
          <Item label="例文の訳" text={word.exampleJa} />
          <Item label="メモ" text={word.note} />
          <Item label="出会った場所" text={word.source} />
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={onEdit} className={BUTTON}>
              編集
            </button>
            <button type="button" onClick={onDelete} className={BUTTON}>
              削除
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
