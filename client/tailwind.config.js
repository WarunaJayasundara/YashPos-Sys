/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef4ff', 100: '#dbe6fe', 200: '#bfd3fe', 500: '#2563eb', 600: '#1d4ed8', 700: '#1a44b8', 800: '#163a96', 900: '#0f3d91' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
