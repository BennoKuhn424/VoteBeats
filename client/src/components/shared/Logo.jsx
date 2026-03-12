/**
 * SpeelDit logo: jukebox icon + "SpeelDit" wordmark.
 * Purple-to-orange gradient, inline SVG, no external files needed.
 */
export default function Logo({ size = 'md', className = '', dark = false }) {
  const sizes = {
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-10',
    xl: 'h-12',
    '2xl': 'h-14 sm:h-16',
  };
  const textColor = dark ? '#ffffff' : '#1a1a2e';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 168 44"
      fill="none"
      preserveAspectRatio="xMinYMid meet"
      className={`${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
      aria-label="SpeelDit"
    >
      <defs>
        <linearGradient id="sdGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8A2BE2" />
          <stop offset="100%" stopColor="#FF8C00" />
        </linearGradient>
      </defs>

      {/* Jukebox arch body */}
      <path d="M4,42 L4,14 C4,5 10,1 22,1 C34,1 40,5 40,14 L40,42 Z"
            stroke="url(#sdGrad)" strokeWidth="2.5" fill="none" />
      {/* Inner arch */}
      <path d="M9,42 L9,16 C9,10 13,7 22,7 C31,7 35,10 35,16 L35,42"
            stroke="url(#sdGrad)" strokeWidth="1" opacity="0.4" fill="none" />

      {/* Centre circle + play triangle */}
      <circle cx="22" cy="23" r="9" fill="url(#sdGrad)" />
      <polygon points="19,18.5 28,23 19,27.5" fill="white" />

      {/* Sound waves */}
      <path d="M43,17 C47,21 47,27 43,31"
            stroke="#FF8C00" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M47,13 C53,18 53,28 47,35"
            stroke="#FF8C00" strokeWidth="2" strokeLinecap="round" opacity="0.55" fill="none" />

      {/* Base bar */}
      <rect x="2" y="41" width="40" height="5" rx="2.5" fill="url(#sdGrad)" />

      {/* Wordmark */}
      <text
        x="58" y="32"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="24"
        fontWeight="700"
      >
        <tspan fill={textColor}>Speel</tspan><tspan fill="#FF8C00">Dit</tspan>
      </text>
    </svg>
  );
}
