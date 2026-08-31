// The new UAE Dirham currency symbol — a stylised "D" with two horizontal
// strokes crossing the bowl, per the Central Bank of the UAE's 2025 identity.
// No stable Unicode code point exists yet, so it's drawn as an inline glyph
// sized to match the surrounding digits (1em, currentColor) rather than
// relying on font support.
export default function DirhamSymbol({ className = '', style }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{
        display: 'inline-block',
        height: '0.72em',
        width: '0.72em',
        verticalAlign: '-0.05em',
        flexShrink: 0,
        ...style,
      }}
    >
      <path
        d="M33 12 A 38 38 0 0 1 33 88"
        fill="none"
        stroke="currentColor"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <rect x="24" y="13" width="15" height="74" fill="currentColor" />
      <rect x="12" y="39" width="76" height="10" fill="currentColor" />
      <rect x="12" y="57" width="76" height="10" fill="currentColor" />
    </svg>
  );
}
