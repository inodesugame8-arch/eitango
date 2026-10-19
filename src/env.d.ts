/// <reference types="vite-plugin-pwa/react" />

// vite.config.ts の define でビルドのときに埋め込む値
declare const __BUILD_TIME__: string // ビルドの日時（ISO 形式）
declare const __COMMIT__: string // コミットの先頭 7 文字（分からなければ dev）
