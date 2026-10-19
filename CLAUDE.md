# eitango の開発の決まり

iPhone のホーム画面に置く自分用の英単語アプリ（サーバーなしの PWA。Vite・React・TypeScript）。

## 仕様書と計画

- 仕様書と実装計画はこのリポジトリに無い。作業の始めに作者がパスを渡すので、その計画を読んで、書いてあるとおりに進める。
- 進み具合は、コミットのメッセージの頭の作業番号（例 `T07: 1日の区切りを足す`）で見る。始める前に `git log --oneline` で、どの作業まで済んでいるかを確認する。計画のチェック欄は書き換えない。

## 主なコマンド

- `npm ci` … package-lock.json のとおりに依存を入れる
- `npm run dev` … 開発用のサーバー（iPhone から LAN で見るときは `npm run dev -- --host`）
- `npm test` … テスト（Vitest を 1 回走らせて終わる）。`npm run test:watch` は変更のたびに走らせる
- `npm run build` … 型の検査とビルド（`dist/` に出る）
- `npm run lint` … oxlint
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1` … アイコンを作り直す。このファイルは UTF-8 の BOM 付きで保存する（BOM が無いと Windows PowerShell 5.1 が日本語のコメントを読み違えて止まる）

## 決まり

- キー（Gemini の API キーなど）・単語のデータ・個人の事情を、コードとコミットに書かない（公開リポジトリのため）。
- テストは画面の無い部分だけ。コードは `src/lib/` に置き、テストは `src/lib/**/*.test.ts` に書く。時間帯は `vite.config.ts` で Asia/Tokyo に固定してある（アプリは端末の時計で日を数え、GitHub Actions は世界標準時で動くため）。
- 作業の始めに `git pull`（package-lock.json が変わっていれば `npm ci`）。終わりに `npm test` と `npm run build` が通ってから `git push`。main に push すると、GitHub Actions がテストとビルドをして GitHub Pages へ配信する。
