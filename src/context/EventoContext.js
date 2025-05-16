import React, { createContext, useContext, useState, useEffect } from "react";

const EventoContext = createContext();

export function useEvento() {
  const context = useContext(EventoContext);
  if (!context) {
    throw new Error("useEvento debe usarse dentro de EventoProvider");
  }
  return context;
}

export const EventoProvider = ({ children }) => {
  const [eventos, setEventos] = useState([]);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const [asistentes, setAsistentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEventoDisponible, setIsEventoDisponible] = useState(false);
  const [eventId, setEventId] = useState(null);

  const API_URL = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/eventos-activos`;

  const fetchEventos = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener los eventos");
      const data = await response.json();
      setEventos(
        data.map((ev) => ({
          event_id: ev.event_id,
          nombre: ev.event_title,
          fecha: ev.event_start_date,
          lugar: ev.event_location,
        }))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAsistentes = async (event_id) => {
    setError(null);
    try {
      const url = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/asistentes/${event_id}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) throw new Error(`Error al obtener los asistentes: ${response.statusText}`);
      const data = await response.json();
      if (data && data.asistentes) {
        setAsistentes(data.asistentes);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const selectEvento = async (evento) => {
    setLoading(true);
    setError(null);
    try {
      const id = evento.event_id;
      setEventId(id);
      setEventoSeleccionado(evento);
      const syncUrl = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/sync-attendees/${id}`;
      const syncResponse = await fetch(syncUrl);
      if (!syncResponse.ok) throw new Error("Error al sincronizar asistentes");
      await syncResponse.json();

      setAsistentes([]);
      await fetchAsistentes(id);

      setIsEventoDisponible(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEventos();
  }, []);

  return (
    <EventoContext.Provider
      value={{
        eventos,
        fetchEventos,
        asistentes,
        loading,
        error,
        isEventoDisponible,
        eventId,
        selectEvento,
        eventoSeleccionado,
        setLoading,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
};
