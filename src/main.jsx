import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import MiniWindow from './components/MiniWindow.jsx';
import './styles.css';

const isMiniWindow = window.location.hash === '#mini';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMiniWindow ? <MiniWindow /> : <App />}
  </React.StrictMode>
);
