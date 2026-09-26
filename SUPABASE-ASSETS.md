# Supabase public asset URLs

The app now uses the supplied public Supabase Storage URLs for its branding and PWA icons. The URLs were checked and returned HTTP 200 with `image/png` and public CORS headers.

No image files need to be committed to GitHub for this update. Extract this archive into the repository root, preserving paths, then commit and push the code changes.

Files changed:
- `apps/web/src/pages/Login.jsx` — login banner and logo URLs
- `apps/web/src/pages/Portal.jsx` — patient app card icon URL
- `apps/web/index.html` — favicon and Apple touch icon URLs
- `apps/web/public/app.webmanifest` — patient PWA icon URLs
- `apps/web/public/staff.webmanifest` — staff PWA icon URLs
- `apps/web/public/sw.js` — notification icons and precache list
- `apps/web/src/i18n/en.js` — English translations for added login/install UI

Keep the Supabase bucket public. If any object is renamed or the bucket becomes private, update these URLs; signed URLs that expire should not be used for app icons.
