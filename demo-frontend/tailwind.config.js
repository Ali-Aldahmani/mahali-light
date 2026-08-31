/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F5F6FA',
        surface: '#FFFFFF',
        'surface-2': '#F0F1F5',
        accent: {
          DEFAULT: '#F97316',
          hover: '#EA6C0A',
          light: '#FFF0E6',
        },
        success: {
          DEFAULT: '#16A34A',
          light: '#DCFCE7',
        },
        warning: {
          DEFAULT: '#CA8A04',
          light: '#FEF9C3',
        },
        error: {
          DEFAULT: '#DC2626',
          light: '#FEE2E2',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#6B7280',
        },
        border: '#E5E7EB',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08)',
        pop: '0 8px 24px rgba(0,0,0,0.10)',
      },
      borderRadius: {
        input: '8px',
        card: '12px',
      },
    },
  },
  plugins: [],
};
