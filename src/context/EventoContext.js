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
  let isActive = true;

  const loadInitialData = async () => {
    try {
      setLoading(true);

      const { success, data: events } = await ScannerAPI.getActiveEvents();
      if (!isActive) return;

      if (success && events.length > 0) {
        setEventos(events);

        // Selecciona el evento que esté activo hoy
        const today = new Date();
        const todayEvent = events.find(e => {
          const start = new Date(e.event_start_date);
          const end = new Date(e.event_end_date);
          return today >= start && today <= end;
        });

        if (todayEvent) {
          const loadedAsistentes = await loadAsistentes(todayEvent.event_id);

          if (isActive) {
            setEventoSeleccionado({
              ...todayEvent,
              asistentes: loadedAsistentes || []
            });
            setAsistentesCargados(true);
          }
        } else {
          // No hay evento hoy: bloquear escaneo
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
        toast.error('Error al cargar eventos');
      }
    } finally {
      if (isActive) setLoading(false);
    }
  };

  loadInitialData();

  return () => {
    isActive = false;
  };
}, [loadAsistentes]);


  // Función para actualizar estado de asistenteconst 
  const updateAsistenteStatus = useCallback((asistenteId, newStatus, fullData = null) => {
  if (!eventoSeleccionado) return false;

  const normalizedId = String(asistenteId);
  const eventId = eventoSeleccionado.event_id;

  setAsistentes(prev => {
    const current = prev[eventId] || [];
    const idx = current.findIndex(a => String(a.id) === normalizedId);
    
    if (idx === -1 && !fullData) return prev;

    const updated = [...current];
    if (idx !== -1) {
      updated[idx] = { ...updated[idx], status: newStatus, ...(fullData || {}) };
    } else {
      updated.push({ ...fullData, status: newStatus, id: normalizedId });
    }

    return { ...prev, [eventId]: updated };
  });

  // Actualización sincronizada de eventoSeleccionado
  setEventoSeleccionado(prev => {
    if (!prev) return prev;
    
    const currentAsistentes = prev.asistentes || [];
    const idx = currentAsistentes.findIndex(a => String(a.id) === normalizedId);

    let updatedAsistentes;
    if (idx !== -1) {
      updatedAsistentes = [...currentAsistentes];
      updatedAsistentes[idx] = { 
        ...updatedAsistentes[idx], 
        status: newStatus, 
        ...(fullData || {}) 
      };
    } else if (fullData) {
      updatedAsistentes = [...currentAsistentes, { ...fullData, status: newStatus }];
    } else {
      return prev; // No hay cambios posibles
    }

    return { ...prev, asistentes: updatedAsistentes };
  });

  return true;
}, [eventoSeleccionado]);

  //funcion para llamar a la api y cargar los asistentes de un evento
    const loadAsistentes = useCallback(async (eventId) => {
  const normalizedEventId = String(eventId);
  try {
    const result = await ScannerAPI.syncAttendees(normalizedEventId);
    if (result.success) {
      const asistentesNormalizados = result.data.map(a => ({
        ...a,
        id: String(a.id) // Normaliza IDs
      }));
      
      setAsistentes(prev => ({
        ...prev,
        [normalizedEventId]: asistentesNormalizados
      }));
      
      return asistentesNormalizados; // Devuelve datos para fusionar
    }
    return null;
  } catch (error) {
    console.error('[Asistentes] Error:', error);
    return null;
  }
}, []);

const addToBuffer = useCallback((scanData) => {
  // Agrega el scan al buffer
  syncBufferRef.current.push(scanData);

  // Persistir en localStorage
  localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));

  // Intentar sincronizar automáticamente si estamos online
  if (isOnline) syncBuffer();
}, [isOnline]);

const syncBuffer = useCallback(async () => {
  if (!isOnline || syncBufferRef.current.length === 0) return;

  try {
    const bufferCopy = [...syncBufferRef.current];
    
    // Extraer solo los IDs de los tickets y eliminar duplicados
    const ticketIds = [...new Set(bufferCopy.map(item => item.ticket_id))];
    console.log(`[SyncBuffer] ${ticketIds.length} escaneos únicos a sincronizar:`, ticketIds);

    const response = await ScannerAPI.markMultipleAsScanned(ticketIds);

    if (response.success) {
      // Limpiar buffer si fue exitoso
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


  // Función centralizada de validación
  const validarTicket = useCallback(async (eventId, ticketCode) => {
  try {
    const normalizedEventId = String(eventId);
    const normalizedTicketCode = String(ticketCode).toLowerCase().trim();

    // 1. Buscar en eventoSeleccionado.asistentes (si existe)
    const asistenteLocal = eventoSeleccionado?.asistentes?.find(a => 
      String(a.ticket_code).toLowerCase() === normalizedTicketCode || 
      String(a.id).toLowerCase() === normalizedTicketCode
    );

    if (asistenteLocal) {
      if (asistenteLocal.status === 'SCANNED') {
        return { 
          success: false, 
          type: 'ya-validado', 
          message: `Ticket ya validado: ${asistenteLocal.nombre}`,
          asistente: asistenteLocal
        };
      }

      // Actualiza ambos estados (global y eventoSeleccionado)
      updateAsistenteStatus(asistenteLocal.id, 'SCANNED');
      
      addToBuffer({
        ticket_id: String(asistenteLocal.id),
        event_id: normalizedEventId,
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
    const checkResult = await ScannerAPI.checkTicketStatus(normalizedEventId, normalizedTicketCode);
    
    if (checkResult.success && checkResult.data?.asistente) {
      const asistente = checkResult.data.asistente;
      const { valid } = checkResult.data;
      
      if (!valid) {
        return { 
          success: false, 
          type: 'invalid', 
          message: 'Ticket no válido para este evento' 
        };
      }

      // Normalizamos los datos del asistente
      const normalizedAsistente = {
        ...asistente,
        id: String(asistente.id),
        event_id: normalizedEventId
      };

      // Actualiza ambos estados
      updateAsistenteStatus(asistente.id, 'SCANNED', normalizedAsistente);
      
      addToBuffer({
        ticket_id: String(asistente.id),
        event_id: normalizedEventId,
        status: 'SCANNED',
        source: 'backend',
        asistente: normalizedAsistente
      });

      return { 
        success: true, 
        type: 'valid', 
        message: `Validado: ${asistente.nombre}`,
        asistente: normalizedAsistente
      };
    }

    return { 
      success: false, 
      type: 'error', 
      message: checkResult.message || 'Error al validar ticket' 
    };

  } catch (error) {
    console.error('[Validación] Error:', error);
    return { 
      success: false, 
      type: 'error', 
      message: error.message || 'Error inesperado' 
    };
  }
}, [eventoSeleccionado, updateAsistenteStatus, addToBuffer]);

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