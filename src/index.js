import React from 'react';
import App from './App';
//importe estos dos administradores nuevos.
import { EventoProvider } from "./context/EventoContext";
//////////////////////////////
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ErrorBoundary } from './util/errorBoundaries';
import { ToastContainer } from 'react-toastify';

// ==========================================
// 🎭 DEMO MODE CONFIGURATION
// ==========================================
// Detectar DEMO_MODE desde:
// 1. Variable de entorno (process.env.DEMO_MODE)
// 2. Query param (?demo=true)
// 3. LocalStorage (localStorage.getItem('TICKET_FLOW_DEMO'))
// ==========================================
const initDemoMode = () => {
  const queryParams = new URLSearchParams(window.location.search);
  const isDemoQuery = queryParams.get('demo') === 'true';
  const isDemoStorage = localStorage.getItem('TICKET_FLOW_DEMO') === 'true';
  const isDemoEnv = process.env.DEMO_MODE === 'true';

  const demoMode = isDemoQuery || isDemoStorage || isDemoEnv;
  
  if (demoMode) {
    window.TICKET_FLOW_DEMO = 'true';
    localStorage.setItem('TICKET_FLOW_DEMO', 'true');
    console.log('%c✨ DEMO MODE ACTIVATED', 'color: #FF9800; font-weight: bold; font-size: 14px');
    console.log('Para desactivar: localStorage.removeItem("TICKET_FLOW_DEMO") y recargar');
  } else {
    window.TICKET_FLOW_DEMO = 'false';
    console.log('%c🔗 PRODUCTION MODE (WordPress)', 'color: #4CAF50; font-weight: bold; font-size: 14px');
    console.log('Para activar demo: agregar ?demo=true a URL o localStorage.setItem("TICKET_FLOW_DEMO", "true")');
  }

  return demoMode;
};

// Inicializar DEMO_MODE antes de cargar la app
initDemoMode();

document.addEventListener('DOMContentLoaded', function () {
    const element = document.getElementById('wprk-admin-app');

    if (element) {
        // Aplicar estilos directamente desde JS como respaldo
        element.style.width = '100%';
        element.style.minHeight = '600px';
        element.style.display = 'flex';
        element.style.flexDirection = 'column';


        const root = createRoot(element);
        root.render(
            <HashRouter>
                
                    <ErrorBoundary>
                        <EventoProvider>
                            <App /> 
                        </EventoProvider>
                    </ErrorBoundary>

                <ToastContainer position="top-right"
                    autoClose={5000}
                    hideProgressBar={false}
                    newestOnTop={false}
                    closeOnClick
                    rtl={false}
                    pauseOnFocusLoss
                    draggable
                    pauseOnHover/>
            </HashRouter>
        );
        console.log("App rendered");
    } else {
        console.error('Element with ID "wprk-admin-app" not found');
        document.body.innerHTML = '<p>Error: Application container not found.</p>';
    }
});