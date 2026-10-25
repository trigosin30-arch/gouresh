/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f6fb', 100: '#e3ecf7', 200: '#c6d8ee', 300: '#9bb8dd',
          400: '#6a92c6', 500: '#4472ab', 600: '#32588c', 700: '#264772',
          800: '#1b3557', 900: '#0f2d52', 950: '#0a1f3a',
        },
        accent: {
          50: '#fff8ed', 100: '#ffefd4', 200: '#fedba8', 300: '#fdc071',
          400: '#fb9c38', 500: '#f97f14', 600: '#e06309', 700: '#ba4809',
          800: '#94390e', 900: '#79310f',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 45, 82, 0.06), 0 8px 24px -12px rgba(15, 45, 82, 0.18)',
      },
      maxWidth: { shell: '1200px' },
    },
  },
  plugins: [],
}
