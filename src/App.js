import React, { useState, useEffect, useContext } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { EventoContext } from './context/EventoContext'; // Importamos el contexto
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
  const { userData, loading } = useContext(EventoContext); // Usamos el contexto
  const navigate = useNavigate();

  // Verificamos si tenemos datos de usuario
  const usuario = userData || null;

  // Redirigir según el rol cuando se cargan los datos
  useEffect(() => {
    if (!loading && usuario) {
      switch(usuario.role) {
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

  // Mostrar splash screen mientras se carga
  if (loading) {
    return <Splash />;
  }

  // Mostrar login si no hay usuario
  if (!usuario) {
    return <Login />;
  }

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

export default App;