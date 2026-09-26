import './i18n.js'; // أولاً: يعرّف __t/__tf قبل أي وحدة أخرى
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './app-context.jsx';
import { ThemeProvider } from './theme.jsx';
import './styles.css';
import { initPwa } from './pwa.js';

// رابط تثبيت تطبيق المريض القصير: /app → #/portal (التطبيق يعمل بمسارات #)
if (/^\/app\/?$/.test(window.location.pathname)) {
  window.history.replaceState(null, '', `/${window.location.hash || '#/portal'}`);
}
initPwa();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
