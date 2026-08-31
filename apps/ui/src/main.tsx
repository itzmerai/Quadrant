import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

const host = document.getElementById('root');
if (!host) throw new Error('Missing #root');

createRoot(host).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
