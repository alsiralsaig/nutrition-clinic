import './i18n.js'; // أولاً: يعرّف __t/__tf قبل أي وحدة أخرى
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import App from './App.jsx';
import { AppProvider } from './app-context.jsx';
import { ThemeProvider } from './theme.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <AppProvider>
          <App />
          <Analytics />
        </AppProvider>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
