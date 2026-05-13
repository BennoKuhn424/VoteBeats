/**
 * Speeldit logo — inline SVG.
 *
 * Wordmark fill is `currentColor` so it inherits the parent's text color.
 * - Default colour follows Tailwind's `dark:` variant — fine for venue pages
 *   that obey the theme toggle (light or dark).
 * - Public pages (CustomerVoting, dark Home variants) sit on a dark
 *   background without setting the `dark` class on <html>; pass `forceLight`
 *   to force a white wordmark on those.
 *
 * The decorative note icons keep their brand pink/purple fills on every
 * background — they read fine on light and dark.
 */
export default function Logo({ size = 'md', className = '', forceLight = false }) {
  const sizes = {
    sm: 'h-8',
    md: 'h-10',
    lg: 'h-14',
    xl: 'h-28',
    '2xl': 'w-full max-w-[300px] sm:max-w-sm h-auto',
  };

  const colorClass = forceLight
    ? 'text-white'
    : 'text-[#3D006E] dark:text-white';

  return (
    <span
      role="img"
      aria-label="Speeldit"
      className={`inline-flex items-center justify-center ${colorClass} ${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 204 66"
        fill="none"
        className="h-full w-auto"
        aria-hidden="true"
      >
        <g transform="translate(33,33)">
          <g transform="rotate(0)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#EC1E8C" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#EC1E8C" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#EC1E8C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(45)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#7012D4" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#7012D4" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#7012D4" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(90)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#EC1E8C" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#EC1E8C" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#EC1E8C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(135)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#7012D4" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#7012D4" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#7012D4" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(180)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#EC1E8C" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#EC1E8C" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#EC1E8C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(225)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#7012D4" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#7012D4" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#7012D4" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(270)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#EC1E8C" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#EC1E8C" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#EC1E8C" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
          <g transform="rotate(315)">
            <ellipse cx="0" cy="-23" rx="6.8" ry="4.4" transform="rotate(-22,0,-23)" fill="#7012D4" />
            <line x1="5.5" y1="-19.5" x2="5.5" y2="-8" stroke="#7012D4" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M5.5,-8 Q14,-3.5 10,3" stroke="#7012D4" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </g>
        </g>
        <text
          x="70"
          y="41"
          fontFamily="'Outfit', system-ui, sans-serif"
          fontSize="27"
          fontWeight="800"
          letterSpacing="-0.5"
          fill="currentColor"
        >
          SPEELDIT
        </text>
      </svg>
    </span>
  );
}
