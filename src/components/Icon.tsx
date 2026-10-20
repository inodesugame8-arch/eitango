// モノクロの線アイコン 3 つ（再生・設定・開く矢印。仕様書 11 章）。色は文字の色（currentColor）、塗りなし、24px
export type IconName = 'play' | 'settings' | 'chevron'

const GEAR =
  'M19.08 10.23L21.51 10.66L21.51 13.34L19.08 13.77L18.26 15.76L19.67 17.78L17.78 19.67L15.76 18.26L13.77 19.08' +
  'L13.34 21.51L10.66 21.51L10.23 19.08L8.24 18.26L6.22 19.67L4.33 17.78L5.74 15.76L4.92 13.77L2.49 13.34' +
  'L2.49 10.66L4.92 10.23L5.74 8.24L4.33 6.22L6.22 4.33L8.24 5.74L10.23 4.92L10.66 2.49L13.34 2.49L13.77 4.92' +
  'L15.76 5.74L17.78 4.33L19.67 6.22L18.26 8.24Z'

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {name === 'play' && <path d="M8 5.5v13l10.5-6.5z" />}
      {name === 'settings' && (
        <>
          <path d={GEAR} />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
      {name === 'chevron' && <path d="M9 6l6 6-6 6" />}
    </svg>
  )
}
