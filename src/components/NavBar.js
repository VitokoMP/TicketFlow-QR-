import React from "react";
import { NavLink } from "react-router-dom";
import './NavBar.css';
import { useTicketFlowAPI } from "../hooks/useTicketFlowApi";

const NavBar = () => {
    const { response, loading, error } = useTicketFlowAPI('ticketflow_action');

  if (loading) return <p>Cargando...</p>;
  if (error) return <p>Error: {error.message}</p>;
 
  return (
    <>
      <header className="header">
        <div className="logo">🎟️ TicketFlow</div>

        <div className="user-settings">
          <span>👤 Usuario</span> 
          <div>
            {loading && <p>Cargando...</p>}
            {error && <p>Error: {error.message}</p>}
            {response && <pre>{JSON.stringify(response, null, 2)}</pre>}
          </div>
        </div>
      </header>

      <nav className="nav">
        <NavLink 
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
        </NavLink>

        {/* Futuro: escanear QR */}
        {/* <NavLink 
          to="/scan" 
          className={({ isActive }) => (isActive ? "nav-link active-link" : "nav-link")}
        >
          Escanear QR
        </NavLink> */}
      </nav>
    </>
  );
};

export default NavBar;
