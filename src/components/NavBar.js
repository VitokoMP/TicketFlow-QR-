import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import './NavBar.css';

const NavBar = () => {
  const [usuario, setUsuario] = useState(null);

  useEffect(() => {
    fetch('/wp-json/ticketflow/v1/me', {
      credentials: 'include' // importante si usas auth por sesión/cookie
    })
      .then(res => res.json())
      .then(data => {
        if (data?.nombre) {
          console.log("Usuario logueado:", data);
          setUsuario(data); // guarda todo el objeto, incluidos los roles
        }
      });
  }, []);

  return (
    <>
      <header className="header">
        <div className="logo">🎟️ TicketFlow</div>

        <div className="user-settings">
          {usuario && (
            <p className="text-sm text-gray-300">
              Bienvenido, <strong>{usuario.nombre}</strong>
            </p>
          )}
        </div>
      </header>

      <nav className="nav">
        <NavLink 
          to="/" 
          className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
        >
          Ver Tickets
        </NavLink>

        {(usuario?.role === 'productor' || usuario?.role === 'administrator') && (
          <NavLink 
            to="/sync" 
            className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
          >
            Sincronizar Ventas
          </NavLink>
        )}

        {(usuario?.role === 'escaneador' || usuario?.role === 'productor') && (
          <NavLink 
            to="/scan" 
            className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
          >
            Escanear QR
          </NavLink>
        )}
      </nav>
    </>
  );
};

export default NavBar;
