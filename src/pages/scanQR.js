import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/ApiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';

const OPTIMAL_SCAN_DELAY = 200;
const API_TIMEOUT = 1000;
const MIN_DISPLAY_TIME = 800;
const ERROR_DISPLAY_TIME = 1000;
const STOP_RETRY_MAX = 8;
const STOP_RETRY_BASE_MS = 120;
const MAX_BACKOFF_MS = 10000;

export default function ScanQR() {
  console.log('[ScanQR] Componente montándose');
  const {
    eventos = [],
    asistentes = {},
    setAsistentes,
    eventoSeleccionado,
    setLoading,
    selectEvento,
    updateAsistenteStatus,
    addToBuffer,
  } = useEvento();

  console.log('[ScanQR] Contexto cargado', {
    eventosCount: eventos.length,
    asistentesCount: Object.keys(asistentes).length,
    eventoSeleccionado
  });

  const [scanState, setScanState] = useState({
    cameraActive: false,
    validation: null,
    showOverlay: false,
    lastScanned: "",
    scanningPaused: false,
    scannerState: Html5QrcodeScannerState.NOT_STARTED
  });

  console.log('[ScanQR] Estado inicial:', scanState);

  // Refs
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const timeoutRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const lastEventIdRef = useRef(null);
  const isMounted = useRef(true);
  const lastScannedRef = useRef("");
  const scanningPausedRef = useRef(false);
  const validationRef = useRef(null);
  const opLockRef = useRef(false);
  const startAttemptsRef = useRef(0);
    
  const lastScanTimeRef = useRef(0);      // controla tiempo entre escaneos
  const lastProcessedTicketRef = useRef(); // controla ticket duplicado

  const runSerial = useCallback(async (fn, label = "op") => {
    console.log(`[runSerial] Iniciando operación serializada: ${label}`);
    if (opLockRef.current) {
      console.warn(`[runSerial] Omitiendo ${label}: operación previa en curso`);
      return;
    }
    opLockRef.current = true;
    try {
      console.log(`[runSerial] Ejecutando ${label}`);
      return await fn();
    } catch (error) {
      console.error(`[runSerial] Error en ${label}:`, error);
      throw error;
    } finally {
      opLockRef.current = false;
      console.log(`[runSerial] Operación ${label} completada`);
    }
  }, []);
  
const extractTicketCode = useCallback((qrText) => {
  if (!qrText) return null;
  console.log('[extractTicketCode] Extrayendo código de:', qrText);

  try {
    // Intentar tratar como URL
    const url = new URL(qrText);
    let path = url.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1); // quitar slash final
    const code = path.split('/').filter(Boolean).pop();
    console.log('[extractTicketCode] Código extraído (URL):', code);
    return code;
  } catch (err) {
    // No es URL, usar texto plano
    const text = qrText.replace(/\/$/, '').split('/').filter(Boolean).pop();
    console.log('[extractTicketCode] Código extraído (Texto plano):', text);
    return text;
  }
}, []);
  const safeCall = useCallback(async (fn, label = "") => {
    console.log(`[safeCall] Llamada segura iniciada: ${label}`);
    if (!isMounted.current) {
      console.warn('[safeCall] Componente no montado, omitiendo llamada');
      return;
    }
    try {
      const result = await fn();
      console.log(`[safeCall] Llamada ${label} exitosa`);
      return isMounted.current ? result : undefined;
    } catch (err) {
      if (isMounted.current) {
        if (err?.name === "AbortError") {
          console.warn(`[safeCall] Operación abortada (${label})`);
          return;
        }
        console.error(`[safeCall] Error en ${label || "operación"}:`, err?.message || err);
      }
    }
  }, []);

  const showToast = (message, type) => {
    console.log(`[TOAST] ${type.toUpperCase()}: ${message}`);
  };

  const normalizeUrl = useCallback((urlString) => {
    console.log('[normalizeUrl] Normalizando URL:', urlString);
    try {
      let url = new URL(urlString);
      if (url.protocol === "http:") url.protocol = "https:";
      console.log('[normalizeUrl] URL normalizada:', url.toString());
      return url.toString();
    } catch (error) {
      console.warn('[normalizeUrl] No es una URL válida, se usa texto plano');
      return urlString;
    }
  }, []);

  

  const safeStopScanner = useCallback(async () => {
    console.log('[safeStopScanner] Iniciando detención segura del escáner');
    
    if (!qrScanner.current) {
      console.warn('[safeStopScanner] No hay instancia de qrScanner');
      return;
    }

    const scanner = qrScanner.current;
    const container = document.getElementById("qr-reader");

    if (!isMounted.current) {
      console.warn('[safeStopScanner] Componente no montado, abortando');
      return;
    }

    const containerStillInDOM = () => !!container && document.body.contains(container);
    const getStateSafe = () => {
      try {
        return scanner?.getState?.();
      } catch (e) {
        console.warn('[safeStopScanner] Error al obtener estado:', e?.message || e);
        return undefined;
      }
    };

    let attempt = 0;
    while (isMounted.current) {
      const state = getStateSafe();
      console.log(`[safeStopScanner] Intento ${attempt}, estado actual:`, state);

      if (state === undefined) {
        break;
      }

      if (state !== Html5QrcodeScannerState.SCANNING && 
          state !== Html5QrcodeScannerState.NOT_STARTED) {
        console.log('[safeStopScanner] Estado adecuado para detener');
        break;
      }

      try {
        await scanner.stop();
        console.log('[safeStopScanner] Stop() exitoso desde bucle');
        break;
      } catch (err) {
        console.warn(`[safeStopScanner] Error en stop() (intento ${attempt}):`, err?.message || err);
        attempt++;
        if (attempt >= STOP_RETRY_MAX) {
          console.error('[safeStopScanner] Máximo de reintentos alcanzado');
          break;
        }

        const waitMs = STOP_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`[safeStopScanner] Esperando ${waitMs}ms antes de reintentar`);
        await new Promise(res => setTimeout(res, waitMs));
      }
    }

    try {
      if (scanner && scanner.stop && typeof scanner.stop === "function") {
        const s = getStateSafe();
        console.log('[safeStopScanner] Estado final antes de stop():', s);
        if (s === Html5QrcodeScannerState.SCANNING || s === Html5QrcodeScannerState.PAUSED) {
          await safeCall(() => scanner.stop(), "finalStop");
        } else {
          try {
            await scanner.stop();
          } catch (e) {
            console.debug('[safeStopScanner] Stop() final no crítico falló:', e?.message || e);
          }
        }
      }
    } catch (stopErr) {
      console.error('[safeStopScanner] Error en stop():', stopErr?.message || stopErr);
    }

    if (scanner && typeof scanner.clear === "function" && containerStillInDOM()) {
      try {
        await safeCall(() => {
          scanner.clear();
          console.log('[safeStopScanner] Clear() ejecutado correctamente');
        }, "clearScanner");
      } catch (clearErr) {
        console.error('[safeStopScanner] Error al limpiar:', clearErr?.message || clearErr);
        try {
          if (scanner && scanner.stop) await scanner.stop();
          if (containerStillInDOM() && typeof scanner.clear === "function") scanner.clear();
        } catch (secondErr) {
          console.error('[safeStopScanner] Error en limpieza de respaldo:', secondErr?.message || secondErr);
        }
      }
    } else {
      console.warn('[safeStopScanner] No se pudo limpiar, contenedor o método no disponible');
    }

    if (isMounted.current) {
      console.log('[safeStopScanner] Actualizando estado UI a NOT_STARTED');
      setScanState(prev => ({
        ...prev,
        cameraActive: false,
        scanningPaused: false,
        scannerState: Html5QrcodeScannerState.NOT_STARTED
      }));
    }

    try {
      if (!containerStillInDOM()) {
        qrScanner.current = null;
      } else {
        if (qrScanner.current && typeof qrScanner.current.getState === "function") {
          const finalState = qrScanner.current.getState();
          if (finalState === Html5QrcodeScannerState.NOT_STARTED) qrScanner.current = null;
        }
      }
    } catch (refErr) {
      console.warn('[safeStopScanner] Error al limpiar referencia:', refErr?.message || refErr);
    }
  }, [safeCall]);

  const startScannerCore = useCallback(async () => {
    console.log('[startScannerCore] Iniciando proceso de inicio del escáner');
    if (!eventoSeleccionado) {
      console.warn('[startScannerCore] No hay evento seleccionado');
      showToast("Selecciona un evento antes de escanear", "warning");
      return;
    }

    const container = document.getElementById("qr-reader");
    console.log('[startScannerCore] Contenedor QR:', container);
    if (!container || !document.body.contains(container)) {
      console.error('[startScannerCore] Contenedor no disponible');
      return;
    }

    const config = {
      fps: 10,
      qrbox: 250,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      disableFlip: false
    };

    try {
      console.log('[startScannerCore] Deteniendo escáner previo');
      await safeStopScanner();

      console.log('[startScannerCore] Creando nueva instancia Html5Qrcode');
      qrScanner.current = new Html5Qrcode("qr-reader");

      console.log('[startScannerCore] Iniciando escáner con config:', config);
      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => console.warn("[startScannerCore] Error de escaneo:", errMsg)
      );

      startAttemptsRef.current = 0;
      console.log('[startScannerCore] Escáner iniciado con éxito');

      if (isMounted.current) {
        console.log('[startScannerCore] Actualizando estado a SCANNING');
        setScanState(prev => ({
          ...prev,
          cameraActive: true,
          scanningPaused: false,
          scannerState: Html5QrcodeScannerState.SCANNING
        }));
      }
    } catch (err) {
      console.error('[startScannerCore] Error al iniciar escáner:', err);

      if (isMounted.current) {
        console.log('[startScannerCore] Actualizando estado a ERROR');
        setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.ERROR }));
      }

      const name = err?.name;
      if (name === "NotAllowedError") {
        console.error('[startScannerCore] Permiso de cámara denegado');
        showToast("Permiso de cámara denegado", "error");
      } else if (name === "NotFoundError") {
        console.error('[startScannerCore] No se encontró cámara');
        showToast("No se encontró cámara disponible", "error");
      } else if (name === "AbortError") {
        console.warn('[startScannerCore] Inicio abortado por navegador');
      } else {
        console.error('[startScannerCore] Error desconocido al iniciar cámara');
        showToast("No se pudo iniciar la cámara", "error");
      }

      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      const attempt = ++startAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);

      console.log(`[startScannerCore] Programando reintento en ${delay}ms (intento ${attempt})`);
      retryTimeoutRef.current = setTimeout(() => {
        if (isMounted.current && eventoSeleccionado) {
          runSerial(startScannerCore, `startScanner(backoff ${attempt})`);
        }
      }, delay);
    }
  }, [eventoSeleccionado, runSerial, safeStopScanner]);

  const startScanner = useCallback(async () => {
    console.log('[startScanner] Llamando a startScanner serializado');
    return runSerial(startScannerCore, "startScanner");
  }, [runSerial, startScannerCore]);

  const stopScanner = useCallback(async () => {
    console.log('[stopScanner] Llamando a stopScanner serializado');
    return runSerial(safeStopScanner, "stopScanner");
  }, [runSerial, safeStopScanner]);

  const restartScanner = useCallback(async () => {
    console.log('[restartScanner] Reiniciando escáner');
    return runSerial(async () => {
      await safeStopScanner();
      await startScannerCore();
    }, "restartScanner");
  }, [runSerial, safeStopScanner, startScannerCore]);

   ///
