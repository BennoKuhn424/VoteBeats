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
      minHeight: {
        'touch': '44px',
      },
      boxShadow: {
        'button': '0 2px 8px rgba(0,0,0,0.15)',
        'card': '0 4px 12px rgba(0,0,0,0.1)',
      },
    },
  },
  plugins: [],
};
