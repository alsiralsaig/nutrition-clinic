// جسر Vercel: يصدّر تطبيق Express كما هو، فتعمل كل مسارات /api/* كدالة serverless واحدة.
// لا نسخة ثانية من المنطق — نفس الملفات التي تعمل محلياً.
export { default as default } from '../apps/api/src/server.js';
