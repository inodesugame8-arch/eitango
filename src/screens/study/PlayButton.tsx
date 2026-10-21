// 再生ボタン（仕様書 10 章）。読み上げが 1.5 秒たっても始まらなければ（missed）、枠を付けて目立たせる。
// 押しても入力欄の選択を外さない（キーボードを閉じない）
import Icon from '../../components/Icon.tsx'

export default function PlayButton({ missed, onPlay, label }: { missed: boolean; onPlay: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      onMouseDown={(e) => e.preventDefault()}
      aria-label={label}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg ${
        missed ? 'border-2 border-current px-2 font-bold' : ''
      }`}
    >
      <Icon name="play" />
      {missed && <span className="text-[13px]">再生</span>}
    </button>
  )
}
