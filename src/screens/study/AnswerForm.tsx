// 答えの入力欄とボタン（仕様書 5-1）。入力欄は 1 つだけで、学習の間ずっと同じ要素のまま使う（作り直すと
// キーボードが閉じ、iPhone はプログラムから選んでもキーボードを出さないため。WebKit bug 195884）。
// 向きが変わったら同じ入力欄の属性を付け替える。改行の誤送信は次の 4 つを重ねて防ぐ:
//   1. 送るのは form の submit で行い、keydown で Enter を見ない
//   2. keydown で isComposing が true か keyCode が 229 の改行は止める
//   3. 変換の確定（compositionend）の直後、setTimeout(0) までの送信は無視する
//   4. 判定を待っている間の送信は無視する（呼ぶ側の onSubmit が状態を見て決める）
import { useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { EN_INPUT, JA_INPUT } from '../../components/ui.ts'

export default function AnswerForm({
  inputRef,
  value,
  english,
  answered,
  onChange,
  onFirstInput,
  onSubmit,
  children,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  english: boolean // 英語で答える（日→英）
  answered: boolean // 答えた後（改行キーの表示を next に）
  onChange: (value: string) => void
  onFirstInput: () => void // 入力欄に最初の文字が入った（変換の始まりを含む）
  onSubmit: () => void
  children: ReactNode // その時のボタン
}) {
  const justComposed = useRef(false)

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (justComposed.current) return
    onSubmit()
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
  }

  return (
    <form onSubmit={submit} className="border-t border-neutral-300 px-4 pt-2 pb-safe dark:border-neutral-700">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          if (e.target.value !== '') onFirstInput()
          onChange(e.target.value)
        }}
        onKeyDown={keyDown}
        onCompositionStart={onFirstInput}
        onCompositionEnd={() => {
          justComposed.current = true
          setTimeout(() => {
            justComposed.current = false
          }, 0)
        }}
        {...(english ? EN_INPUT : JA_INPUT)}
        enterKeyHint={answered ? 'next' : 'send'}
        aria-label={english ? '英語の答え' : '日本語の答え'}
        autoComplete="off"
        className="block min-h-11 w-full rounded-lg border border-neutral-400 px-3 dark:border-neutral-600"
      />
      <div className="mt-2 flex gap-2">{children}</div>
    </form>
  )
}
