// 一覧（仕様書 5-2）。並びは「最近まちがえた順」「新しい順」の切り替えだけ
import { useMemo, useState } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { BUTTON, NOTE } from '../../components/ui.ts'
import type { Word } from '../../lib/types.ts'
import { sortWords, type WordOrder } from '../../lib/words.ts'
import WordRow from './WordRow.tsx'

const ORDERS: readonly { id: WordOrder; label: string }[] = [
  { id: 'wrong', label: '最近まちがえた順' },
  { id: 'new', label: '新しい順' },
]

export default function WordList({ onEdit, onDelete }: { onEdit: (w: Word) => void; onDelete: (w: Word) => void }) {
  const { words, reviews, settings } = useAppData()
  const [order, setOrder] = useState<WordOrder>('wrong')
  const [openId, setOpenId] = useState<string | null>(null)
  const sorted = useMemo(() => sortWords(words, reviews, order), [words, reviews, order])

  return (
    <section className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">一覧（{words.length} 語）</h2>
        <div className="flex gap-2">
          {/* 選んでいる方は、枠を文字の色にして太字に（BUTTON の枠の色に負けないよう ! を付ける） */}
          {ORDERS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={order === o.id}
              onClick={() => setOrder(o.id)}
              className={`${BUTTON} ${order === o.id ? 'border-current! font-bold' : ''}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className={`mt-2 ${NOTE}`}>まだ単語がありません</p>
      ) : (
        <ul className="mt-2">
          {sorted.map((w) => (
            <WordRow
              key={w.id}
              word={w}
              open={openId === w.id}
              rate={settings.voiceRate}
              onToggle={() => setOpenId((id) => (id === w.id ? null : w.id))}
              onEdit={() => onEdit(w)}
              onDelete={() => onDelete(w)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
