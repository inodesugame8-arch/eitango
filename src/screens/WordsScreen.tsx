// 単語（仕様書 5-2・8 章・9-4）。上に登録欄、その下に「まとめて読み込む」「AI で補う」と一覧
import { useLayoutEffect, useRef, useState } from 'react'
import { useAppData } from '../app/useAppData.ts'
import { SAVE_FAILED } from '../components/ui.ts'
import { addWord, deleteWord, updateWord } from '../lib/db.ts'
import type { Word } from '../lib/types.ts'
import BulkImport from './words/BulkImport.tsx'
import FillBanner from './words/FillBanner.tsx'
import RegisterForm from './words/RegisterForm.tsx'
import WordEditor from './words/WordEditor.tsx'
import WordList from './words/WordList.tsx'

const NOT_SAVED = '保存しませんでした。AI で補ったか、ほかで変わったので、もう一度開いて直してください'
// 書けた後に、一覧の読み直しだけ失敗したとき
const RELOAD_FAILED = '保存しました。一覧を読み直せないので、アプリを閉じて開き直してください'

type Editing = { word: Word; isNew: boolean }

export default function WordsScreen() {
  const { db, reload } = useAppData()
  const [editing, setEditing] = useState<Editing | null>(null)
  // 保存したら登録欄を作り直して空にする（やめたときは入れた値を残す）
  const [formKey, setFormKey] = useState(0)
  const [message, setMessage] = useState('')
  // 編集の画面を開いているか。「作る」の返事が来たときに見る（返事を待つ間に描き直されても、今の値を読めるように ref に置く）
  const editingOpen = useRef(false)
  // 一覧の「編集」を押したときのスクロールの位置（保存できた・やめたときに戻す）
  const listY = useRef(0)
  // 編集の画面を閉じた後に戻すスクロールの位置
  const scrollAfterClose = useRef<number | null>(null)

  // 編集の画面を閉じて描き直した後に、決めておいた位置へスクロールする
  useLayoutEffect(() => {
    editingOpen.current = editing !== null
    const y = scrollAfterClose.current
    scrollAfterClose.current = null
    if (editing || y === null) return
    const id = requestAnimationFrame(() => window.scrollTo(0, y))
    return () => cancelAnimationFrame(id)
  }, [editing])

  // 編集の画面を閉じる（id の語の画面のときだけ）。y は閉じた後に戻すスクロールの位置
  const close = (id: string, y: number): void => {
    scrollAfterClose.current = y
    setEditing((cur) => (cur?.word.id === id ? null : cur))
  }

  const onSave = async (word: Word): Promise<void> => {
    // 編集の画面（WordEditor）は editing があるときだけ出る
    if (!editing) return
    const { isNew } = editing
    // 書き込みに失敗したら投げて、編集の画面に「保存できませんでした…」を出す（WordEditor）
    if (isNew) {
      // 語とカード 2 枚（英→日・日→英）を 1 つのトランザクションで
      await addWord(db, word, new Date())
      setFormKey((k) => k + 1)
    } else {
      // 今の行が、編集を開いたときの語のままのときだけ書く（開いている間に AI で補った内容を古い写しで消さない。
      // 消した語をカード無しで戻さない）
      const original = editing.word
      const ok = await updateWord(db, word.id, (cur) =>
        cur.updatedAt.getTime() === original.updatedAt.getTime() ? word : undefined,
      )
      if (!ok) {
        await reload()
        // 知らせが見えるように、いちばん上へ
        close(word.id, 0)
        setMessage(NOT_SAVED)
        return
      }
    }
    // 書けた後の読み直しは分ける。読み直しだけ失敗しても語は保存してあるので、編集を閉じていちばん上で知らせる
    // （編集の画面のまま「保存できませんでした」を出すと、押し直しでもう一度書こうとするため）
    try {
      await reload()
    } catch {
      close(word.id, 0)
      setMessage(RELOAD_FAILED)
      return
    }
    // 新しい語は登録欄（いちばん上）へ、一覧の語は編集を開く前の位置へ戻す
    close(word.id, isNew ? 0 : listY.current)
    setMessage(`「${word.term}」を保存しました`)
  }

  const onDelete = async (word: Word): Promise<void> => {
    if (!confirm(`「${word.term}」を削除します。解答記録は残ります`)) return
    try {
      // 語とカード 2 枚と、もう一度出す予定を消す。解答記録は残す（仕様書 9-4）
      await deleteWord(db, word.id)
      await reload()
      setMessage(`「${word.term}」を削除しました`)
    } catch {
      setMessage(SAVE_FAILED)
      // 知らせが見えるように、いちばん上へ
      window.scrollTo(0, 0)
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-4">
      {editing && (
        <WordEditor
          key={editing.word.id}
          original={editing.word}
          title={editing.isNew ? '確認して保存' : '編集'}
          onSave={onSave}
          onCancel={() => close(editing.word.id, editing.isNew ? 0 : listY.current)}
        />
      )}
      <div className={editing ? 'hidden' : undefined}>
        <RegisterForm
          key={formKey}
          onConfirm={(word) => {
            // 「作る」の返事を待つ間に一覧の「編集」を開いていたら、確認の画面で置き換えない（打ちかけの直しを消さない）
            if (editingOpen.current) return false
            setMessage('')
            setEditing((cur) => cur ?? { word, isNew: true })
            // 確認の画面は見出しから見えるように、いちばん上から
            window.scrollTo(0, 0)
            return true
          }}
        />
        {message && <p className="mb-2">{message}</p>}
        <BulkImport />
        <FillBanner />
        <WordList
          onEdit={(word) => {
            setMessage('')
            // 保存できた・やめたときに戻すので、今のスクロールの位置を覚えておく
            listY.current = window.scrollY
            setEditing({ word, isNew: false })
            window.scrollTo(0, 0)
          }}
          onDelete={(word) => void onDelete(word)}
        />
      </div>
    </main>
  )
}
