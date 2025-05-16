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
      console.log("Eventos obtenidos:", data[0].event_id );
      setEventos({
      event_id: data[0].event_id,
      nombre: data[0].event_title,
      fecha: data[0].event_start_date,
      lugar: data[0].event_location,
    });
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

    // 1. Guardamos el evento seleccionado
    setEventos({
      nombre: eventoSeleccionado.event_title || "Sin título",
      fecha: eventoSeleccionado.event_start_date,
      lugar: eventoSeleccionado.event_location || "Lugar no especificado",
      estado: "activo",
    });

    // 2. SINCRONIZAMOS asistentes desde fuente externa hacia la tabla local
    const syncUrl = `${window.location.origin}/wordpress/wp-json/ticketflow/v1/sync-attendees/${id}`;
    const syncResponse = await fetch(syncUrl);
    if (!syncResponse.ok) throw new Error("Error al sincronizar asistentes");

    const syncData = await syncResponse.json();
    console.log("Sincronización completada:", syncData);

    // 3. LEEMOS asistentes desde la tabla local ya poblada
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
        eventos, // Ensure eventos is passed correctly
        fetchEventos, // Include fetchEventos for external usage
        asistentes,
        loading,
        error,
        fetchEventos,
        isEventoDisponible,
        eventId,
        selectEvento, // 👈 necesario para que puedas usarlo desde el UI
      }}
    >

      {children}
    </EventoContext.Provider>
  );
}

export default EventoProvider;
