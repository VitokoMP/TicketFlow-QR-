import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { ScannerAPI } from "../services/ApiService";
import { toast } from 'react-toastify'; // Or your preferred toast library

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
  const [asistentes, setAsistentes] = useState(() => ({}));
  const [asistentesIndex, setAsistentesIndex] = useState({}); // { [ticket_code]: asistente }
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

  // Replace showToast calls with:
  const showToast = (message, type) => {
    toast[type](message, {
      position: 'top-right',
      autoClose: 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true
    });
  };

  const fetchAsistentes = async (eventId) => {
  try {
    setLoading(true);
    console.log("🚀 [fetchAsistentes] Iniciando fetch para eventId:", eventId);

    const { success, data, message } = await ScannerAPI.syncAttendees(eventId);
    console.log("📡 [fetchAsistentes] Respuesta API:", { success, data, message });

    if (!success) {
      throw new Error(message || 'Error al sincronizar asistentes');
    }

    const attendees = Array.isArray(data?.asistentes) ? data.asistentes : 
                      Array.isArray(data?.attendees) ? data.attendees : [];
    console.log("📋 [fetchAsistentes] Raw attendees:", attendees);

    // Normalización de datos
    const normalized = attendees.map(a => ({
      id: a.id,
      ticket_code: a.ticket_code,
      nombre: a.nombre || 'Invitado',
      status: a.status || 'PENDING'
    }));
    console.log("✅ [fetchAsistentes] Normalizados:", normalized);

    // Actualiza ambos estados
    setAsistentes(prev => {
      const nuevo = { ...prev, [eventId]: normalized };
      console.log("🗂 [fetchAsistentes] setAsistentes:", nuevo);
      return nuevo;
    });

    setAsistentesIndex(prev => {
      const nuevo = {
        ...prev,
        [eventId]: normalized.reduce((acc, a) => {
          if (a.ticket_code) acc[a.ticket_code] = a;
          if (a.id) acc[a.id] = a;
          return acc;
        }, {})
      };
      console.log("🔑 [fetchAsistentes] setAsistentesIndex:", nuevo);
      return nuevo;
    });

    return normalized;
  } catch (error) {
    console.error('❌ [fetchAsistentes] error:', error);
    showToast(error.message, 'error');
    return [];
  } finally {
    setLoading(false);
  }
};


  const selectEvento = async (evento) => {
  setLoading(true);
  try {
    const id = evento.event_id;
    setEventoSeleccionado(evento);
    setEventId(id);

    // Usa directamente el API mejorado
    const asistentes = await fetchAsistentes(id);
    
    setIsEventoDisponible(asistentes.length > 0);
  } catch (error) {
    setError(error.message);
    setIsEventoDisponible(false);
  } finally {
    setLoading(false);
  }
};

  // ========== NUEVAS FUNCIONES OPTIMIZADAS ==========
  // Actualización individual de asistente (nueva)
  const updateAsistenteStatus = useCallback((asistenteId, newStatus) => {
  if (!eventoSeleccionado) {
    console.warn("No hay evento seleccionado");
    return false;
  }

  const currentAsistentes = asistentes[eventoSeleccionado.event_id] || [];
  const asistente = currentAsistentes.find(a => a.id === asistenteId);

  if (!asistente) {
    console.warn("Asistente no encontrado en memoria:", asistenteId);
    return false;
  }

  if (asistente.status === newStatus) {
    console.log("El asistente ya tiene el mismo estado:", newStatus);
    return false;
  }

  // Actualización optimizada
  const updated = [...currentAsistentes];
  const index = updated.findIndex(a => a.id === asistenteId);
  updated[index] = { ...updated[index], status: newStatus };

  // Actualiza estado principal
  setAsistentes(prev => ({
    ...prev,
    [eventoSeleccionado.event_id]: updated
  }));

  // Actualiza índice para búsqueda rápida
  setAsistentesIndex(prev => {
    const eventIndex = prev[eventoSeleccionado.event_id] || {};
    return {
      ...prev,
      [eventoSeleccionado.event_id]: {
        ...eventIndex,
        [asistenteId]: { ...asistente, status: newStatus },
        ...(asistente.ticket_code
          ? { [asistente.ticket_code]: { ...asistente, status: newStatus } }
          : {})
      }
    };
  });

  console.log("✅ Estado actualizado para asistente:", asistenteId, "->", newStatus);
  return true;
}, [eventoSeleccionado, asistentes, setAsistentes, setAsistentesIndex]);


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
  }, [updateBulkAsistentes,eventoSeleccionado]);

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