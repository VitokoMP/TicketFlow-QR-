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
          event_title: ev.event_title,
          event_start_date: ev.event_start_date,
          event_location: ev.event_location,
        }))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Solo una llamada: sincroniza y obtiene asistentes en una sola petición
  const selectEvento = async (evento) => {
    setLoading(true);
    setError(null);
    try {
      const id = evento.event_id;
      setEventId(id);
      setEventoSeleccionado(evento);

      console.log("🟡 Iniciando sincronización y obtención de asistentes...");
      const syncUrl = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/sync-attendees/${id}`;
      const syncResponse = await fetch(syncUrl);
      if (!syncResponse.ok) throw new Error("Error al sincronizar asistentes");
      const syncData = await syncResponse.json();
      console.log("📥 Datos recibidos desde sync-attendees:", syncData);

      // Si la respuesta trae asistentes directamente, los seteamos
      if (syncData && syncData.attendees) {
        setAsistentes(syncData.attendees);
        console.log("🧾 Lista de asistentes sincronizados:", syncData.attendees);
      } else if (syncData && syncData.asistentes) {
        setAsistentes(syncData.asistentes);
        console.log("🧾 Lista de asistentes sincronizados:", syncData.asistentes);
      } else {
        setAsistentes([]);
        console.warn("⚠️ No se encontraron asistentes en la respuesta.");
      }

      setIsEventoDisponible(true);
    } catch (err) {
      setError(err.message);
      //setAsistentes([]);
      console.error("❌ Error en selectEvento:", err);
    } finally {
      setLoading(false);
      console.log("🔁 Finalizó proceso selectEvento");
    }
  };

  useEffect(() => {
    fetchEventos();
  }, []);

  // Para depuración: ver asistentes actualizados
  useEffect(() => {
    console.log("👀 Asistentes actualizados:", asistentes);
  }, [asistentes]);

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
        setEventoSeleccionado,
        setLoading,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
};
