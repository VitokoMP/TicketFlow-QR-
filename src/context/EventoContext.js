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
  // 🧠 ÁRBITRO DE ESTADO ÚNICO
  // -----------------------
  const applyAsistenteUpdate = useCallback((eventId, update) => {
    setAsistentes(prev => {
      const current = prev[eventId] || [];
      const idx = current.findIndex(a => String(a.id) === String(update.id));

      let updated;

      if (idx !== -1) {
        const existing = current[idx];
        
        // 🔥 Regla única: SCANNED es monótono
        const newStatus = existing.status === 'SCANNED' 
          ? 'SCANNED'  // Preservar SCANNED
          : update.status || existing.status || 'PENDING';

        const merged = {
          ...existing,
          ...update,
          status: newStatus,
          updatedAt: Date.now()
        };

        updated = [...current];
        updated[idx] = merged;
        
        console.log(`[applyAsistenteUpdate] ${update.id}: ${existing.status} → ${merged.status}`);
      } else {
        updated = [...current, { 
          ...update, 
          status: update.status || 'PENDING',
          updatedAt: Date.now() 
        }];
      }

      return {
        ...prev,
        [eventId]: updated
      };
    });

    // ✅ Ya NO actualizamos eventoSeleccionado.asistentes
    // La UI lee directamente de asistentes[eventId]
  }, []);

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

  // -----------------------
  // Funciones memoizadas
  // -----------------------
  const updateAsistenteStatus = useCallback((asistenteId, newStatus, fullData = null) => {
    if (!eventoSeleccionado) return false;

    const eventId = eventoSeleccionado.event_id;
    
    applyAsistenteUpdate(eventId, {
      id: asistenteId,
      status: newStatus,
      ...(fullData || {})
    });

    return true;
  }, [eventoSeleccionado, applyAsistenteUpdate]);

  const loadAsistentes = useCallback(async (eventId) => {
    const normalizedEventId = String(eventId);
    try {
      console.log(`🔍 [DEBUG] Cargando asistentes para evento: ${normalizedEventId}`);
      const result = await ScannerAPI.syncAttendees(normalizedEventId);
      
      if (result.success) {
        const asistentesNormalizados = result.data.map(a => ({
          ...a,
          id: String(a.id),
          status: (a.status || 'PENDING').toUpperCase()
        }));

        console.log(`🔍 [DEBUG] Asistentes cargados desde API:`, asistentesNormalizados);

        // ✅ Usar el árbitro para cada asistente
        if (asistentesNormalizados.length > 0) {
          asistentesNormalizados.forEach(a => {
            applyAsistenteUpdate(normalizedEventId, a);
          });
        } else {
          // Servidor vacío → conservar locales (el árbitro ya lo hace)
          console.warn('[loadAsistentes] Servidor devolvió vacío, conservando datos locales');
        }
        
        return asistentesNormalizados;
      }
      return null;
    } catch (error) {
      console.error('[Asistentes] Error:', error);
      return null;
    }
  }, [applyAsistenteUpdate]);

  const addToBuffer = useCallback((scanData) => {
    syncBufferRef.current.push(scanData);
    localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
    console.log(`[Buffer] Agregado. Total: ${syncBufferRef.current.length}`);
  }, []);

  const syncBuffer = useCallback(async () => {
    if (!isOnline || syncBufferRef.current.length === 0) return;

    try {
      const bufferCopy = [...syncBufferRef.current];
      const ticketIds = [...new Set(bufferCopy.map(item => item.ticket_id))];

      console.log(`[SyncBuffer] ${ticketIds.length} escaneos únicos a sincronizar:`, ticketIds);

      const response = await ScannerAPI.markMultipleAsScanned(ticketIds);

      if (response.success) {
        // Actualizar estado local con confirmación del servidor
        ticketIds.forEach(id => {
          applyAsistenteUpdate(eventoSeleccionado?.event_id, {
            id: id,
            status: 'SCANNED',
            synced: true,
            syncedAt: Date.now()
          });
        });

        syncBufferRef.current = [];
        localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
        console.log(`[SyncBuffer] ${ticketIds.length} escaneos sincronizados`);
      } else {
        console.warn('[SyncBuffer] Falló la sincronización:', response.message);
      }
    } catch (error) {
      console.error('[SyncBuffer] Error sincronizando buffer', error);
    }
  }, [isOnline, eventoSeleccionado, applyAsistenteUpdate]);

  const validarTicket = useCallback(async (eventId, ticketCode) => {
    try {
      const normalizedEventId = String(eventId);
      const normalizedTicketCode = String(ticketCode).toLowerCase().trim();

      console.log(`🔍 [DEBUG] Validando ticket: ${normalizedTicketCode} para evento: ${normalizedEventId}`);

      // ✅ Única fuente de verdad: asistentes[eventId]
      const asistente = asistentes[eventId]?.find(a => 
        String(a.ticket_code).toLowerCase() === normalizedTicketCode || 
        String(a.id).toLowerCase() === normalizedTicketCode
      );

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
        
        // ✅ Usar el árbitro
        applyAsistenteUpdate(normalizedEventId, {
          id: asistente.id,
          status: 'SCANNED'
        });
        
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
  }, [asistentes, applyAsistenteUpdate]);

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

            if (isActive) {
              console.log('🔍 [DEBUG] Configurando estado final...');

              // ✅ Solo el evento, sin asistentes
              setEventoSeleccionado(todayEvent);

              // Si hay asistentes, ya se cargaron vía applyAsistenteUpdate
              // en loadAsistentes, pero si no hay, conservamos locales
              
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
            
            // ✅ Cargar asistentes vía árbitro
            demoAsistentes.forEach(a => {
              applyAsistenteUpdate('evt_001', a);
            });
            
            setEventoSeleccionado(demoEvents[0]);
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
  }, [loadAsistentes, applyAsistenteUpdate]);

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
    applyAsistenteUpdate,
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
    syncBuffer,
    applyAsistenteUpdate
  ]);

  return (
    <EventoContext.Provider value={contextValue}>
      {children}
    </EventoContext.Provider>
  );
};