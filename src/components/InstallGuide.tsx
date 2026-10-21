// iPhone の Safari のタブで開いたときの案内（仕様書 5-4）。ここでは単語やキーを入れさせない。
// Safari のタブの保存データは 7 日間操作が無いと消されうるうえ、ホーム画面のアプリとは保存場所が別で、
// Safari で入れたデータはホーム画面のアプリに出てこないため。
// 手順の言葉は iOS 26 の日本語の iPhone ユーザガイド（「Webサイトをアプリにする」）に合わせる。
// iOS 26 の Safari は、タブのレイアウトが「コンパクト」のとき「共有」を「…」（その他ボタン）の中に入れている。
// 「Webアプリとして開く」をオフで追加すると、アイコンから開いても Safari のタブで開き、この案内がまた出る
export default function InstallGuide() {
  return (
    <main className="mx-auto max-w-xl p-4 pb-safe">
      <h1 className="text-2xl font-bold">英単語</h1>
      <p className="mt-4">ホーム画面に追加してから使います。</p>
      <ol className="mt-4 list-decimal space-y-2 pl-6">
        <li>Safari の下の「…」を押してから、「共有」を押す（タブのレイアウトが「下」か「上」のときは、共有のボタンを押す）</li>
        <li>
          「ホーム画面に追加」を選び、「Webアプリとして開く」がオンになっているのを見てから「追加」を押す（オフで追加すると、アイコンから開いても
          Safari のタブで開き、この案内がまた出ます）
        </li>
        <li>ホーム画面にできたアイコンから開く</li>
      </ol>
      <p className="mt-6 text-[13px] text-neutral-500">
        Safari のタブで入れた単語やキーは、ホーム画面のアプリには出てきません（保存する場所が別のため）。
        また、Safari のタブの保存データは、しばらく使わないと消されることがあります。
      </p>
    </main>
  )
}
