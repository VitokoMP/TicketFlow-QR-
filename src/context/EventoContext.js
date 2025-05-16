import React, { createContext, useContext, useState, useEffect } from "react";

const EventoContext = createContext();

export function useEvento() {
  return useContext(EventoContext);
}

export function EventoProvider({ children }) {
  const [eventos, setEventos] = useState([]); // Lista completa de eventos
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null); // Evento activo
  const [asistentes, setAsistentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEventoDisponible, setIsEventoDisponible] = useState(false);
  const [eventId, setEventId] = useState(null); // ID del evento seleccionado

  const API_URL = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/eventos-activos`;

  // Obtener lista completa de eventos
  const fetchEventos = async () => {
    setLoading(true);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error("Error al obtener los eventos");
      const data = await response.json();
      console.log("Eventos obtenidos:", data);

      // Mantener eventos como un array
      setEventos(
        data.map((ev) => ({
          event_id: ev.event_id,
          nombre: ev.event_title,
          fecha: ev.event_start_date,
          lugar: ev.event_location,
        }))
      );
    } catch (err) {
      console.error("Error en fetchEventos:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Obtener asistentes de un evento específico
  const fetchAsistentes = async (event_id) => {
    try {
      const url = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/asistentes/${event_id}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Error al obtener los asistentes: ${response.statusText}`);
      }

      const data = await response.json();

      if (data && data.asistentes) {
        setAsistentes(data.asistentes);
      }
    } catch (err) {
      console.error("Error en fetchAsistentes:", err);
      setError(err.message);
    }
  };

  // Seleccionar un evento y forzar carga de asistentes si no están
  const selectEvento = async (eventoSeleccionado) => {
    setLoading(true);
    try {
      const id = eventoSeleccionado.event_id;
      setEventId(id);

      // Guardar el evento seleccionado en un estado separado
      setEventoSeleccionado({
        nombre: eventoSeleccionado.event_title || "Sin título",
        fecha: eventoSeleccionado.event_start_date,
        lugar: eventoSeleccionado.event_location || "Lugar no especificado",
        estado: "activo",
      });

      // Sincronizar asistentes desde fuente externa hacia la tabla local
      const syncUrl = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/sync-attendees/${id}`;
      const syncResponse = await fetch(syncUrl);
      if (!syncResponse.ok) throw new Error("Error al sincronizar asistentes");

      const syncData = await syncResponse.json();
      console.log("Sincronización completada:", syncData);
      //preparamos el array de asistentes para la carga
      // setAsistentes([]); // Limpiar asistentes antes de cargar nuevos
      setAsistentes([]); // justo antes del `await fetchAsistentes(id)`
      // Leer asistentes desde la API externa
      // Leer asistentes desde la tabla local ya poblada
      await fetchAsistentes(id);

      setIsEventoDisponible(true);
    } catch (err) {
      console.error("Error en selectEvento:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Cargar eventos al montar
  useEffect(() => {
    fetchEventos();
  }, []);

  return (
    <EventoContext.Provider
      value={{
        eventos, // Siempre será un array
        fetchEventos,
        asistentes,
        loading,
        error,
        isEventoDisponible,
        eventId,
        selectEvento,
        eventoSeleccionado, // Nuevo estado para el evento activo
        setLoading,
      }}
    >
      {children}
    </EventoContext.Provider>
  );
}

export default EventoProvider;