const handleScanSuccess = useCallback(async (decodedText) => {
  const now = Date.now();

  // --- Duplicate Scan Protection ---
  if (lastScanTimeRef.current && (now - lastScanTimeRef.current) < 1500) {
    console.warn('[Scan] Bloqueado: escaneo demasiado rápido');
    return;
  }
  lastScanTimeRef.current = now;

  console.log('[Scan] Procesando QR:', decodedText);

  // --- Safety Checks ---
  if (!isMounted.current || scanningPausedRef.current || !qrScanner.current || !eventoSeleccionado) {
    console.warn('[Scan] Condiciones no cumplidas, abortando');
    return;
  }

  // --- Normalize Ticket Code ---
  const ticketCode = extractTicketCode(decodedText);
  if (!ticketCode) {
    console.warn('[Scan] No se pudo extraer el ticket del QR');
    showErrorOverlay('Ticket inválido');
    return;
  }
  const normalizedTicket = ticketCode.toLowerCase().trim();
  console.log('[Scan] Ticket normalizado:', normalizedTicket);

  const eventId = String(eventoSeleccionado.event_id);
  const asistentesEvento = asistentes[eventId] || [];

  // --- Duplicate Ticket Check ---
  if (lastProcessedTicketRef.current === normalizedTicket) {
    console.warn('[Scan] Ticket duplicado, se omite');
    return;
  }

  // --- Pause Scanner ---
  scanningPausedRef.current = true;
  lastScannedRef.current = ticketCode;
  setScanState(prev => ({
    ...prev,
    scanningPaused: true,
    scannerState: Html5QrcodeScannerState.PAUSED
  }));

  // --- Helper Functions ---
  const showErrorOverlay = (message) => {
    setScanState(prev => ({
      ...prev,
      validation: { status: 'error', mensaje: message, asistente: null },
      showOverlay: true
    }));
  };

  const showOverlay = (status, message, asistente = null) => {
    setScanState(prev => ({
      ...prev,
      validation: { status, mensaje: message, asistente },
      showOverlay: true
    }));
  };

  try {
    // --- Local Validation ---
    const asistenteLocal = asistentesEvento.find(a => 
      (a.ticket_code?.toLowerCase().trim() === normalizedTicket) || 
      (String(a.id) === normalizedTicket)
    );

    if (asistenteLocal) {
      console.log('[Scan] Ticket local encontrado:', asistenteLocal.id);
      lastProcessedTicketRef.current = normalizedTicket;

      if (asistenteLocal.status === 'SCANNED') {
        showOverlay("ya-validado", `Ticket ya validado: ${asistenteLocal.nombre}`, asistenteLocal);
        return;
      }

      // --- Update Backend ---
      const [apiResponse] = await Promise.all([
        ScannerAPI.markAsScanned(asistenteLocal.id),
        updateAsistenteStatus(asistenteLocal.id, 'SCANNED')
      ]);

      if (!apiResponse.success) throw new Error(apiResponse.message || 'Error al actualizar en backend');

      addToBuffer({ 
        ticket_id: asistenteLocal.id, 
        event_id: eventId, 
        timestamp: new Date().toISOString() 
      });

      showOverlay("valid", `Validado: ${asistenteLocal.nombre}`, asistenteLocal);
      return;
    }

    // --- Backend Validation ---
    const checkResult = await ScannerAPI.checkTicketStatus(eventId, ticketCode);
    if (!checkResult.success) throw new Error(checkResult.message || 'Error al validar ticket');

    if (checkResult.data?.status === 'invalid_event') {
      showOverlay("mismatch", "Ticket no pertenece a este evento");
      return;
    }

    if (!checkResult.data?.valid) {
      throw new Error(checkResult.data?.message || 'Ticket inválido');
    }

    if (checkResult.data?.already_scanned) {
      showOverlay("ya-validado", `Ticket ya validado: ${checkResult.data.asistente.nombre}`, checkResult.data.asistente);
      return;
    }

    // --- Register Scan ---
    const nuevoAsistente = { ...checkResult.data.asistente, status: 'SCANNED' };
    lastProcessedTicketRef.current = normalizedTicket;

    await Promise.all([
      ScannerAPI.markAsScanned(nuevoAsistente.id),
      updateAsistenteStatus(nuevoAsistente.id, 'SCANNED', nuevoAsistente)
    ]);

    addToBuffer({ 
      ticket_id: nuevoAsistente.id, 
      event_id: eventId, 
      timestamp: new Date().toISOString() 
    });

    showOverlay("valid", `Validado: ${nuevoAsistente.nombre}`, nuevoAsistente);

  } catch (error) {
    console.error('[Scan] Error crítico:', error);
    showErrorOverlay(error.message || "Error en validación");
  } finally {
    // --- Resume Scanner ---
    const resumeScanner = () => {
      if (isMounted.current) {
        scanningPausedRef.current = false;
        setScanState(prev => ({ 
          ...prev, 
          scanningPaused: false, 
          scannerState: Html5QrcodeScannerState.SCANNING 
        }));
        qrScanner.current?.resume?.().catch(console.error);
      }
    };
    setTimeout(resumeScanner, 1500);
  }
}, [eventoSeleccionado, asistentes, updateAsistenteStatus, addToBuffer]);




  const resetScannerState = useCallback(() => {
    console.log('[resetScannerState] Reseteando estado del escáner');
    scanningPausedRef.current = false;
    lastScannedRef.current = "";
    setScanState(prev => ({
      ...prev,
      scanningPaused: false,
      showOverlay: false,
      lastScanned: "",
      scannerState: Html5QrcodeScannerState.SCANNING
    }));
  }, []);

  function handleScanError(error) {
    console.error('[handleScanError] Error de escaneo:', error);
    setScanState(prev => ({
      ...prev,
      validation: {
        status: "error",
        mensaje: error.message || "Error en el escaneo"
      },
      showOverlay: true
    }));

    timeoutRef.current = setTimeout(() => {
      if (isMounted.current) {
        resetScannerState();
        restartScanner().catch(e => console.error("Error al reiniciar:", e));
      }
    }, 300);
  }

  const handleSync = useCallback(async () => {
    console.log('[handleSync] Iniciando sincronización manual');
    if (!eventoSeleccionado?.event_id || !setAsistentes) {
      console.error('[handleSync] Faltan dependencias para sincronización');
      return;
    }

    setLoading(true);
    try {
      console.log('[handleSync] Deteniendo escáner para sincronizar');
      await stopScanner();
      
      console.log('[handleSync] Sincronizando asistentes con API para evento:', eventoSeleccionado.event_id);
      const data = await ScannerAPI.syncAttendees(eventoSeleccionado.event_id);
      console.log('[handleSync] Datos recibidos de API:', {
        success: data.success,
        count: data.attendees?.length || 0,
        message: data.message
      });
      
      if (data.success) {
        const eventId = String(eventoSeleccionado.event_id); // Normalización a string
        console.log('[handleSync] Normalizado eventId:', eventId);
        
        console.log('[handleSync] Estado actual de asistentes:', {
          prevEventIds: Object.keys(asistentes),
          currentEventData: asistentes[eventId]?.length || 0
        });

        setAsistentes(prev => {
          const newAttendees = data.attendees || [];
          console.log('[handleSync] Nuevos asistentes a guardar:', {
            count: newAttendees.length,
            sample: newAttendees.slice(0, 3)
          });
          
          return {
            ...prev,
            [eventId]: newAttendees
          };
        });

        showToast(`Sincronizados ${data.attendees?.length || 0} asistentes`, "success");
      } else {
        console.warn('[handleSync] Sincronización fallida:', data.message);
        showToast(data.message || "Error al sincronizar", "error");
      }
    } catch (error) {
      console.error('[handleSync] Error en sincronización:', {
        error: error.message,
        stack: error.stack
      });
      showToast("Error de conexión al sincronizar", "error");
    } finally {
      setLoading(false);
      console.log('[handleSync] Intentando reiniciar escáner');
      try {
        await startScanner();
        console.log('[handleSync] Escáner reiniciado con éxito');
      } catch (scannerError) {
        console.error('[handleSync] Error al reiniciar escáner:', scannerError);
      }
    }
}, [
  eventoSeleccionado, 
  setAsistentes, 
  setLoading, 
  startScanner, 
  stopScanner,
  asistentes // Asegúrate de incluir asistentes en las dependencias
]);

  useEffect(() => {
    console.log('[useEffect] Configurando sincronización automática');
    if (!eventoSeleccionado?.event_id) {
      console.log('[useEffect] No hay event_id, omitiendo sincronización');
      return;
    }

    let isSyncing = false;
    let lastSyncTime = 0;
    let lastAttendeesHash = '';

    const getAttendeesHash = (attendees) => {
      return attendees?.length.toString() || '0';
    };

    const syncAutomatically = async () => {
  // 1. Validación inicial mejorada
    const eventId = String(eventoSeleccionado.event_id);
    const asistentesEvento = asistentes[eventId] || [];

  if (!eventoSeleccionado?.event_id || isSyncing) {
    console.log('[syncAutomatically] Condiciones no cumplidas para sincronizar');
    return;
  }

  // 2. Control de frecuencia de sincronización
  const now = Date.now();
  if (now - lastSyncTime < 300000 && lastSyncTime !== 0) {
    console.log('[syncAutomatically] Sincronización reciente, omitiendo');
    return;
  }

  isSyncing = true; 
  
  try {
    console.log('[syncAutomatically] Iniciando sincronización para:', eventId);
    
    // 3. Llamada a API con manejo de errores estructurado
    const { success, data: rawAttendees = [], message } = await ScannerAPI.syncAttendees(eventId);
    const attendees = Array.isArray(rawAttendees) ? rawAttendees : [];

    if (!success) {
      console.warn('[syncAutomatically] API respondió sin éxito:', message);
      return;
    }

    console.log('[syncAutomatically] Asistentes recibidos:', attendees.length, 'Ejemplo:', attendees.slice(0, 2));
    console.log("Asistentes cargados:", asistentesEvento);

    // 4. Actualización de estado con triple verificación
    setAsistentes(prev => {
      const prevAttendees = prev[eventId] || [];
      const prevHash = JSON.stringify(prevAttendees);
      const newHash = JSON.stringify(attendees);

      if (prevHash !== newHash) {
        console.log('[syncAutomatically] Actualizando estado para:', eventId, 'Con:', attendees.length, 'asistentes');
        return {
          ...prev,
          [eventId]: attendees
        };
      }
      
      console.log('[syncAutomatically] No hay cambios en los datos');
      return prev;
    });

    // 5. Actualización de metadatos
    lastAttendeesHash = getAttendeesHash(attendees);
    lastSyncTime = Date.now();

  } catch (error) {
    console.error('[syncAutomatically] Error crítico:', {
      message: error.message,
      stack: error.stack,
      eventId
    });
  } finally {
    isSyncing = false;
    console.log('[syncAutomatically] Sincronización finalizada para:', eventId);
  }
};

    const initialSync = () => {
      console.log('[initialSync] Sincronización inicial');
      if (document.visibilityState === 'visible') {
        syncAutomatically();
      }
    };

    const handleVisibilityChange = () => {
      console.log('[handleVisibilityChange] Cambio de visibilidad:', document.visibilityState);
      if (document.visibilityState === 'visible') {
        syncAutomatically();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(syncAutomatically, 300000);
    console.log('[useEffect] Intervalo de sincronización configurado cada 5 minutos');
    
    const initialSyncTimer = setTimeout(initialSync, 1000);
    console.log('[useEffect] Sincronización inicial programada en 1s');

    return () => {
      console.log('[useEffect cleanup] Limpiando sincronización automática');
      clearInterval(interval);
      clearTimeout(initialSyncTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [eventoSeleccionado?.event_id, setAsistentes]);
  
  useEffect(() => {
    console.log('[useEffect] Control de cámara por evento seleccionado');
    if (!eventoSeleccionado?.event_id) {
      console.log('[useEffect] No hay evento seleccionado, omitiendo');
      return;
    }

    const asistentesEvento = asistentes[eventoSeleccionado.event_id] || [];
    console.log('[useEffect] Asistentes para el evento:', asistentesEvento.length);

    const handleCamera = async () => {
      console.log('[handleCamera] Manejando estado de cámara');
      if (eventoSeleccionado.event_id !== lastEventIdRef.current) {
        console.log('[handleCamera] Evento cambiado, reiniciando escáner');
        lastEventIdRef.current = eventoSeleccionado.event_id;
        await stopScanner();
        if (asistentesEvento.length > 0) {
          console.log('[handleCamera] Hay asistentes, iniciando escáner');
          await startScanner();
        }
        return;
      }

      if (asistentesEvento.length > 0 && !scanState.cameraActive && !scanState.scanningPaused) {
        console.log('[handleCamera] Condiciones para iniciar cámara cumplidas');
        await startScanner();
      } else if ((asistentesEvento.length === 0 || scanState.scanningPaused) && scanState.cameraActive) {
        console.log('[handleCamera] Condiciones para detener cámara cumplidas');
        await stopScanner();
      }
    };

    handleCamera();
  }, [eventoSeleccionado?.event_id, asistentes, scanState.cameraActive, scanState.scanningPaused, startScanner, stopScanner]);

  useEffect(() => {
    console.log('[useEffect] Configurando listener de visibilidad');
    const onVis = async () => {
      console.log('[onVis] Cambio de visibilidad:', document.hidden ? 'oculto' : 'visible');
      if (!qrScanner.current) {
        console.log('[onVis] No hay escáner activo, omitiendo');
        return;
      }
      
      if (document.hidden) {
        console.log('[onVis] Pestaña oculta, pausando escáner si está activo');
        if (qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
          await safeCall(() => qrScanner.current.pause(), "visibilityPause");
          if (isMounted.current) {
            console.log('[onVis] Actualizando estado a PAUSED');
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.PAUSED }));
          }
        }
      } else {
        console.log('[onVis] Pestaña visible, reanudando escáner si corresponde');
        if (!scanningPausedRef.current &&
            qrScanner.current.getState() === Html5QrcodeScannerState.PAUSED) {
          await safeCall(() => qrScanner.current.resume(), "visibilityResume");
          if (isMounted.current) {
            console.log('[onVis] Actualizando estado a SCANNING');
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.SCANNING }));
          }
        }
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => {
      console.log('[useEffect cleanup] Removiendo listener de visibilidad');
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [safeCall]);

  useEffect(() => {
  console.log('[useEffect] Configurando limpieza al desmontar');
  isMounted.current = true;
  
  return () => {
    console.log('[useEffect cleanup] Desmontando componente');
    
    // 1. Marcar componente como desmontado
    isMounted.current = false;
    
    // 2. Limpiar todos los timeouts (forma compacta)
    [timeoutRef.current, retryTimeoutRef.current].forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    
    // 3. Detener el escáner usando safeStopScanner (¡ya hace todo lo necesario!)
    console.log('[useEffect cleanup] Deteniendo escáner con safeStopScanner');
    safeStopScanner().catch(error => {
      console.error('[cleanup] Error al detener escáner:', error);
    });
  };
}, [safeStopScanner]); // <-- Mantenemos esta dependencia

  useEffect(() => {
    console.log('[useEffect] Actualizando validationRef');
    validationRef.current = scanState.validation;
  }, [scanState.validation]);

  const renderValidationOverlay = useCallback(() => {
    if (!scanState.showOverlay || !scanState.validation) {
      console.log('[renderValidationOverlay] Sin overlay para mostrar');
      return null;
    }

    const { status, mensaje } = scanState.validation;
    console.log('[renderValidationOverlay] Mostrando overlay:', status, mensaje);
    
    const validationConfig = {
      valid: { icon: checkImg, title: "TICKET VÁLIDO", color: "#4CAF50" },
      error: { icon: crossImg, title: "ERROR", color: "#f44336" },
      mismatch: { icon: warningImg, title: "TICKET NO PERTENECE A EVENTO", color: "#FF9800" },
      "ya-validado": { icon: warningImg, title: "TICKET YA REGISTRADO", color: "#FFC107" },
      'invalid': { icon: crossImg, title: "INVÁLIDO", color: "#f44336" },
      'pending': { icon: warningImg, title: "PENDIENTE", color: "#FF9800" }
    };

    const config = validationConfig[status] || validationConfig.error;
    console.log('[renderValidationOverlay] Configuración de overlay:', config);

    return (
      <div className="fullscreen-overlay">
        <div className="validation-content">
          <img src={config.icon} alt={config.title} className="validation-icon" />
          <h2 style={{ color: config.color }}>{config.title}</h2>
          <p>{mensaje}</p>
        </div>
      </div>
    );
  }, [scanState.showOverlay, scanState.validation]);

  console.log('[ScanQR] Renderizando componente');
  return (
    <div className="scanner-container">
      <header className="header">
        <div className="logo">TicketFlow QR</div>
      </header>

      <div className="scanner-content">
        <select
          className="event-selector"
          value={eventoSeleccionado?.event_id || ""}
          onChange={e => {
            const selectedId = e.target.value;
            console.log('[onChange] Evento seleccionado:', selectedId);
            const selectedEvent = eventos.find(ev => ev.event_id.toString() === selectedId);
            if (selectedEvent) {
              console.log('[onChange] Actualizando evento seleccionado:', selectedEvent);
              selectEvento(selectedEvent);
            }
          }}
        >
          <option value="" disabled>Seleccione un evento</option>
          {eventos.map(evt => (
            <option key={evt.event_id} value={evt.event_id}>
              {evt.event_title} ({evt.event_id})
            </option>
          ))}
        </select>

        <div className="scanner-wrapper">
          <div id="qr-reader" ref={qrRef} className="qr-scanner" />
        </div>

        <div className="sync-button-container">
          <button
            className="sync-button"
            onClick={handleSync}
            disabled={scanState.scanningPaused || !eventoSeleccionado}
          >
            {scanState.cameraActive ? "Re-sincronizar" : "Sincronizar Asistentes"}
          </button>
        </div>
      </div>

      {renderValidationOverlay()}
    </div>
  );
}
