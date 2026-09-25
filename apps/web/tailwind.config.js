/**
 * ألوان هادئة مناسبة لعيادة تغذية: أخضر مائي + رملي + درجات ناعمة.
 * كل لون معرّف كمتغير CSS (قنوات RGB) في styles.css، فيتبدّل الوضع الداكن
 * لكل المكوّنات دفعة واحدة بتبديل الصنف `dark` على <html> — دون تعديل كل صفحة.
 */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (name, keys) => Object.fromEntries(keys.map((k) => [k, v(`${name}-${k}`)]));

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      colors: {
        sand: v('sand'),
        ink: v('ink'),
        line: v('line'),
        surface: v('surface'), // خلفية البطاقات والحقول (أبيض في الفاتح)
        brand: scale('brand', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        leaf: scale('leaf', [50, 100, 500, 600]),
        sun: scale('sun', [50, 100, 500, 600]),
        clay: scale('clay', [50, 100, 500, 600]),
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
