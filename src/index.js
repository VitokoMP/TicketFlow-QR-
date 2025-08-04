import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

import { EventoProvider } from './context/EventoContext';
import { QRProvider } from './context/QRContext';
import { HashRouter } from 'react-router-dom';

function initApp() {
  const container = document.getElementById('ticketflow-root');
  
  if (!container) {
    // fallback (solo si quieres, no obligatorio)
    const fallbackContainer = document.createElement('div');
    fallbackContainer.id = 'ticketflow-root';
    fallbackContainer.style.cssText = `
      width: 100%;
      min-height: 600px;
      display: flex;
      flex-direction: column;
      padding: 20px; 
      border: 1px solid #ddd; 
      border-radius: 5px; 
      background-color: #343631; 
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    `;
    document.body.appendChild(fallbackContainer);
    return fallbackContainer;
  }
  return container;
}

const renderApp = () => {
  const container = initApp();
  const root = createRoot(container);
  
  root.render(
    <HashRouter>
      <React.StrictMode>
        <EventoProvider>
          <QRProvider>
            <App />
          </QRProvider>
        </EventoProvider>
      </React.StrictMode>
    </HashRouter>
  );
  console.log('✅ App React montada correctamente');
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(renderApp, 0);
} else {
  document.addEventListener('DOMContentLoaded', renderApp);
}
