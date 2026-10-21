// 設定（仕様書 5-3・9-3）。変えたらすぐ保存する。読み上げと AI の接続の試しは「動作確認」（#/check）に置く
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { useAppData } from '../app/useAppData.ts'
import { BUTTON, FIELD, NOTE, replaceLink, SAVE_FAILED } from '../components/ui.ts'
import UpdateBanner from '../components/UpdateBanner.tsx'
import { parseBackup, toBackupJson } from '../lib/backup.ts'
import { MODELS, VOICE_RATES } from '../lib/config.ts'
import { replaceAll } from '../lib/db.ts'
import { formatDateTime } from '../lib/day.ts'
import { isPersisted } from '../lib/platform.ts'
import { canShareFile, copyText, makeBackupFile, shareFile } from '../lib/share.ts'
import type { Settings } from '../lib/types.ts'

const NEW_PER_DAY_CHOICES = Array.from({ length: 21 }, (_, i) => i)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-neutral-300 py-4 first:border-t-0 dark:border-neutral-700">
      <h2 className="mb-2 font-bold">{title}</h2>
      {children}
    </section>
  )
}

export default function SettingsScreen() {
  const { db, settings, words, cards, reviews, saveSettings, reload, needRefresh, applyUpdate, checkUpdate } =
    useAppData()
  const [keyDraft, setKeyDraft] = useState(settings.apiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [saveError, setSaveError] = useState('')
  // 書き出しの文字の欄を出すか。欄とコピーの文字は、いつも今の backup.json（押した時の写しを持たない）
  const [showExportText, setShowExportText] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importing, setImporting] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  // 保存が守られているか（画面を開いたときに 1 回読む）。案内を出すのは false のときだけで、分からないときは出さない
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void isPersisted().then((value) => {
      if (alive) setPersisted(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const save = (patch: Partial<Settings>): void => {
    saveSettings(patch).then(
      () => setSaveError(''),
      () => setSaveError(SAVE_FAILED),
    )
  }

  // 共有はタップから 5 秒以内に呼ばないと断られるので、書き出すファイルは画面を開いたときに作っておく（仕様書 9-3）。
  // 書き出しの日時とファイル名の日付は、画面を開いた時刻にする（描画のたびに時刻を取らないため）。
  // キーは書き出しに入れない。キーを打つたびに作り直さないよう、キー以外の項目だけを見る
  const [openedAt] = useState(() => new Date())
  const { model, newWordsPerDay, voiceRate, mutedNoticeShown, lastExportAt } = settings
  const backup = useMemo(() => {
    const json = toBackupJson(
      { words, cards, reviews, settings: { model, newWordsPerDay, voiceRate, mutedNoticeShown, lastExportAt } },
      openedAt,
    )
    return { json, file: makeBackupFile(json, openedAt) }
  }, [words, cards, reviews, model, newWordsPerDay, voiceRate, mutedNoticeShown, lastExportAt, openedAt])

  const onExport = async (): Promise<void> => {
    if (!canShareFile(backup.file)) {
      setShowExportText(true)
      setExportStatus('共有が使えません。下の文字をコピーして、メモなどに貼って保存してください')
      return
    }
    const result = await shareFile(backup.file)
    if (result === 'shared') {
      save({ lastExportAt: new Date() })
      setExportStatus('書き出しました')
    } else if (result === 'cancelled') {
      setExportStatus('')
    } else {
      setShowExportText(true)
      setExportStatus('共有できませんでした。下の文字をコピーして、メモなどに貼って保存してください')
    }
  }

  const onCopy = async (): Promise<void> => {
    if (await copyText(backup.json)) {
      save({ lastExportAt: new Date() })
      setExportStatus('コピーしました')
    } else {
      setExportStatus('コピーできませんでした')
    }
  }

  const onPick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    setImportStatus('') // 前の結果の文を消す
    const input = e.target
    const file = input.files?.[0]
    input.value = '' // 同じファイルをもう一度選べるように
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportStatus('ファイルを読めませんでした')
      return
    }
    const parsed = parseBackup(text)
    if (!parsed.ok) {
      setImportStatus(parsed.error)
      return
    }
    if (!confirm('今のデータを全部置き換えます')) {
      setImportStatus('読み込みをやめました')
      return
    }
    // 終わるまで選び直せないようにする（画面の移動は止めない。setInSession を使うと学習の画面が出るため）
    setImportStatus('読み込んでいます。終わるまでこの画面のままにしてください')
    setImporting(true)
    try {
      // 今の端末のキーは残し、その日のもう一度出す予定は捨てる
      await replaceAll(db, parsed.data, settings.apiKey)
      await reload()
      setImportStatus(`読み込みました（語 ${parsed.data.words.length} 個）`)
    } catch {
      setImportStatus(SAVE_FAILED)
    } finally {
      setImporting(false)
    }
  }

  const onCheckUpdate = async (): Promise<void> => {
    setUpdateStatus('確認しています')
    try {
      await checkUpdate()
      setUpdateStatus('確認しました。新しい版があれば、ここと画面のいちばん上に出ます（少し時間がかかります）')
    } catch {
      setUpdateStatus('確認できませんでした。電波のある所でもう一度押してください')
    }
  }

  const knownModel = MODELS.some((m) => m.id === settings.model)

  return (
    <main className="mx-auto max-w-xl px-4 pb-4">
      {needRefresh && <UpdateBanner onUpdate={() => void applyUpdate()} />}
      {/* スクロールしても見えるように、上の帯（ボタンの高さ 44px と下の線 1px）のすぐ下に貼り付ける */}
      {saveError && (
        <p className="sticky top-[45px] z-10 -mx-4 border-b border-neutral-300 bg-white px-4 py-2 font-bold dark:border-neutral-700 dark:bg-black">
          {saveError}
        </p>
      )}

      <Section title="Gemini のキー">
        <input
          type={showKey ? 'text' : 'password'}
          value={keyDraft}
          onChange={(e) => {
            setKeyDraft(e.target.value)
            save({ apiKey: e.target.value.trim() })
          }}
          aria-label="Gemini のキー"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={FIELD}
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => setShowKey((v) => !v)} className={BUTTON}>
            {showKey ? '隠す' : '表示'}
          </button>
          <span className={NOTE}>この iPhone の中にだけ保存します。書き出しには入りません</span>
        </div>
      </Section>

      <Section title="使うモデル">
        <select
          value={settings.model}
          onChange={(e) => save({ model: e.target.value })}
          aria-label="使うモデル"
          className="min-h-11 w-full rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
        >
          {!knownModel && <option value={settings.model}>{settings.model}（使えなくなったモデル）</option>}
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="1 日の新しい語の数">
        <select
          value={settings.newWordsPerDay}
          onChange={(e) => save({ newWordsPerDay: Number(e.target.value) })}
          aria-label="1 日の新しい語の数"
          className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
        >
          {NEW_PER_DAY_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n} 語
            </option>
          ))}
        </select>
        <p className={`mt-1 ${NOTE}`}>英→日と日→英で、1 語につき 2 問になります</p>
      </Section>

      <Section title="読み上げの速さ">
        <select
          value={settings.voiceRate}
          onChange={(e) => save({ voiceRate: Number(e.target.value) })}
          aria-label="読み上げの速さ"
          className="min-h-11 rounded-lg border border-neutral-400 px-2 dark:border-neutral-600"
        >
          {VOICE_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate.toFixed(1)} 倍
            </option>
          ))}
        </select>
        <p className={`mt-1 ${NOTE}`}>
          声は iPhone の設定の「アクセシビリティ」の中の読み上げの項目の「声」→「英語」で選べます。Zoe などプレミアムの声にすると自然になります
        </p>
      </Section>

      <Section title="書き出し">
        <p className={NOTE}>
          最後の書き出し: {settings.lastExportAt ? formatDateTime(settings.lastExportAt) : 'まだ書き出していません'}
        </p>
        {persisted === false && (
          <p className={`mt-1 ${NOTE}`}>この iPhone では保存が守られていません。書き出しが一番の備えです</p>
        )}
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => void onExport()} className={BUTTON}>
            書き出す
          </button>
          <span className={NOTE}>{backup.file.name}</span>
        </div>
        {exportStatus && <p className="mt-2">{exportStatus}</p>}
        {showExportText && (
          <div className="mt-2">
            <textarea
              readOnly
              value={backup.json}
              rows={6}
              aria-label="書き出した JSON"
              className="block w-full rounded-lg border border-neutral-400 p-2 font-mono dark:border-neutral-600"
            />
            <button type="button" onClick={() => void onCopy()} className={`${BUTTON} mt-2`}>
              コピー
            </button>
          </div>
        )}
      </Section>

      <Section title="読み込み（バックアップから戻す）">
        <p className={NOTE}>今のデータを全部置き換えます。キーはこの iPhone のものを残します</p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onPick(e)}
          disabled={importing}
          aria-label="書き出したファイルを選ぶ"
          className="mt-2 block min-h-11"
        />
        {importStatus && <p className="mt-2 break-all">{importStatus}</p>}
      </Section>

      <Section title="アプリの版">
        <p>
          {formatDateTime(new Date(__BUILD_TIME__))}（コミット {__COMMIT__}）
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={() => void onCheckUpdate()} className={BUTTON}>
            更新を確認する
          </button>
        </div>
        {updateStatus && <p className="mt-2">{updateStatus}</p>}
        {/* 押した所からも見えるように、画面のいちばん上と同じものをここにも出す */}
        {needRefresh && (
          <div className="mt-2">
            <UpdateBanner onUpdate={() => void applyUpdate()} />
          </div>
        )}
        <a href="#/check" onClick={replaceLink} className="mt-4 inline-flex min-h-11 items-center text-[13px] underline">
          動作確認
        </a>
      </Section>
    </main>
  )
}
