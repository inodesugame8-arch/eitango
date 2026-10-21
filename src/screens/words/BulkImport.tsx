// まとめて読み込む（仕様書 8-3）。Claude に作ってもらった JSON の配列を貼る。全部読み込むか、何も読み込まないか。
// バックアップからの戻し（置き換え）ではなく追加。同じ語は読み飛ばして数を出す
import { useState } from 'react'
import { useAppData } from '../../app/useAppData.ts'
import { AREA, BUTTON, NOTE, SAVE_FAILED } from '../../components/ui.ts'
import { CLAUDE_PROMPT, parseBulk, type ParseBulkResult } from '../../lib/bulk.ts'
import { addWords } from '../../lib/db.ts'
import { copyText } from '../../lib/share.ts'

// 書けた後に、一覧の読み直しだけ失敗したとき
const RELOAD_FAILED = '読み込みました。一覧を読み直せないので、アプリを閉じて開き直してください'

function skippedText(skipped: number): string {
  return skipped > 0 ? `（${skipped} 個は同じ語があったので飛ばしました）` : ''
}

export default function BulkImport() {
  const { db, reload } = useAppData()
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const copy = async (): Promise<void> => {
    setCopyStatus((await copyText(CLAUDE_PROMPT)) ? 'コピーしました' : 'コピーできませんでした')
  }

  const load = async (): Promise<void> => {
    const now = new Date()
    setBusy(true)
    try {
      let parsed: ParseBulkResult
      try {
        // 同じ語の見分けは、画面の一覧ではなく、押した時点で DB から読んだ語で行う（書けた後に一覧を読み直せず、
        // 画面の一覧が古いまま押し直しても、同じ語を 2 回入れないように）
        parsed = parseBulk(text, await db.words.toArray(), now)
        if (parsed.ok && parsed.words.length > 0) await addWords(db, parsed.words, now)
      } catch {
        setStatus(SAVE_FAILED)
        return
      }
      if (!parsed.ok) {
        setStatus(parsed.error)
        return
      }
      if (parsed.words.length === 0) {
        setStatus(parsed.skipped > 0 ? `0 個読み込みました${skippedText(parsed.skipped)}` : '読み込む語がありませんでした')
        return
      }
      // 書けたら、すぐに貼った文字を消す（この後の一覧の読み直しが失敗しても、同じ JSON のまま押し直せないように）
      setText('')
      setStatus(`${parsed.words.length} 個読み込みました${skippedText(parsed.skipped)}`)
      try {
        await reload()
      } catch {
        setStatus(RELOAD_FAILED)
      }
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
