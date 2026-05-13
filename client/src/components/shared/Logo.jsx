/**
 * Speeldit wordmark — text only.
 *
 * Renders the brand name "SPEELDIT" in bold. Color is theme-aware:
 * - Default: dark on light pages, white on dark pages via Tailwind's
 *   `dark:` variant (venue routes that obey the theme toggle).
 * - `forceLight`: white regardless. For pages that are always dark
 *   without setting `dark` on <html> (CustomerVoting, Home).
 */
export default function Logo({ size = 'md', className = '', forceLight = false }) {
  const sizes = {
    sm: 'text-xl',
    md: 'text-2xl',
    lg: 'text-3xl',
    xl: 'text-4xl sm:text-5xl',
    '2xl': 'text-5xl sm:text-6xl',
  };

  const colorClass = forceLight
    ? 'text-white'
    : 'text-zinc-900 dark:text-white';

  return (
    <span
      role="img"
      aria-label="Speeldit"
      className={`inline-block font-extrabold tracking-tight ${colorClass} ${sizes[size]} ${className}`}
    >
      SPEELDIT
    </span>
  );
}
