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
    // Restaurar asistentes desde localStorage en lugar de borrar
    const savedAsistentes = localStorage.getItem('ticketflow_asistentes');
    if (savedAsistentes) {
      try {
        setAsistentes(JSON.parse(savedAsistentes));
        console.log('[EventoContext] Asistentes restaurados desde localStorage');
      } catch (error) {
        console.warn('[EventoContext] Error restaurando asistentes:', error);
        localStorage.removeItem('ticketflow_asistentes');
      }
    }

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
    localStorage.setItem('ticketflow_asistentes', JSON.stringify(asistentes));
  }, [asistentes]);

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

const validarTicket = useCallback(async (eventId, ticketCode) => {
  try {
    const normalizedEventId = String(eventId);
    const normalizedTicketCode = String(ticketCode).toLowerCase().trim();

    console.log(`🔍 [DEBUG] Validando ticket: ${normalizedTicketCode} para evento: ${normalizedEventId}`);

    const asistenteFromSelected = eventoSeleccionado?.asistentes?.find(a => 
      String(a.ticket_code).toLowerCase() === normalizedTicketCode || 
      String(a.id).toLowerCase() === normalizedTicketCode
    );

    const asistenteFromGlobal = asistentes[eventId]?.find(a => 
      String(a.ticket_code).toLowerCase() === normalizedTicketCode || 
      String(a.id).toLowerCase() === normalizedTicketCode
    );

    const asistente = asistenteFromSelected || asistenteFromGlobal;

    // ✅ CASO 1: Ticket encontrado en caché
    if (asistente) {
      console.log(`🔍 [DEBUG] Asistente encontrado:`, asistente);
      
      if (asistente.status === 'SCANNED') {
        console.log(`🔍 [DEBUG] Ticket ya validado anteriormente`);
        return { 
          success: false, 
          type: 'ya-validado', 
          message: `Ticket ya validado: ${asistente.nombre}`,
          asistente 
        };
      }

      console.log(`🔍 [DEBUG] Marcando como SCANNED...`);
      updateAsistenteStatus(asistente.id, 'SCANNED');
      
      // ✅ Usar push directo, no addToBuffer
      syncBufferRef.current.push({ 
        ticket_id: String(asistente.id), 
        event_id: normalizedEventId, 
        status: 'SCANNED', 
        source: 'local' 
      });
      localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));

      return { 
        success: true, 
        type: 'valid', 
        message: `Validado: ${asistente.nombre}`,
        asistente 
      };
    }

    // ✅ CASO 2: Ticket NO encontrado → INVÁLIDO (SIN BACKEND)
    console.log(`🔍 [DEBUG] Ticket NO encontrado en caché`);
    return { 
      success: false, 
      type: 'invalid', 
      message: 'Ticket no válido para este evento. Sincroniza los asistentes si crees que debería estar.'
    };

  } catch (error) {
    console.error('[Validación] Error:', error);
    return { 
      success: false, 
      type: 'error', 
      message: error.message || 'Error inesperado' 
    };
  }
}, [eventoSeleccionado, asistentes, updateAsistenteStatus]);

  // -----------------------
  // Cargar eventos al inicio
  // -----------------------
  useEffect(() => {
    let isActive = true;

    const loadInitialData = async () => {
  try {
    setLoading(true);
    console.log('🔍 [DEBUG] Iniciando carga inicial de datos...');

    const { success, data: events } = await ScannerAPI.getActiveEvents();
    if (!isActive) return;

    if (success && events.length > 0) {
      setEventos(events);

      // Solo una vez, para comparar fechas sin horas
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayEvent = events.find(e => {
        const start = new Date(e.event_start_date);
        const end = new Date(e.event_end_date);

        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);

        return today >= start && today <= end;
      });

      if (todayEvent) {
        console.log(`🔍 [DEBUG] Evento encontrado para hoy:`, todayEvent);

        const loadedAsistentes = await loadAsistentes(todayEvent.event_id);

        if (isActive && loadedAsistentes) {
          console.log('🔍 [DEBUG] Configurando estado final...');

          setEventoSeleccionado({
            ...todayEvent,
            asistentes: loadedAsistentes
          });

          setAsistentesCargados(true);
          console.log('🔍 [DEBUG] Carga inicial completada exitosamente');
        }
      } else {
        if (isActive) {
          setEventoSeleccionado(null);
          setAsistentesCargados(false);
          toast.info('No hay eventos activos para hoy. El escáner está deshabilitado.');
        }
      }
    } else {
      toast.info('No hay eventos activos en la plataforma.');
      setEventoSeleccionado(null);
      setAsistentesCargados(false);
    }
  } catch (error) {
    if (isActive) {
      console.error('[Eventos] Error:', error);
      
   
    // ✅ EN DEMO MODE: cargar eventos fake
    if (window.TICKET_FLOW_DEMO === 'true') {
      console.log('🎭 DEMO MODE: Cargando eventos fake...');
      const demoEvents = [
        { event_id: 'evt_001', nombre: 'Conferencia Tech 2025', event_start_date: new Date().toISOString(), event_end_date: new Date().toISOString() },
        { event_id: 'evt_002', nombre: 'Festival Música Santiago', event_start_date: new Date().toISOString(), event_end_date: new Date().toISOString() }
      ];
      setEventos(demoEvents);
      
      const demoAsistentes = [
        { id: 'tkt_001', ticket_code: 'QR001', nombre: 'Juan Pérez', status: 'PENDING' },
        { id: 'tkt_002', ticket_code: 'QR002', nombre: 'María García', status: 'PENDING' },
        { id: 'tkt_003', ticket_code: 'QR003', nombre: 'Carlos López', status: 'PENDING' }
      ];
      
      setEventoSeleccionado({
        ...demoEvents[0],
        asistentes: demoAsistentes
      });
      setAsistentes({ 'evt_001': demoAsistentes });
      setAsistentesCargados(true);
    } else {
      toast.error('Error al cargar eventos');
    }
  

    }
  } finally {
    if (isActive) setLoading(false);
  }
};

    loadInitialData();
    return () => { isActive = false; };
  }, [loadAsistentes]);

  // -----------------------
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
