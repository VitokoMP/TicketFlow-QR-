import React, { createContext, useContext, useState, useEffect } from "react";

const EventoContext = createContext();

export function useEvento() {
  return useContext(EventoContext);
}

export function EventoProvider({ children }) {
  const [evento, setEvento] = useState(null);
  const [asistentes, setAsistentes] = useState([]); // aún sin uso
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEventoDisponible, setIsEventoDisponible] = useState(false);

  const API_URL = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/events`;
  // const API_URL = "http://localhost/wordpress/wp-json/mep/v1/mep_sincronizar_eventos_y_asistentes";

  const fetchEvento = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener los eventos");

      const data = await response.json();
      console.log("Eventos obtenidos:", data);

      // Si es un array, filtramos el evento activo más próximo
      const eventosActivos = data.filter(e => e.title && e.start_datetime); // O usa tu propia lógica
      const eventoActivo = eventosActivos[0]; // podrías ordenarlos por fecha si hay más de uno

      if (eventoActivo) {
        setEvento({
          nombre: eventoActivo.title,
          fecha: eventoActivo.start_datetime,
          lugar: eventoActivo.lugar || "Lugar no especificado",
          estado: "activo", // si tu API no lo trae, asumimos
        });
        setIsEventoDisponible(true);
      } else {
        setEvento(null);
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
    fetchEvento();
  }, []);

  return (
    <EventoContext.Provider
      value={{
        evento,
        asistentes,
        loading,
        error,
        fetchEvento,
        isEventoDisponible,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
}
