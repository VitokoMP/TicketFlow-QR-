import React, { createContext, useContext, useState, useEffect } from "react";

const EventoContext = createContext();

export function useEvento() {
  return useContext(EventoContext);
}

export function EventoProvider({ children }) {
  const [evento, setEvento] = useState(null);
  const [asistentes, setAsistentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Puedes ajustar la URL a tu endpoint real en WordPress
  const API_URL = "/wp-json/mep/v1/evento-activo";

  const fetchEvento = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener el evento");

      const data = await response.json();
      setEvento(data.evento);
      setAsistentes(data.asistentes); // espera que el endpoint devuelva los asistentes en un array
    } catch (err) {
      console.error("Error en fetchEvento:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvento(); // carga automática al montar
  }, []);

  return (
    <EventoContext.Provider
      value={{
        evento,
        asistentes,
        loading,
        error,
        fetchEvento,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
}
