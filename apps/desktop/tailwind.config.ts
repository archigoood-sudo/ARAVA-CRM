import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        accent: '0 8px 24px rgba(156, 255, 46, 0.18)',
        card: '0 1px 2px rgba(16, 24, 40, 0.035)',
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
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
        sidebar: '#171717',
        surface: 'rgb(var(--surface) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
