import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ScannerAPI } from "../services/ApiService";
import { toast } from 'react-toastify';

const EventoContext = createContext();

export function useEvento() {
  const context = useContext(EventoContext);
  if (!context) throw new Error("useEvento debe usarse dentro de EventoProvider");
  return context;
}

export const EventoProvider = ({ children }) => {
  // -----------------------
  // Estados y refs
  // -----------------------
  const [eventos, setEventos] = useState([]);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const [asistentes, setAsistentes] = useState({});
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [asistentesCargados, setAsistentesCargados] = useState(false);
  const isMounted = useRef(true);
  const syncBufferRef = useRef([]);
  const syncTimerRef = useRef(null);
  const retryCountRef = useRef(0);

  // -----------------------
  // Debugs de estado
  // -----------------------
  useEffect(() => {
    console.log('🔍 [DEBUG] Estado global asistentes actualizado:', asistentes);
  }, [asistentes]);

  useEffect(() => {
    console.log('🔍 [DEBUG] eventoSeleccionado actualizado:', eventoSeleccionado);
  }, [eventoSeleccionado]);

  // -----------------------
  // Montaje / Desmontaje
  // -----------------------
  useEffect(() => {
//    localStorage.removeItem('ticketflow_asistentes');
    const savedBuffer = localStorage.getItem('ticketflow_pending_scans');
    if (savedBuffer) syncBufferRef.current = JSON.parse(savedBuffer);

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
  if (Object.keys(asistentes).length > 0) {
    localStorage.setItem('ticketflow_asistentes', JSON.stringify(asistentes));
  }
}, [asistentes]);

// Cargar datos guardados al iniciar
useEffect(() => {
  const saved = localStorage.getItem('ticketflow_asistentes');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      setAsistentes(parsed);
      console.log('[EventoContext] Asistentes cargados desde localStorage:', Object.keys(parsed).length);
    } catch (e) {
      console.error('[EventoContext] Error al cargar localStorage:', e);
    }
  }
}, []);

  useEffect(() => {
    localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
  }, [syncBufferRef.current.length]);

  // -----------------------
  // Funciones memoizadas
  // -----------------------
  const updateAsistenteStatus = useCallback((asistenteId, newStatus, fullData = null) => {
    if (!eventoSeleccionado) return false;

    const normalizedId = String(asistenteId);
    const eventId = eventoSeleccionado.event_id;

    console.log(`🔍 [DEBUG] Actualizando estado asistente ${normalizedId} a ${newStatus}`);

    setAsistentes(prev => {
      const current = prev[eventId] || [];
      const idx = current.findIndex(a => String(a.id) === normalizedId);
      
      const updated = [...current];
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], status: newStatus, ...(fullData || {}) };
        console.log(`[DEBUG] Actualizando asistente ${normalizedId}:`, updated[idx]);

      } else if (fullData) {
        updated.push({ ...fullData, status: newStatus, id: normalizedId });
      }

      return { ...prev, [eventId]: updated };
    });

    setEventoSeleccionado(prev => {
      if (!prev) return prev;
      const currentAsistentes = prev.asistentes || [];
      const idx = currentAsistentes.findIndex(a => String(a.id) === normalizedId);

      let updatedAsistentes;
      if (idx !== -1) {
        updatedAsistentes = [...currentAsistentes];
        updatedAsistentes[idx] = { ...updatedAsistentes[idx], status: newStatus, ...(fullData || {}) };
      } else if (fullData) {
        updatedAsistentes = [...currentAsistentes, { ...fullData, status: newStatus }];
      } else {
        return prev;
      }

      return { ...prev, asistentes: updatedAsistentes };
    });

    return true;
  }, [eventoSeleccionado]);

  const loadAsistentes = useCallback(async (eventId) => {
    const normalizedEventId = String(eventId);
    try {
      console.log(`🔍 [DEBUG] Cargando asistentes para evento: ${normalizedEventId}`);
      const result = await ScannerAPI.syncAttendees(normalizedEventId);
      
      if (result.success) {
        const asistentesNormalizados = result.data.map(a => ({
          ...a,
          id: String(a.id),
          status: a.status.toUpperCase() // SCANNED o PENDING
        }));

        console.log(`🔍 [DEBUG] Asistentes cargados desde API:`, asistentesNormalizados);
        
        setAsistentes(prev => ({
          ...prev,
          [normalizedEventId]: asistentesNormalizados
        }));

        if (eventoSeleccionado && eventoSeleccionado.event_id === normalizedEventId) {
          setEventoSeleccionado(prev => ({
            ...prev,
            asistentes: asistentesNormalizados
          }));
        }
        
        return asistentesNormalizados;
      }
      return null;
    } catch (error) {
      console.error('[Asistentes] Error:', error);
      return null;
    }
  }, [eventoSeleccionado]);

  const addToBuffer = useCallback((scanData) => {
    syncBufferRef.current.push(scanData);
    localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
    //if (isOnline) syncBuffer();
    console.log(`[Buffer] Agregado. Total: ${syncBufferRef.current.length}`);

  }, [isOnline]);

  const syncBuffer = useCallback(async () => {
    if (!isOnline || syncBufferRef.current.length === 0) return;

    try {
      const bufferCopy = [...syncBufferRef.current];
      const ticketIds = [...new Set(bufferCopy.map(item => item.ticket_id))];

      console.log(`[SyncBuffer] ${ticketIds.length} escaneos únicos a sincronizar:`, ticketIds);

      const response = await ScannerAPI.markMultipleAsScanned(ticketIds);

      if (response.success) {
        syncBufferRef.current = [];
        localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
        console.log(`[SyncBuffer] ${ticketIds.length} escaneos sincronizados`);
      } else {
        console.warn('[SyncBuffer] Falló la sincronización:', response.message);
      }
    } catch (error) {
      console.error('[SyncBuffer] Error sincronizando buffer', error);
    }
  }, [isOnline]);

