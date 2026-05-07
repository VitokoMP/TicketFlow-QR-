import React from 'react';
import App from './App';
//importe estos dos administradores nuevos.
import { EventoProvider } from "./context/EventoContext";
//////////////////////////////
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ErrorBoundary } from './util/errorBoundaries';
import { ToastContainer } from 'react-toastify';

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