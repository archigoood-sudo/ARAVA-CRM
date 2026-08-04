import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        accent: '0 8px 24px rgba(156, 255, 46, 0.18)',
        card: '0 1px 2px rgba(16, 24, 40, 0.035), 0 8px 30px rgba(16, 24, 40, 0.025)',
        elevated: '0 24px 80px rgba(0, 0, 0, 0.16)',
      },
      colors: {
        accent: {
          DEFAULT: '#9CFF2E',
          foreground: '#315B00',
          soft: '#E8FFD0',
          strong: '#8AEB21',
        },
        background: 'rgb(var(--background) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        error: '#FF4D4F',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
        sidebar: '#171717',
        success: '#22C55E',
        surface: 'rgb(var(--surface) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out both',
        'loading-bar': 'loading-bar 1.3s ease-in-out infinite',
        'soft-rise': 'soft-rise 220ms ease-out both',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'loading-bar': {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        'soft-rise': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
