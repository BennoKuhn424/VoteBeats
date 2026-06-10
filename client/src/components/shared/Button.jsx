export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
  ...props
}) {
  // `will-change-transform` keeps the hover-lift / press-scale on the GPU so it
  // stays buttery on low-end phones. The spring easing gives the press a subtle
  // settle instead of a linear snap. Motion-reduced users get the static state
  // via the global prefers-reduced-motion net (transitions collapse to instant).
  const base =
    'min-h-touch px-5 py-3 rounded-xl font-semibold will-change-transform transition-all duration-300 ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100';
  const variants = {
    primary:
      'bg-brand-500 text-white hover:bg-brand-400 shadow-glow-brand hover:shadow-glow-brand',
    secondary:
      'bg-dark-700 text-white hover:bg-dark-600 border border-dark-600 shadow-soft',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/25',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant] || variants.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
