// 答えの入力欄とボタン（仕様書 5-1）。入力欄は 1 つだけで、学習の間ずっと同じ要素のまま使う（作り直すと
// キーボードが閉じ、iPhone はプログラムから選んでもキーボードを出さないため。WebKit bug 195884）。
// 自動修正・大文字化・スペルチェックは向きにかかわらずいつも切り、向きで替えるのは lang と aria-label だけ。
// iPhone の WebKit は入力欄を選んだ時の属性でキーボードの設定を作り、選んだままの欄で autocorrect・autocapitalize・
// spellcheck・enterkeyhint を替えても反映しない（反映するのは inputmode だけ）。学習は英→日から始まる日が多く、
// 付け替えでは日→英の英語の答えに自動修正がかかったままになるため。改行キーの表示も同じ理由でいつも send。
// 改行の誤送信は次の 4 つを重ねて防ぐ:
//   1. 送るのは form の submit で行い、keydown で Enter を見ない
//   2. keydown で isComposing が true か keyCode が 229 の改行は止める
//   3. 変換の確定（compositionend）の直後、setTimeout(0) までの送信は無視する
//   4. 判定を待っている間の送信は無視する（呼ぶ側の onSubmit が状態を見て決める）
import { useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

export default function AnswerForm({
  inputRef,
  value,
  english,
  onChange,
  onFirstInput,
  onSubmit,
  children,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  english: boolean // 英語で答える（日→英）
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
        lang={english ? 'en' : 'ja'}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="send"
        aria-label={english ? '英語の答え' : '日本語の答え'}
        autoComplete="off"
        className="block min-h-11 w-full rounded-lg border border-neutral-400 px-3 dark:border-neutral-600"
      />
      {/* ボタンを押しても入力欄の選択を外さない（キーボードを閉じない）。ボタンごとではなく行の入れ物でまとめて止める。
          この行のボタンは disabled にしない（disabled のボタンを押した mousedown は、ボタンにも入れ物にも届かない） */}
      <div className="mt-2 flex gap-2" onMouseDown={(e) => e.preventDefault()}>
        {children}
      </div>
    </form>
  )
}
