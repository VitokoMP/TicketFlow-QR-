import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { ScannerAPI } from "../services/ApiService";
import { toast } from 'react-toastify';

const EventoContext = createContext();

export function useEvento() {
  const context = useContext(EventoContext);
  if (!context) throw new Error("useEvento debe usarse dentro de EventoProvider");
  return context;
}

export const EventoProvider = ({ children }) => {
  // Estados principales
  const [eventos, setEventos] = useState([]);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const [asistentes, setAsistentes] = useState({});
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [asistentesCargados, setAsistentesCargados] = useState(false);
  // Refs para estado persistente
  const isMounted = useRef(true);
  const syncBufferRef = useRef([]);
  const syncTimerRef = useRef(null);
  const retryCountRef = useRef(0);

  // Efectos de montaje/desmontaje
  useEffect(() => {
    // Cargar estado persistente
    const savedAsistentes = localStorage.getItem('ticketflow_asistentes');
    const savedBuffer = localStorage.getItem('ticketflow_pending_scans');
    if (savedAsistentes) setAsistentes(JSON.parse(savedAsistentes));
    if (savedBuffer) syncBufferRef.current = JSON.parse(savedBuffer);

    // Detectar cambios de conexión
    const handleOnline = () => {
      setIsOnline(true);
      if (syncBufferRef.current.length > 0) syncBuffer();
    };
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      isMounted.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Persistir cambios
  useEffect(() => {
    localStorage.setItem('ticketflow_asistentes', JSON.stringify(asistentes));
  }, [asistentes]);

  useEffect(() => {
    localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
  }, [syncBufferRef.current.length]);

  // Justo después de tus otros useEffect, dentro del EventoProvider:

  // 🔹 Cargar eventos activos al montar el provider
  useEffect(() => {
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const { success, data: events } = await ScannerAPI.getActiveEvents();
      if (success && events.length > 0) {
        setEventos(events);
        const firstEvent = events[0];
        setEventoSeleccionado(firstEvent);
        const loaded = await loadAsistentes(firstEvent.event_id);
        setAsistentesCargados(loaded); // ahora sí se actualiza
      }
    } catch (error) {
      console.error('[Eventos] Error cargando eventos:', error);
    } finally {
      setLoading(false);
    }
  };

  loadInitialData();
}, [loadAsistentes]);

  // Función para actualizar estado de asistente
  const updateAsistenteStatus = useCallback((asistenteId, newStatus, fullData = null) => {
    if (!eventoSeleccionado) return false;
    
    setAsistentes(prev => {
      const current = prev[eventoSeleccionado.event_id] || [];
      const idx = current.findIndex(a => a.id === asistenteId);
      if (idx === -1 && !fullData) return prev;

      const updated = [...current];
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], status: newStatus, ...(fullData || {}) };
      } else {
        updated.push({ ...fullData, status: newStatus });
      }

      return { ...prev, [eventoSeleccionado.event_id]: updated };
    });
    
    return true;
  }, [eventoSeleccionado]);

  // Función para agregar al buffer de sincronización
  const addToBuffer = useCallback((scanData) => {
    const entry = {
      ...scanData,
      timestamp: new Date().toISOString(),
      attempts: 0
    };
    
    syncBufferRef.current = [...syncBufferRef.current, entry];
    
    if (isOnline) {
      if (syncBufferRef.current.length >= 5) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncBuffer();
      } else if (!syncTimerRef.current) {
        syncTimerRef.current = setTimeout(syncBuffer, 10000);
      }
    }
  }, [isOnline]);

  // Función de sincronización con el backend
  const syncBuffer = useCallback(async () => {
    if (syncBufferRef.current.length === 0 || !isOnline || !eventoSeleccionado) return;
    
    const bufferToSend = [...syncBufferRef.current];
    console.log('[Sincronización] Iniciando sync con', bufferToSend.length, 'cambios');

    try {
      setLoading(true);
      const result = await ScannerAPI.syncAttendeesBatch({
        eventId: eventoSeleccionado.event_id,
        changes: bufferToSend
      });

      if (result.success) {
        console.log('[Sincronización] Exitosa - Actualizando estado');
        syncBufferRef.current = [];
        retryCountRef.current = 0;
      } else {
        throw new Error(result.message || 'Error en sincronización');
      }
    } catch (error) {
      console.error('[Sincronización] Error:', error);
      
      // Reintento con backoff exponencial
      retryCountRef.current++;
      const delay = Math.min(5000 * Math.pow(2, retryCountRef.current - 1), 30000);
      syncTimerRef.current = setTimeout(syncBuffer, delay);
      
      syncBufferRef.current = bufferToSend.map(item => ({
        ...item,
        attempts: item.attempts + 1
      }));
    } finally {
      setLoading(false);
      syncTimerRef.current = null;
    }
  }, [eventoSeleccionado, isOnline]);

  //funcion para llamar a la api y cargar los asistentes de un evento
    const loadAsistentes = useCallback(async (eventId) => {
    try {
      setLoading(true);
      const result = await ScannerAPI.getAttendees(eventId);
      if (result.success) {
        setAsistentes(prev => ({ 
          ...prev, 
          [eventId]: result.data 
        }));
        return true; // Indica éxito
      }
      toast.error(result.message || "Error cargando asistentes");
      return false;
    } catch (error) {
      console.error('[Asistentes] Error:', error);
      toast.error("Error de conexión al cargar asistentes");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Función centralizada de validación
  const validarTicket = useCallback(async (eventId, ticketCode) => {
    try {
      const asistentesEvento = asistentes[eventId] || [];
      console.log('[Validación] Asistentes para este evento:', asistentesEvento);

      // 1. Buscar localmente
      const asistenteLocal = asistentesEvento.find(a => 
        a.ticket_code === ticketCode || a.id === ticketCode
      );

      if (asistenteLocal) {
      console.log('[Validación] Ticket encontrado localmente:', asistenteLocal); // <-- log aquí
        if (asistenteLocal.status === 'SCANNED') {
          return { 
            success: false, 
            type: 'ya-validado', 
            message: `Ticket ya validado: ${asistenteLocal.nombre}`,
            asistente: asistenteLocal
          };
        }

        updateAsistenteStatus(asistenteLocal.id, 'SCANNED');
        addToBuffer({
          ticket_id: asistenteLocal.id,
          event_id: eventId,
          status: 'SCANNED',
          source: 'local'
        });

        return { 
          success: true, 
          type: 'valid', 
          message: `Validado: ${asistenteLocal.nombre}`,
          asistente: asistenteLocal
        };
      }

      // 2. Validar con backend si no está localmente
      const checkResult = await ScannerAPI.checkTicketStatus(eventId, ticketCode);
      
      if (checkResult.success && checkResult.data?.asistente) {
        console.log('[Validación] Ticket encontrado en backend:', checkResult.data.asistente); // <-- log aquí
      }
      if (!checkResult.success) {
        return { 
          success: false, 
          type: 'error', 
          message: checkResult.message || 'Error al validar ticket' 
        };
      }

      const { asistente, valid } = checkResult.data;
      if (!valid || !asistente) {
        return { 
          success: false, 
          type: 'invalid', 
          message: 'Ticket no válido para este evento' 
        };
      }

      updateAsistenteStatus(asistente.id, 'SCANNED', asistente);
      addToBuffer({
        ticket_id: asistente.id,
        event_id: eventId,
        status: 'SCANNED',
        source: 'backend',
        asistente
      });

      return { 
        success: true, 
        type: 'valid', 
        message: `Validado: ${asistente.nombre}`,
        asistente
      };

    } catch (error) {
      console.error('[Validación] Error:', error);
      return { 
        success: false, 
        type: 'error', 
        message: error.message || 'Error inesperado' 
      };
    }
  }, [asistentes, updateAsistenteStatus, addToBuffer]);

  return (
    <EventoContext.Provider
      value={{
        eventos,
        asistentes,
        loading,
        eventoSeleccionado,
        asistentesCargados,
        loadAsistentes,
        validarTicket,
        updateAsistenteStatus,
        addToBuffer,
        syncBuffer,
        setEventos,
        setEventoSeleccionado,
        setLoading,
        setAsistentes
      }}
    >
      {children}
    </EventoContext.Provider>
  );
};