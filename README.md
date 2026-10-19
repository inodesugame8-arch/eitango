# eitango

自分用の英単語アプリ。出会った英単語・熟語・フレーズを登録し、音声つき・入力式で出題する。答えは Gemini で意味から判定し、間隔反復（FSRS）で次の出題日を決める。iPhone のホーム画面に追加して使う PWA で、データは端末の中だけに保存する。

https://inodesugame8-arch.github.io/eitango/

## 開発

Node.js 22.12 以上（`.nvmrc` は 24）。

```sh
npm ci            # 依存を入れる
npm run dev       # 開発用のサーバー
npm test          # テスト（Vitest）
npm run build     # 型の検査とビルド
npm run lint      # oxlint
```
