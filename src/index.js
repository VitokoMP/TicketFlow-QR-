import React from 'react';
import App from './App';
import './index.css'; 
//importe estos dos administradores nuevos.
import { EventoProvider } from "./context/EventoContext";
import { QRProvider } from "./context/QRContext";
//////////////////////////////
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

document.addEventListener('DOMContentLoaded', function () {
    const element = document.getElementById('react-app-shortcode') || document.getElementById('wprk-admin-app');

    if (element) {
        // Aplicar estilos directamente desde JS como respaldo
        element.style.width = '100%';
        element.style.minHeight = '600px';
        element.style.display = 'flex';
        element.style.flexDirection = 'column';


        const root = createRoot(element);
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
        console.log("App rendered");
    } else {
        console.error('Element with ID "wprk-admin-app" not found');
        document.body.innerHTML = '<p>Error: Application container not found.</p>';
    }
});