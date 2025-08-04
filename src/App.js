import React, { useState, useEffect, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { Routes, Route, useNavigate, HashRouter } from 'react-router-dom';
import { EventoProvider, EventoContext } from './context/EventoContext';
import { QRProvider } from './context/QRContext';

import Base from './components/Base';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import EventoInfo from './components/EventInfo';
import RoleRoute from './components/RoleRoute';
import NoAutorizado from './components/NoAutorizado';
import Splash from './pages/Splash';
import Login from './pages/Login';
import Menu from './pages/Menu';
import ScannerTool from './scanner/ScannerTool';

const App = () => {
  const { userData, loading } = useContext(EventoContext);
  const navigate = useNavigate();

  const usuario = userData || null;

  useEffect(() => {
    if (!loading && usuario) {
      switch (usuario.role) {
        case 'admin':
        case 'producer':
          navigate('/menu');
          break;
        case 'scanner':
          navigate('/scanner');
          break;
        default:
          navigate('/no-autorizado');
      }
    }
  }, [loading, usuario, navigate]);

  if (loading) return <Splash />;

  if (!usuario) return <Login />;

  return (
    <>
      <NavBar usuario={usuario} />
      <br />
      <Routes>
        <Route path="/" element={<Base />} />
        <Route
          path="/menu"
          element={
            <RoleRoute user={usuario} allowedRoles={['admin', 'producer']}>
              <Menu />
            </RoleRoute>
          }
        />
        <Route
          path="/scanner"
          element={
            <RoleRoute user={usuario} allowedRoles={['scanner']}>
              <ScannerTool />
            </RoleRoute>
          }
        />
        <Route
          path="/event-info"
          element={
            <RoleRoute user={usuario} allowedRoles={['admin', 'producer']}>
              <EventoInfo />
            </RoleRoute>
          }
        />
        <Route path="/no-autorizado" element={<NoAutorizado />} />
        <Route path="*" element={<p>Página no encontrada: 404!</p>} />
      </Routes>
      <br />
      <Footer />
    </>
  );
};

// Montaje de la app en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('ticketflow-root');
  if (!container) {
    console.error('Element with ID "ticketflow-root" not found');
    document.body.innerHTML = '<p>Error: Application container not found.</p>';
    return;
  }

  const root = createRoot(container);
  root.render(
    <HashRouter>
      <EventoProvider>
        <QRProvider>
          <App />
        </QRProvider>
      </EventoProvider>
    </HashRouter>
  );

  console.log('React app mounted in #ticketflow-root');
});

