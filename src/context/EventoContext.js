import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { ScannerAPI } from "../services/ApiService";

const EventoContext = createContext();

export function useEvento() {
  const context = useContext(EventoContext);
  if (!context) {
    throw new Error("useEvento debe usarse dentro de EventoProvider");
  }
  return context;
}

export const EventoProvider = ({ children }) => {
  // ========== ESTADOS EXISTENTES (se mantienen igual) ==========
  const [eventos, setEventos] = useState([]);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const [asistentes, setAsistentes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEventoDisponible, setIsEventoDisponible] = useState(false);
  const [eventId, setEventId] = useState(null);

  // ========== NUEVAS OPTIMIZACIONES ==========
  // Buffer de escaneos con useRef (mejor rendimiento)
  const syncBufferRef = useRef([]);
  const syncTimerRef = useRef(null);

  // ========== FUNCIONES EXISTENTES (se mantienen igual) ==========
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

      if (eventosMapeados.length === 0) {
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

      setAsistentes(prev => ({ ...prev, [id]: [] }));

      const asistentesCargados = await fetchAsistentes([id]);
      console.log("Asistentes cargados en selectEvento:", asistentesCargados);

      setAsistentes(prev => ({ ...prev, ...asistentesCargados }));
      setIsEventoDisponible(true);
    } catch (err) {
      setError(err.message);
      setIsEventoDisponible(false);
    } finally {
      setLoading(false);
    }
  };

  // ========== NUEVAS FUNCIONES OPTIMIZADAS ==========
  // Actualización individual de asistente (nueva)
  const updateAsistenteStatus = useCallback((asistenteId, newStatus) => {
  const startTime = performance.now();
  let updateApplied = false;
  
  try {
    if (!eventoSeleccionado?.event_id) {
      console.warn('No se puede actualizar estado: ningún evento seleccionado');
      return false;
    }
    
    setAsistentes(prev => {
      const currentEventAttendees = prev[eventoSeleccionado.event_id] || [];
      const asistenteIndex = currentEventAttendees.findIndex(a => a.id === asistenteId);
      
      if (asistenteIndex === -1 || 
          currentEventAttendees[asistenteIndex].status === newStatus) {
        return prev;
      }
      
      updateApplied = true;
      
      // Actualización optimizada con slice
      return {
        ...prev,
        [eventoSeleccionado.event_id]: [
          ...currentEventAttendees.slice(0, asistenteIndex),
          { 
            ...currentEventAttendees[asistenteIndex], 
            status: newStatus,
            updatedAt: Date.now()
          },
          ...currentEventAttendees.slice(asistenteIndex + 1)
        ]
      };
    });
    
    return true;
  } finally {
    if (process.env.NODE_ENV === 'development') {
      const duration = performance.now() - startTime;
      console.log(`updateAsistenteStatus: ${duration.toFixed(2)}ms`, {
        asistenteId,
        newStatus,
        updateApplied
      });
    }
  }
}, [eventoSeleccionado]);

  // Agregar al buffer (optimizada)
  const addToBuffer = useCallback((scanData) => {
    syncBufferRef.current = [...syncBufferRef.current, scanData];
    
    // Sincronizar si hay 5+ items o cancelar timer anterior
    if (syncBufferRef.current.length >= 5) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncBuffer();
    } else if (!syncTimerRef.current) {
      syncTimerRef.current = setTimeout(syncBuffer, 20000);
    }
  }, []);

  // Sincronización batch (optimizada)
  const syncBuffer = useCallback(async () => {
    if (syncBufferRef.current.length === 0) return;
    
    const bufferToSend = [...syncBufferRef.current];
    syncBufferRef.current = []; // Vaciar inmediatamente
    
    try {
      setLoading(true);
      const result = await ScannerAPI.markMultipleAsScanned(
        bufferToSend.map(item => item.ticket_id)
      );
      
      if (result.success) {
        updateBulkAsistentes(bufferToSend.map(item => ({
          id: item.ticket_id,
          status: 'SCANNED'
        })));
      }
    } catch (error) {
      console.error('Error en syncBuffer:', error);
      // Revertir y reintentar
      syncBufferRef.current = [...syncBufferRef.current, ...bufferToSend];
      syncTimerRef.current = setTimeout(syncBuffer, 5000);
    } finally {
      setLoading(false);
      syncTimerRef.current = null;
    }
  }, []);

  // Actualización masiva (existente pero mejorada)
  const updateBulkAsistentes = useCallback((updates) => {
    if (!eventoSeleccionado) return;
    
    setAsistentes(prev => ({
      ...prev,
      [eventoSeleccionado.event_id]: prev[eventoSeleccionado.event_id].map(a => {
        const update = updates.find(u => u.id === a.id);
        return update ? { ...a, ...update } : a;
      })
    }));
  }, [eventoSeleccionado]);

  // ========== EFFECTS (se mantienen igual) ==========
  useEffect(() => {
    fetchEventos();
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      // Sincronizar pendientes al desmontar
      if (syncBufferRef.current.length > 0) syncBuffer();
    };
  }, []);

  return (
    <EventoContext.Provider
      value={{
        // Estados existentes
        eventos,
        asistentes,
        loading,
        error,
        isEventoDisponible,
        eventId,
        eventoSeleccionado,
        
        // Funciones existentes
        fetchEventos,
        selectEvento,
        setEventoSeleccionado,
        setLoading,
        fetchAsistentes,
        
        // Funciones optimizadas/nuevas
        addToBuffer,
        syncBuffer,
        updateAsistenteStatus,
        setAsistentes,
        updateBulkAsistentes
      }}
    >
      {children}
    </EventoContext.Provider>
  );
};