import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Base from './components/Base';
import NavBar from './components/NavBar';
import Footer from './components/Footer';
import EventoInfo from './components/EventInfo';
import RoleRoute from './components/RoleRoute'; // lo crearemos abajo
import NoAutorizado from './components/NoAutorizado'; // página de acceso denegado

const App = () => {
  const [usuario, setUsuario] = useState(null);

  useEffect(() => {
    fetch('https://ticketflowqr.test/wp-json/ticketflow/v1/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data?.nombre) {
          setUsuario(data);
        }
      });
  }, []);

  return (
    <>
      <NavBar usuario={usuario} />
      <br />
      <Routes>
        <Route path="/" element={<Base />} />

        <Route
          path="/EventInfo"
          element={
            <RoleRoute user={usuario} allowedRoles={['administrator', 'productor']}>
              <EventoInfo />
            </RoleRoute>
          }
        />

        <Route path="/no-autorizado" element={<NoAutorizado />} />
        <Route path="*" element={<p>There's nothing here: 404!</p>} />
      </Routes>
      <br />
      <Footer />
    </>
  );
};

export default App;
