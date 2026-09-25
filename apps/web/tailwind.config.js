/** ألوان هادئة مناسبة لعيادة تغذية: أخضر مائي + رملي + درجات ناعمة */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      colors: {
        sand: '#f6f4ef',
        ink: '#1c2b2a',
        line: '#e6e1d8',
        brand: {
          50: '#effaf8', 100: '#d6f2ee', 200: '#aee5df', 300: '#78d2ca',
          400: '#43b7ae', 500: '#229a92', 600: '#157c77', 700: '#0f6360',
          800: '#0e4f4d', 900: '#0d4140',
        },
        leaf: { 50: '#f2f9ee', 100: '#e0f1d5', 500: '#5aa843', 600: '#468735' },
        sun: { 50: '#fef8e9', 100: '#fdecc8', 500: '#d69a19', 600: '#b47d0c' },
        clay: { 50: '#fdf2ef', 100: '#fbe1da', 500: '#c9604a', 600: '#a94a36' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,44,42,.04), 0 8px 24px -12px rgba(16,44,42,.14)',
        pop: '0 24px 60px -20px rgba(12,45,43,.35)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
