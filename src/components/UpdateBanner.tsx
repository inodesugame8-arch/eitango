// 「新しい版があります」の 1 行（仕様書 12 章）。押すと新しい版に切り替える。
// 学習の途中には出さない（出すかどうかは呼ぶ側が決める）
export default function UpdateBanner({ onUpdate }: { onUpdate: () => void }) {
  return (
    <button
      type="button"
      onClick={onUpdate}
      className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-neutral-300 px-4 py-2 text-left dark:border-neutral-700"
    >
      <span>新しい版があります</span>
      <span className="text-[13px] text-neutral-500">押すと切り替えます</span>
    </button>
  )
}
