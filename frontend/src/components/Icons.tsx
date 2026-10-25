interface IconProps {
  size?: number
  className?: string
}

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export const IconSearch = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
)

export const IconCart = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    <circle cx="10" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
  </svg>
)

export const IconUser = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
)

export const IconMenu = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const IconClose = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconCheck = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m5 13 4 4L19 7" />
  </svg>
)

export const IconTruck = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="18" r="1.6" />
    <circle cx="17.5" cy="18" r="1.6" />
  </svg>
)

export const IconShield = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

export const IconPin = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
)

export const IconPhone = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 5.2A2 2 0 0 1 5 3Z" />
  </svg>
)

export const IconArrow = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const IconStar = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z" />
  </svg>
)

export const IconBox = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 4 7v10l8 4 8-4V7z" />
    <path d="M4 7l8 4 8-4M12 11v10" />
  </svg>
)

export const IconClock = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)

export const IconTrash = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)

export const IconEdit = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L20 8l-4-4L4 16z" />
  </svg>
)

export const IconPlus = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconMinus = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
)

export const IconSpark = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v5M12 16v5M4.5 12h5M14.5 12h5M6.7 6.7l3 3M14.3 14.3l3 3M17.3 6.7l-3 3M9.7 14.3l-3 3" />
  </svg>
)

export const IconGoogle = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path
      fill="#4285F4"
      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1a7 7 0 0 1-6.6-4.8H1.4v3A12 12 0 0 0 12 24Z"
    />
    <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6v-3H1.4a12 12 0 0 0 0 10.6l4-3Z" />
    <path
      fill="#EA4335"
      d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.8l4 3A7 7 0 0 1 12 4.8Z"
    />
  </svg>
)

export const IconStore = ({ size, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9h16v11H4zM3 9l2-5h14l2 5" />
    <path d="M9 20v-6h6v6" />
  </svg>
)