const validarTicket = useCallback((eventId, ticketCode) => {
  const normalizedEventId = String(eventId);
  const normalizedTicketCode = String(ticketCode).toLowerCase().trim();

  console.log(`🔍 [DEBUG] Validando ticket OFFLINE: ${normalizedTicketCode}`);

  const asistente = asistentes[normalizedEventId]?.find(a => 
    String(a.ticket_code).toLowerCase() === normalizedTicketCode || 
    String(a.id).toLowerCase() === normalizedTicketCode
  );

  if (!asistente) {
    return { 
      success: false, 
      type: 'invalid', 
      message: 'Ticket no válido para este evento'
    };
  }

  if (asistente.status === 'SCANNED') {
    return { 
      success: false, 
      type: 'ya-validado', 
      message: `Ticket ya validado: ${asistente.nombre}`,
      asistente 
    };
  }

  updateAsistenteStatus(asistente.id, 'SCANNED');
  
  syncBufferRef.current.push({ 
    ticket_id: String(asistente.id), 
    event_id: normalizedEventId, 
    status: 'SCANNED', 
    source: 'local',
    scanned_at: new Date().toISOString()
  });
  localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));

  return { 
    success: true, 
    type: 'valid', 
    message: `Validado: ${asistente.nombre}`,
    asistente: { ...asistente, status: 'SCANNED' }
  };
}, [asistentes, updateAsistenteStatus]);
  // -----------------------
  // Cargar eventos al inicio
  // -----------------------
useEffect(() => {
  let isActive = true;

  const loadInitialData = async () => {
    try {
      setLoading(true);

      const { success, data: events } = await ScannerAPI.getActiveEvents();
      if (!isActive) return;

      if (success && events.length > 0) {
        setEventos(events);

        setEventoSeleccionado(null);
        setAsistentesCargados(false);

      } else {
        toast.info('No hay eventos activos en la plataforma.');
        setEventoSeleccionado(null);
        setAsistentesCargados(false);
      }

    } catch (error) {
      if (isActive) {
        console.error('[Eventos] Error:', error);
        toast.error('Error al cargar eventos');
      }
    } finally {
      if (isActive) setLoading(false);
    }
  };

  loadInitialData();
  return () => { isActive = false; };
}, []);
  // Memoizar value del Provider
  // -----------------------
  const contextValue = useMemo(() => ({
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
  }), [
    eventos,
    asistentes,
    loading,
    eventoSeleccionado,
    asistentesCargados,
    loadAsistentes,
    validarTicket,
    updateAsistenteStatus,
    addToBuffer,
    syncBuffer
  ]);

  return (
    <EventoContext.Provider value={contextValue}>
      {children}
    </EventoContext.Provider>
  );
};
