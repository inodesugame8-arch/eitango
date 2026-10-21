// 始める前の画面（仕様書 5-1）。今日の分を解き終えた後の画面もこれ（「今日の分は終わりです」と「もっとやる」）
import UpdateBanner from '../../components/UpdateBanner.tsx'
import { BUTTON, LINK, PRIMARY, replaceLink } from '../../components/ui.ts'
import type { StartInfo } from './types.ts'

export default function StartView({
  info,
  more,
  needRefresh,
  onUpdate,
  onStart,
  onAddNew,
  onAddAhead,
}: {
  info: StartInfo
  more: string // 「もっとやる」を押した結果の 1 行
  needRefresh: boolean
  onUpdate: () => void
  onStart: () => void
  onAddNew: () => void
  onAddAhead: () => void
}) {
  return (
    <main className="mx-auto max-w-xl px-4 pb-4">
      {needRefresh && <UpdateBanner onUpdate={onUpdate} />}
      {info.exportDue && (
        <p className="mt-3">
          {info.neverExported ? '登録から 7 日以上、まだ書き出していません。' : '最後の書き出しから 7 日以上たちました。'}
          <a href="#/settings" onClick={replaceLink} className={`${LINK} ml-1`}>
            設定で書き出す
          </a>
        </p>
      )}

      {info.empty ? (
        <div className="mt-8">
          <p>単語を登録すると、ここに問題が出ます</p>
          <a href="#/words" onClick={replaceLink} className={LINK}>
            単語を登録する
          </a>
        </div>
      ) : info.done ? (
        <p className="mt-8 text-xl">今日の分は終わりです</p>
      ) : (
        <div className="mt-8">
          <p className="text-xl">
            復習 {info.reviews} 枚・新しい問題 {info.fresh} 枚{info.ahead > 0 && `・先取り ${info.ahead} 枚`}・約 {info.minutes} 分
          </p>
          <button type="button" onClick={onStart} className={`${PRIMARY} mt-4 w-full`}>
            始める
          </button>
        </div>
      )}

      {!info.empty && (
        <section className="mt-10 border-t border-neutral-300 pt-4 dark:border-neutral-700">
          <h2 className="font-bold">もっとやる</h2>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={onAddNew} className={BUTTON}>
              新しい問題を足す
            </button>
            <button type="button" onClick={onAddAhead} className={BUTTON}>
              先取りで復習する
            </button>
          </div>
          {more && <p className="mt-2">{more}</p>}
        </section>
      )}
    </main>
  )
}
