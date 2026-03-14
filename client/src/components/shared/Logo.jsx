/**
 * Speeldit logo — SVG pinwheel of music notes matching the brand mark.
 * Pink (#EC1E8C) and deep-purple (#7012D4) notes arranged in a circular
 * pinwheel, followed by the "SPEELDIT" wordmark.
 * The `dark` prop switches the wordmark to white for dark backgrounds.
 */
export default function Logo({ size = 'md', className = '', dark = false }) {
  const sizes = {
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-10',
    xl: 'h-12',
    '2xl': 'h-14 sm:h-16',
  };

  const pink   = '#EC1E8C';
  const purple = '#7012D4';
  const text   = dark ? '#ffffff' : '#3D006E';

  // 8 note arms at 0°, 45°, 90° … 315° — alternating pink / purple
  const arms = [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
    const c = i % 2 === 0 ? pink : purple;
    return (
      <g key={deg} transform={`rotate(${deg})`}>
        {/* Note head — oval tilted ~22° so it looks like a natural music note */}
        <ellipse cx="0" cy="-23" rx="6.8" ry="4.4"
                 transform="rotate(-22, 0, -23)" fill={c} />
        {/* Stem going inward */}
        <line x1="5.5" y1="-19.5" x2="5.5" y2="-8"
              stroke={c} strokeWidth="2.2" strokeLinecap="round" />
        {/* Flag — curves with the rotation to give the pinwheel flow */}
        <path d="M5.5,-8 Q14,-3.5 10,3"
              stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </g>
    );
  });

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 204 66"
      fill="none"
      preserveAspectRatio="xMinYMid meet"
      className={`${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
      aria-label="Speeldit"
    >
      {/* Pinwheel icon — centered at (33, 33) */}
      <g transform="translate(33, 33)">{arms}</g>

      {/* SPEELDIT wordmark */}
      <text
        x="70"
        y="41"
        fontFamily="'Outfit', system-ui, -apple-system, sans-serif"
        fontSize="27"
        fontWeight="800"
        letterSpacing="-0.5"
        fill={text}
      >
        SPEELDIT
      </text>
    </svg>
  );
}
