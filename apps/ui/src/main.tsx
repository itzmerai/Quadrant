import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PreferencesProvider } from './lib/PreferencesContext';
import './styles/app.css';
import './styles/layout.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing #root');

createRoot(host).render(
  <React.StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </React.StrictMode>,
);
