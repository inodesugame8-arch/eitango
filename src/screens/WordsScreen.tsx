// 単語（仕様書 5-2・8 章・9-4）。上に登録欄、その下に「まとめて読み込む」「AI で補う」と一覧
import { useState } from 'react'
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

type Editing = { word: Word; isNew: boolean }

export default function WordsScreen() {
  const { db, reload } = useAppData()
  const [editing, setEditing] = useState<Editing | null>(null)
  // 保存したら登録欄を作り直して空にする（やめたときは入れた値を残す）
  const [formKey, setFormKey] = useState(0)
  const [message, setMessage] = useState('')

  const onSave = async (word: Word): Promise<void> => {
    // 編集の画面（WordEditor）は editing があるときだけ出る
    if (!editing) return
    if (editing.isNew) {
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
        setEditing(null)
        setMessage(NOT_SAVED)
        return
      }
    }
    await reload()
    setEditing(null)
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
          onCancel={() => setEditing(null)}
        />
      )}
      <div className={editing ? 'hidden' : undefined}>
        <RegisterForm
          key={formKey}
          onConfirm={(word) => {
            setMessage('')
            setEditing({ word, isNew: true })
          }}
        />
        {message && <p className="mb-2">{message}</p>}
        <BulkImport />
        <FillBanner />
        <WordList
          onEdit={(word) => {
            setMessage('')
            setEditing({ word, isNew: false })
            window.scrollTo(0, 0)
          }}
          onDelete={(word) => void onDelete(word)}
        />
      </div>
    </main>
  )
}
