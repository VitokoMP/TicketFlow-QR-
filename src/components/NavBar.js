import React from "react";
import { NavLink } from "react-router-dom";
import './NavBar.css';

const NavBar = () => {
  return (
    <>
      <header className="header">
        <div className="logo">🎟️ TicketFlow</div>

        <div className="user-settings">
          <span>👤 Usuario</span>
          {/* En futuro: <button onClick={logout}>Cerrar sesión</button> */}
        </div>
      </header>

      <nav className="nav">
       {/* <NavLink 
          to="/" 
          className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
        >
          Ver Tickets
        </NavLink>

        <NavLink 
          to="/sync" 
          className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
        >
          Sincronizar Ventas
        </NavLink>*/}

         <NavLink 
          to="/" 
          className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
        >
          Escanear QR
        </NavLink> 
      </nav>
    </>
  );
};

export default NavBar;
