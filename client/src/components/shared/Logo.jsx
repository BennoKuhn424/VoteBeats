export default function Logo({ size = 'md', className = '' }) {
  const sizes = {
    sm: 'h-8',
    md: 'h-10',
    lg: 'h-14',
    xl: 'h-28',
    '2xl': 'w-full max-w-[300px] sm:max-w-sm h-auto',
  };

  return (
    <img
      src="/speeldit-logo-transparent.png"
      alt="Speeldit"
      className={`${sizes[size]} w-auto shrink-0 min-w-0 ${className}`}
    />
  );
}
