/**
 * Deterministic product artwork.
 *
 * The demo ships without stock photography, so each product gets a generated
 * illustration derived from its category and SKU. When an admin supplies a real
 * image URL (Supabase Storage later), that image wins and this becomes the
 * fallback for missing photos.
 */

const PALETTES: Record<string, { bg: [string, string]; ink: string; accent: string }> = {
  'school-textbooks': { bg: ['#e7efe3', '#cfdfc8'], ink: '#2c4a37', accent: '#c2542a' },
  'notebooks-registers': { bg: ['#fceedd', '#f6dcbd'], ink: '#7d4a1c', accent: '#2f5d75' },
  'writing-instruments': { bg: ['#e6eef4', '#cfe0ec'], ink: '#1f4459', accent: '#d99a2b' },
  'art-craft': { bg: ['#fae7e2', '#f6d2c6'], ink: '#8a3520', accent: '#4f7359' },
  'office-supplies': { bg: ['#ece9e2', '#ddd7c9'], ink: '#3c4a44', accent: '#c2542a' },
  'exam-competition': { bg: ['#e9e6f2', '#d8d2e8'], ink: '#3f3563', accent: '#d99a2b' },
}

function hash(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) % 100000
  return h
}

function Glyph({ kind, ink, accent }: { kind: string; ink: string; accent: string }) {
  switch (kind) {
    case 'notebooks-registers':
      return (
        <g>
          <rect x="26" y="18" width="52" height="68" rx="5" fill="#fffdf9" stroke={ink} strokeWidth="2.4" />
          <path d="M38 32h28M38 44h28M38 56h20" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          <path d="M26 26h-6M26 42h-6M26 58h-6M26 74h-6" stroke={accent} strokeWidth="3.4" strokeLinecap="round" />
          <rect x="46" y="66" width="22" height="9" rx="4.5" fill={accent} opacity="0.85" />
        </g>
      )
    case 'writing-instruments':
      return (
        <g>
          <path d="M30 84 68 24l14 8-38 60z" fill="#fffdf9" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M30 84l-6 10 12-4z" fill={ink} />
          <path d="M62 33 76 41" stroke={accent} strokeWidth="5" strokeLinecap="round" />
          <path d="M42 66 56 74" stroke={ink} strokeWidth="2" opacity="0.35" />
          <circle cx="24" cy="30" r="4.5" fill={accent} opacity="0.75" />
          <circle cx="88" cy="66" r="3.5" fill={accent} opacity="0.5" />
        </g>
      )
    case 'art-craft':
      return (
        <g>
          <path
            d="M52 20c22 0 34 12 34 30 0 13-9 17-17 17-7 0-9 5-6 10 3 6-2 12-11 12-20 0-38-15-38-34S30 20 52 20Z"
            fill="#fffdf9"
            stroke={ink}
            strokeWidth="2.4"
          />
          <circle cx="40" cy="40" r="5" fill={accent} />
          <circle cx="60" cy="34" r="5" fill={ink} opacity="0.75" />
          <circle cx="70" cy="52" r="5" fill={accent} opacity="0.6" />
          <circle cx="46" cy="60" r="5" fill={ink} opacity="0.4" />
          <path d="M78 78c6-4 14-2 16 4s-3 12-10 11c-6-1-9 3-9 3Z" fill={accent} opacity="0.25" />
        </g>
      )
    case 'office-supplies':
      return (
        <g>
          <rect x="24" y="30" width="62" height="50" rx="5" fill="#fffdf9" stroke={ink} strokeWidth="2.4" />
          <path d="M24 42h62" stroke={ink} strokeWidth="2" />
          <path d="M40 30V18h30v12" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" fill="#fffdf9" />
          <rect x="46" y="50" width="26" height="9" rx="4.5" fill={accent} opacity="0.85" />
          <path d="M34 66h20" stroke={ink} strokeWidth="2" opacity="0.4" strokeLinecap="round" />
        </g>
      )
    case 'exam-competition':
      return (
        <g>
          <rect x="28" y="16" width="52" height="68" rx="5" fill="#fffdf9" stroke={ink} strokeWidth="2.4" />
          <path d="M40 32h28M40 44h28M40 56h16" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <circle cx="72" cy="70" r="15" fill={accent} />
          <path d="m66 70 4.5 4.5L79 65" stroke="#fffdf9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )
    default:
      return (
        <g>
          <path d="M24 34h44l14 12v34H24z" fill="#fffdf9" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M24 34v-8h40v8" stroke={ink} strokeWidth="2.4" />
          <path d="M38 52h30M38 64h20" stroke={ink} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <circle cx="82" cy="24" r="8" fill={accent} opacity="0.8" />
        </g>
      )
  }
}

interface Props {
  sku: string
  categorySlug?: string | null
  imageUrl?: string | null
  alt: string
  className?: string
}

export function ProductArt({ sku, categorySlug, imageUrl, alt, className }: Props) {
  if (imageUrl) {
    return <img src={imageUrl} alt={alt} loading="lazy" className={className} />
  }
  const kind = categorySlug && PALETTES[categorySlug] ? categorySlug : 'default'
  const palette = PALETTES[kind] ?? { bg: ['#efe9dd', '#e2d9c9'], ink: '#3c4a44', accent: '#c2542a' }
  const rotation = (hash(sku) % 7) - 3
  const gradientId = `art-${hash(sku)}`

  return (
    <div
      className={`art ${className ?? ''}`}
      style={{ background: `linear-gradient(150deg, ${palette.bg[0]}, ${palette.bg[1]})` }}
      role="img"
      aria-label={alt}
    >
      <svg viewBox="0 0 110 100" style={{ transform: `rotate(${rotation}deg)` }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Glyph kind={kind} ink={palette.ink} accent={palette.accent} />
      </svg>
    </div>
  )
}
