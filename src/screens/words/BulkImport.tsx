// まとめて読み込む（仕様書 8-3）。Claude に作ってもらった JSON の配列を貼る。全部読み込むか、何も読み込まないか。
// バックアップからの戻し（置き換え）ではなく追加。同じ語は読み飛ばして数を出す
import { useState } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { AREA, BUTTON, NOTE, SAVE_FAILED } from '../../components/ui.ts'
import { CLAUDE_PROMPT, parseBulk } from '../../lib/bulk.ts'
import { addWords } from '../../lib/db.ts'
import { copyText } from '../../lib/share.ts'

function skippedText(skipped: number): string {
  return skipped > 0 ? `（${skipped} 個は同じ語があったので飛ばしました）` : ''
}

export default function BulkImport() {
  const { db, words, reload } = useAppData()
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const copy = async (): Promise<void> => {
    setCopyStatus((await copyText(CLAUDE_PROMPT)) ? 'コピーしました' : 'コピーできませんでした')
  }

  const load = async (): Promise<void> => {
    const now = new Date()
    const parsed = parseBulk(text, words, now)
    if (!parsed.ok) {
      setStatus(parsed.error)
      return
    }
    if (parsed.words.length === 0) {
      setStatus(parsed.skipped > 0 ? `0 個読み込みました${skippedText(parsed.skipped)}` : '読み込む語がありませんでした')
      return
    }
    setBusy(true)
    try {
      await addWords(db, parsed.words, now)
      await reload()
      setText('')
      setStatus(`${parsed.words.length} 個読み込みました${skippedText(parsed.skipped)}`)
    } catch {
      setStatus(SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="my-2 rounded-lg border border-neutral-400 px-3 dark:border-neutral-600">
      <summary className="flex min-h-11 cursor-pointer items-center">まとめて読み込む</summary>
      <div className="pb-3">
        <p className={NOTE}>頼み方をコピーして Claude に貼り、後ろに英語を並べて渡す。返ってきた JSON をここに貼る</p>
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => void copy()} className={BUTTON}>
            Claude への頼み方をコピー
          </button>
          {copyStatus && <span className={NOTE}>{copyStatus}</span>}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          aria-label="Claude が作った JSON"
          lang="en"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`mt-2 font-mono ${AREA}`}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || text.trim() === ''}
          className={`${BUTTON} mt-2`}
        >
          読み込む
        </button>
        {status && <p className="mt-2 break-all">{status}</p>}
      </div>
    </details>
  )
}
