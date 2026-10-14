/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef3ff', 100: '#dde7ff', 200: '#c2d3ff', 300: '#9bb6ff', 400: '#6f8ffb', 500: '#4b6bf5',
          600: '#3550e8', 700: '#2a3fcf', 800: '#2536a7', 900: '#233284', 950: '#161e4d',
        },
        gold: { 400: '#fbbf24', 500: '#f59e0b' },
        ink: { 800: '#111a33', 900: '#0b1226', 950: '#070c1a' },
      },
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        lift: '0 4px 8px -2px rgba(16,24,40,.08), 0 2px 4px -2px rgba(16,24,40,.05)',
        pop: '0 20px 40px -12px rgba(16,24,40,.25)',
      },
      keyframes: {
        'fade-up': { from: { transform: 'translateY(6px)' }, to: { transform: 'none' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        pop: { '0%': { transform: 'scale(.6)' }, '70%': { transform: 'scale(1.08)' }, '100%': { transform: 'scale(1)' } },
        bump: { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.15)' } },
      },
      animation: {
        'fade-up': 'fade-up .25s ease-out both',
        'slide-up': 'slide-up .25s cubic-bezier(.2,.8,.2,1) both',
        pop: 'pop .4s ease-out both',
        bump: 'bump .25s ease-out',
      },
    },
  },
  plugins: [],
};
