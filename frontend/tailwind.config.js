/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,html}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Kept verbatim so older `bg-brand-600` utilities keep resolving.
        brand: {
          50: '#f0f7ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },

        // Surfaces bind to CSS variables so dark mode is a CSS-only swap.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',

        // Each status ships fg/bg/border so consumers can compose any tone
        // without re-declaring the palette (badge, row stripe, dot, ring).
        success: {
          fg: 'rgb(var(--success-fg) / <alpha-value>)',
          bg: 'rgb(var(--success-bg) / <alpha-value>)',
          border: 'rgb(var(--success-border) / <alpha-value>)',
        },
        warn: {
          fg: 'rgb(var(--warn-fg) / <alpha-value>)',
          bg: 'rgb(var(--warn-bg) / <alpha-value>)',
          border: 'rgb(var(--warn-border) / <alpha-value>)',
        },
        danger: {
          fg: 'rgb(var(--danger-fg) / <alpha-value>)',
          bg: 'rgb(var(--danger-bg) / <alpha-value>)',
          border: 'rgb(var(--danger-border) / <alpha-value>)',
        },
        info: {
          fg: 'rgb(var(--info-fg) / <alpha-value>)',
          bg: 'rgb(var(--info-bg) / <alpha-value>)',
          border: 'rgb(var(--info-border) / <alpha-value>)',
        },
        neutral: {
          fg: 'rgb(var(--neutral-fg) / <alpha-value>)',
          bg: 'rgb(var(--neutral-bg) / <alpha-value>)',
          border: 'rgb(var(--neutral-border) / <alpha-value>)',
        },
        accent: {
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          bg: 'rgb(var(--accent-bg) / <alpha-value>)',
          border: 'rgb(var(--accent-border) / <alpha-value>)',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: [
          'JetBrains Mono',
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },

      // Tabular numerics for tables and KPI cards — keeps digits aligned.
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },

      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        focus: '0 0 0 3px rgb(var(--ring) / 0.55)',
      },

      ringColor: {
        DEFAULT: 'rgb(var(--ring) / 1)',
      },
    },
  },
  plugins: [],
};