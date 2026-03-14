export default function Logo({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-8',
    md: 'h-10',
    lg: 'h-12',
    xl: 'h-14',
    '2xl': 'h-18 sm:h-20',
  };

  return (
    <img
      src="/speeldit-logo-transparent.png"
      alt="Speeldit"
      className={`${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
    />
  );
}
