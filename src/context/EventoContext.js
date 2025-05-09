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
  const [isEventoDisponible, setIsEventoDisponible] = useState(false); // Nueva variable de estado

  const API_URL = `${window.location.origin}/wp-json/mep/v1/mep_sincronizar_eventos_y_asistentes`;

//  const API_URL = "http://localhost/wordpress/wp-json/mep/v1/mep_sincronizar_eventos_y_asistentes";

  const fetchEvento = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener el evento");

      const data = await response.json();
      setEvento(data.evento);
      setAsistentes(data.asistentes);

      // Verificar si el evento está disponible
      if (data.evento && data.evento.estado === 'activo') {
        setIsEventoDisponible(true);
      } else {
        setIsEventoDisponible(false);
      }
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
        isEventoDisponible, // Pasamos la nueva variable
      }}
    >
      {children}
    </EventoContext.Provider>
  );
}
