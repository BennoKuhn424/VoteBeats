/**
 * Speeldit logo: orange circle + play symbol + "speeldit" text.
 * Tight SVG, no padding. Text color set by dark prop.
 */
export default function Logo({ size = 'md', className = '', dark = false }) {
  const sizes = {
    sm: 'h-6',
    md: 'h-8',
    lg: 'h-10',
    xl: 'h-12',
    '2xl': 'h-14 sm:h-16',
  };
  const textColor = dark ? '#ffffff' : '#000000';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 130 36"
      fill="none"
      preserveAspectRatio="xMinYMid meet"
      className={`${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
      aria-label="Speeldit"
    >
      <circle cx="18" cy="18" r="18" fill="#f59e0b" />
      <path d="M14 10l10 8-10 8V10z" fill="white" />
      <text x="42" y="25" fontFamily="system-ui, -apple-system, sans-serif" fontSize="22" fontWeight="700" fill={textColor}>
        speeldit
      </text>
    </svg>
  );
}
