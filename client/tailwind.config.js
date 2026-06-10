/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Class strategy: we toggle `dark` on <html> from ThemeProvider.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        dark: {
          950: '#0a0a0a',
          900: '#141414',
          800: '#1a1a1a',
          700: '#262626',
          600: '#404040',
          500: '#525252',
          400: '#737373',
          300: '#a3a3a3',
        },
        carbon: {
          50: '#f8f9fa',
          100: '#f1f3f4',
          200: '#e8eaed',
          300: '#dadce0',
          400: '#bdc1c6',
          500: '#9aa0a6',
          600: '#80868b',
          700: '#5f6368',
          800: '#3c4043',
          900: '#202124',
        },
        amethyst: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          900: '#4c1d95',
        },
      },
      spacing: {
        'safe': 'env(safe-area-inset-bottom, 0px)',
      },
      // Apple-flavoured spring & ease curves. `spring` is an ease-out-expo that
      // settles like a UIKit animation; `smooth` is a gentler general-purpose
      // curve for color/opacity transitions.
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'smooth': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        // Entrance: rise + fade. Applied via the motion-safe: variant only, so
        // reduced-motion users skip straight to the settled (visible) state and
        // never get stuck at opacity:0.
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Attention pulse for the live "now playing" indicator.
        pulseSoft: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.82)' },
        },
        // Sweeps a highlight across skeleton / artwork shells while loading.
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Slowly drifts a multi-stop gradient — for animated brand text.
        gradientPan: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        // Equalizer bars in the now-playing badge.
        eq: {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fadeIn 0.5s ease both',
        'scale-in': 'scaleIn 0.42s cubic-bezier(0.16, 1, 0.3, 1) both',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.8s linear infinite',
        'gradient-pan': 'gradientPan 8s ease infinite',
        'eq': 'eq 1.1s ease-in-out infinite',
      },
      minHeight: {
        // Apple HIG 44pt / Material 48dp finger floor — literal px, NOT rem,
        // so it doesn't scale with iOS Dynamic Type. Touch targets stay
        // finger-sized regardless of text scale; only the text inside grows.
        'touch': '44px',
      },
      minWidth: {
        'touch': '44px',
      },
      boxShadow: {
        'button': '0 2px 8px rgba(0,0,0,0.15)',
        'card': '0 4px 12px rgba(0,0,0,0.1)',
        // Layered, Apple-style soft elevation — a tight contact shadow plus a
        // broad ambient one reads as real depth rather than a flat drop.
        'soft': '0 1px 2px rgba(0,0,0,0.05), 0 6px 20px -6px rgba(0,0,0,0.12)',
        'elevated': '0 2px 4px rgba(0,0,0,0.06), 0 18px 40px -12px rgba(0,0,0,0.22)',
        // Coloured glows for primary CTAs / live elements.
        'glow-brand': '0 10px 34px -10px rgba(249,115,22,0.55)',
        'glow-amethyst': '0 10px 34px -10px rgba(139,92,246,0.6)',
      },
    },
  },
  plugins: [],
};
