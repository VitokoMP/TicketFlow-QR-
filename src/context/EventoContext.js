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
  const [asistentes, setAsistentes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEventoDisponible, setIsEventoDisponible] = useState(false);
  const [eventId, setEventId] = useState(null);

  const API_URL = `${window.location.origin}/wp-json/ticketflow/v1/eventos-activos`;

  const fetchEventos = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener los eventos");
      const data = await response.json();

      const eventosMapeados = data.map((ev) => ({
        event_id: ev.event_id,
        event_title: ev.event_title,
        event_start_date: ev.event_start_date,
        event_location: ev.event_location,
      }));

      setEventos(eventosMapeados);

      if (eventosMapeados.length > 0) {
        // Ordenamos eventos por fecha ascendente para seleccionar el próximo
        //eventosMapeados.sort(
        //  (a, b) => new Date(a.event_start_date) - new Date(b.event_start_date)
        //);

        // Seleccionamos automáticamente el primer evento
        //selectEvento(eventosMapeados[0]);
      } else {
        setIsEventoDisponible(false);
        setEventoSeleccionado(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

const fetchAsistentes = async (eventIds = []) => {
  if (eventIds.length === 0) return {};

  const queryString = eventIds.map(id => `event_ids[]=${id}`).join('&');

  try {
    const res = await fetch(`${window.location.origin}/wp-json/ticketflow/v1/asistentes?${queryString}`);
    if (!res.ok) throw new Error('Error al obtener asistentes');

    const data = await res.json();
    return data.asistentes || {};
  } catch (err) {
    console.error('❌ fetchAsistentes error:', err);
    return {};
  }
};


const selectEvento = async (evento) => {
  setLoading(true);
  setError(null);

  try {
    const id = evento.event_id;
    setEventId(id);
    setEventoSeleccionado(evento);
    console.log("Evento seleccionado cambiado a:", evento);

    const syncUrl = `${window.location.origin}/wp-json/ticketflow/v1/sync-attendees/${id}`;
    const syncResponse = await fetch(syncUrl);
    if (!syncResponse.ok) throw new Error("Error al sincronizar asistentes");
    await syncResponse.json();

    // Limpia solo el evento actual
    setAsistentes(prev => ({
      ...prev,
      [id]: []
    }));

    // Cargar asistentes por ID
    const asistentesCargados = await fetchAsistentes([id]);
    console.log("Asistentes cargados en selectEvento:", asistentesCargados);

    setAsistentes(prev => ({
      ...prev,
      ...asistentesCargados
    }));

    setIsEventoDisponible(true);
  } catch (err) {
    setError(err.message);
    setIsEventoDisponible(false);
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
        setAsistentes,
        loading,
        error,
        isEventoDisponible,
        eventId,
        selectEvento,
        eventoSeleccionado,
        setEventoSeleccionado,
        setLoading,
        fetchAsistentes,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
};