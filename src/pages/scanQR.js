import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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

// ==========================================
// 🔍 DIAGNÓSTICO: Buffer circular en memoria
// ==========================================
const DIAG_BUFFER_MAX = 200;
const diagBuffer = [];
const diagBufferTimestamps = [];

function diagLog(tag, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    tag,
    ...data
  };
  diagBuffer.push(entry);
  diagBufferTimestamps.push(entry.ts);
  
  if (diagBuffer.length > DIAG_BUFFER_MAX) {
    diagBuffer.shift();
    diagBufferTimestamps.shift();
  }
  
  console.log(`[${tag}]`, data);
}

window.__getDiagLogs = () => {
  console.table(diagBuffer);
  console.log(`Total logs capturados: ${diagBuffer.length}`);
  return diagBuffer;
};

window.__downloadDiagLogs = () => {
  const blob = new Blob([JSON.stringify(diagBuffer, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scanqr-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  console.log('📥 Logs descargados como JSON');
};

window.__clearDiagLogs = () => {
  diagBuffer.length = 0;
  diagBufferTimestamps.length = 0;
  console.log('🧹 Buffer de diagnóstico limpiado');
};

console.log('🔍 Diagnóstico en memoria activo. Comandos disponibles:');
console.log('  __getDiagLogs()      - Ver todos los logs en tabla');
console.log('  __downloadDiagLogs() - Descargar logs como JSON');
console.log('  __clearDiagLogs()    - Limpiar buffer');

export default function ScanQR() {
  console.log('[ScanQR] Componente montándose');
  
  const contexto = useEvento();
  const {
    eventos,
    asistentes,
    eventoSeleccionado,
    validarTicket,
    setLoading,
    selectEvento,
    updateAsistenteStatus,
    addToBuffer,
    setEventoSeleccionado,
    loadAsistentes
  } = contexto;

  const setAsistentes = useCallback((value) => {
    contexto.setAsistentes(value);
  }, [contexto]);

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
    scannerState: Html5QrcodeScannerState.NOT_STARTED,
    pendingTickets: []
  });

  // ✅ NUEVO: Estado para el filtro "Mostrar solo hoy"
  const [mostrarSoloHoy, setMostrarSoloHoy] = useState(true);

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
  const lastScanTimeRef = useRef(0);
  const lastProcessedTicketRef = useRef();
  const lastSyncTimeRef = useRef(0);
  const syncCooldownRef = useRef(0);  // 🔒 Cooldown de 20s para sync manual
  
  const hayAsistentes = useMemo(() => 
    eventoSeleccionado?.event_id && asistentes[eventoSeleccionado.event_id]?.length > 0,
    [eventoSeleccionado, asistentes]
  );

  const asistentesDelEvento = useMemo(() => {
    if (!eventoSeleccionado?.event_id) return [];
    return asistentes[eventoSeleccionado.event_id] || [];
  }, [eventoSeleccionado, asistentes]);

  // ✅ NUEVO: Función segura para comparar fechas (evita problemas de timezone)
  const isSameDay = useCallback((dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }, []);

  // ✅ NUEVO: Asistentes filtrados por día (solo para UI)
  const asistentesMostrados = useMemo(() => {
    if (!mostrarSoloHoy) return asistentesDelEvento;
    return asistentesDelEvento.filter(a => isSameDay(a.event_date));
  }, [asistentesDelEvento, mostrarSoloHoy, isSameDay]);

  // ✅ NUEVO: Contador de SCANNED (la "verdad UI")
  const scannedCount = useMemo(() => {
    return asistentesMostrados.filter(a => a.status === "SCANNED").length;
  }, [asistentesMostrados]);

  // ======================================
  // FUNCIONES ORIGINALES
  // ======================================

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
      const url = new URL(qrText);
      let path = url.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      const code = path.split('/').filter(Boolean).pop();
      console.log('[extractTicketCode] Código extraído (URL):', code);
      return code;
    } catch (err) {
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

  const showToast = useCallback((message, type) => {
    console.log(`[TOAST] ${type.toUpperCase()}: ${message}`);
    toast[type]?.(message) || toast(message);
  }, []);

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
        console.log(`[safeStopScanner] Esperando ${waitMs}minutos antes de reintentar`);
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
  }, [eventoSeleccionado, runSerial, safeStopScanner, showToast, handleScanSuccess]);

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

  // 🔍 LOG DIAGNÓSTICO: Detección de recreación del callback
  diagLog('SCAN_HANDLER_CREATED', {
    handlerId: Math.random().toString(36).substr(2, 9)
  });

  const handleScanSuccess = useCallback( (decodedText) => { 
    const now = Date.now();
    
    // 🔍 LOG DIAGNÓSTICO: Cada vez que la cámara detecta un QR
    diagLog('QR_DETECTED', {
      qrPreview: decodedText.substring(0, 50) + (decodedText.length > 50 ? '...' : ''),
      callOrigin: new Error().stack.split('\n')[2]?.trim()
    });

    // 🔹 Anti-spam (no más de 1 scan cada 1.5s)
    if (lastScanTimeRef.current && (now - lastScanTimeRef.current) < 1500) {
      // 🔍 LOG DIAGNÓSTICO: Anti-spam activado
      diagLog('SPAM_BLOCKED', {
        timeSinceLastScanMs: now - lastScanTimeRef.current,
        ticketPreview: decodedText.substring(0, 30)
      });
      return;
    }
    lastScanTimeRef.current = now;

    // 🔹 Condiciones mínimas
    if (!isMounted.current || scanningPausedRef.current || !eventoSeleccionado) {
        console.warn('[Scan] Condiciones no cumplidas, abortando');
        return;
    }

    // 🔹 Normalizar ticket
    const normalizeTicket = (code) => code?.toLowerCase().trim();
    let ticketCode;
    try {
        const url = new URL(decodedText);
        ticketCode = url.pathname.replace(/\/$/, '').split('/').pop();
    } catch {
        ticketCode = decodedText;
    }
    const normalizedTicket = normalizeTicket(ticketCode);

    if (!normalizedTicket) {
        showToast('error', 'Ticket inválido');
        return;
    }

    // 🔹 Evitar duplicados
    if (lastProcessedTicketRef.current === normalizedTicket) {
        console.warn('[Scan] Ticket duplicado');
        return;
    }
    lastProcessedTicketRef.current = normalizedTicket;

    // 🔹 Pausar escáner
    scanningPausedRef.current = true;
    setScanState(prev => ({
        ...prev,
        scanningPaused: true,
        scannerState: Html5QrcodeScannerState.PAUSED,
    }));

    try {
        // 🔍 LOG DIAGNÓSTICO: Inicio de validación
        diagLog('VALIDATION_START', {
          eventId: eventoSeleccionado.event_id,
          ticket: normalizedTicket,
          pendingCount: scanState.pendingTickets?.length || 0
        });

        // ✅ Validación centralizada en el contexto
        const result = validarTicket(eventoSeleccionado.event_id, normalizedTicket);

        // 🔹 Revisar memoria: si ya existe en cache, marcar como "ya-validado"
        const alreadyInMemory = scanState.pendingTickets?.includes(normalizedTicket);
        setScanState(prev => ({
            ...prev,
            pendingTickets: alreadyInMemory ? prev.pendingTickets : [...(prev.pendingTickets || []), normalizedTicket],
            validation: {
                status: alreadyInMemory ? 'ya-validado' : result.type,
                mensaje: alreadyInMemory ? 'Este ticket ya fue VALIDADO' : result.message,
                asistente: result.asistente
            },
            showOverlay: true
        }));

    } catch (error) {
        console.error('[Scan] Error crítico:', error);
        showToast('error', error.message || 'Error inesperado');
    } finally {
        // 🔹 Reanudar escáner de forma segura
        setTimeout(() => {
            if (!isMounted.current) return;
            scanningPausedRef.current = false;

            setScanState(prev => ({
                ...prev,
                scanningPaused: false,
                scannerState: Html5QrcodeScannerState.SCANNING,
            }));

            if (qrScanner.current?.getState() === Html5QrcodeScannerState.PAUSED) {
                qrScanner.current?.resume?.().catch(console.error);
            }

            // 🔹 Reset duplicados después de un delay
            setTimeout(() => { lastProcessedTicketRef.current = null; }, 2000);
        }, 1500);
    }
  }, [eventoSeleccionado, validarTicket, scanState.pendingTickets, showToast]);

  const resetScannerState = useCallback(() => {
    console.log('[resetScannerState] Reseteando estado del escáner');
    scanningPausedRef.current = false;
    lastScannedRef.current = "";
    setScanState(prev => ({
        ...prev,
        scanningPaused: false,
        showOverlay: false,
        lastScanned: "",
        scannerState: Html5QrcodeScannerState.SCANNING,
        pendingTickets: []
    }));
  }, []);

  const handleScanError = useCallback((error) => {
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
  }, [resetScannerState, restartScanner]);

const handleSync = useCallback(async () => {
    console.log('[handleSync] Iniciando sincronización manual');

    // 🔒 COOLDOWN: Evita múltiples sincronizaciones en 20 segundos
    const now = Date.now();
    if (now - syncCooldownRef.current < 1200000) {
        const remaining = Math.ceil((1200000 - (now - syncCooldownRef.current)) / 60000);
        console.warn('[handleSync] Cooldown activo, faltan', remaining, 'minutos');
        showToast(`Espera ${remaining}s antes de volver a sincronizar`, 'warning');
        return;
    }
    syncCooldownRef.current = now;

    if (!eventoSeleccionado?.event_id) {
        const errorMsg = 'No hay evento seleccionado para sincronizar';
        console.error('[handleSync]', errorMsg);
        showToast(errorMsg, 'error');
        return;
    }

    const eventId = String(eventoSeleccionado.event_id);
    setLoading(true);

    try {
        console.log('[handleSync] Deteniendo escáner para sincronizar');
        await stopScanner();

        console.log('[handleSync] Sincronizando asistentes para evento:', eventId);
        const { success, attendees = [], message = '' } = await ScannerAPI.syncAttendees(eventId);

        console.log('[handleSync] Respuesta API:', { success, count: attendees.length, message });

        if (success) {
            console.log('[handleSync] Actualizando estado local para evento', eventId);

            setAsistentes(prev => {
                const prevState = prev || {};
                return {
                    ...prevState,
                    [eventId]: attendees.map(a => ({
                        ...a,
                    status: a.status ?? 'PENDING'
                    }))
                };
            });

            showToast(`Sincronizados ${attendees.length} asistentes`, "success");
        } else {
            console.warn('[handleSync] Sincronización fallida:', message);
            showToast(message || "Error al sincronizar", "error");
        }
    } catch (error) {
        console.error('[handleSync] Error en sincronización:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        showToast("Error de conexión al sincronizar", "error");
    } finally {
        setLoading(false);

        console.log('[handleSync] Reanudando escáner...');
        try {
            await startScanner();
            console.log('[handleSync] Escáner reiniciado con éxito');
        } catch (scannerError) {
            console.error('[handleSync] Error al reiniciar escáner:', {
                name: scannerError.name,
                message: scannerError.message
            });
        }
    }
}, [eventoSeleccionado, startScanner, stopScanner, setLoading, setAsistentes, showToast]);

  const handleEventoChange = useCallback((selectedEvent) => {
    console.log('[handleEventoChange] Cambiando evento:', selectedEvent.event_id);
    setEventoSeleccionado(selectedEvent);
    loadAsistentes(selectedEvent.event_id);
    resetScannerState();
  }, [setEventoSeleccionado, loadAsistentes, resetScannerState]);

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
                {scanState.pendingTickets?.length > 0 && (
                    <p>Tickets validados: {scanState.pendingTickets.length}</p>
                )}
            </div>
        </div>
    );
  }, [scanState.showOverlay, scanState.validation, scanState.pendingTickets]);

  // ======================
  // EFECTOS OPTIMIZADOS
  // ======================

  // Efecto #1: Sincronización automática y manejo de visibilidad
  useEffect(() => {
    const controller = new AbortController();
    let syncInterval;
    let initialSyncTimer;

    const syncAutomatically = async () => {
      if (!eventoSeleccionado?.event_id || controller.signal.aborted) {
        console.log('[syncAutomatically] Condiciones no cumplidas para sincronizar');
        return;
      }

      const eventId = String(eventoSeleccionado.event_id);
      const asistentesEvento = asistentes[eventId] || [];
      const now = Date.now();

      if (now - lastSyncTimeRef.current < 300000 && lastSyncTimeRef.current !== 0) {
        console.log('[syncAutomatically] Sincronización reciente, omitiendo');
        return;
      }

      console.log('[syncAutomatically] Iniciando sincronización para:', eventId);
      
      try {
        const { success, data: rawAttendees = [] } = await ScannerAPI.syncAttendees(eventId, { signal: controller.signal });
        const attendees = Array.isArray(rawAttendees) ? rawAttendees : [];

        if (success && isMounted.current) {
          setAsistentes(prev => {
            const prevAttendees = prev[eventId] || [];
            if (JSON.stringify(prevAttendees) === JSON.stringify(attendees)) return prev;
            return { ...prev, [eventId]: attendees };
          });
          lastSyncTimeRef.current = Date.now();
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[syncAutomatically] Error en sincronización:', error);
        }
      }
    };

    const handleVisibilityChange = async () => {
      if (!qrScanner.current) return;

      if (document.hidden) {
        console.log('[onVis] Pestaña oculta, pausando escáner si está activo');
        if (qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
          await safeCall(() => qrScanner.current.pause(), "visibilityPause");
          if (isMounted.current) {
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.PAUSED }));
          }
        }
      } else {
        console.log('[onVis] Pestaña visible, reanudando escáner si corresponde');
        if (!scanningPausedRef.current &&
            qrScanner.current.getState() === Html5QrcodeScannerState.PAUSED) {
          await safeCall(() => qrScanner.current.resume(), "visibilityResume");
          if (isMounted.current) {
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.SCANNING }));
          }
        }
        syncAutomatically();
      }
    };

    // Configuración inicial
    document.addEventListener("visibilitychange", handleVisibilityChange);
    syncInterval = setInterval(syncAutomatically, 300000);
    initialSyncTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        syncAutomatically();
      }
    }, 1000);

    return () => {
      controller.abort();
      clearInterval(syncInterval);
      clearTimeout(initialSyncTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [eventoSeleccionado?.event_id, setAsistentes, asistentes, safeCall]);

  // Efecto #2: Control maestro de la cámara
  useEffect(() => {
    const controller = new AbortController();

    const manageCamera = async () => {
      if (!eventoSeleccionado?.event_id || controller.signal.aborted) return;

      console.log('[manageCamera] Asistentes para el evento:', asistentesDelEvento.length);

      if (eventoSeleccionado.event_id !== lastEventIdRef.current) {
        console.log('[manageCamera] Evento cambiado, reiniciando escáner');
        lastEventIdRef.current = eventoSeleccionado.event_id;
        await stopScanner();
        if (asistentesDelEvento.length > 0) {
          await startScanner();
        }
        return;
      }

      const shouldActivate = 
        asistentesDelEvento.length > 0 && 
        !scanState.scanningPaused;
      
      const shouldDeactivate = 
        !asistentesDelEvento.length || 
        scanState.scanningPaused;

      if (shouldActivate && !scanState.cameraActive) {
        await startScanner();
      } else if (shouldDeactivate && scanState.cameraActive) {
        await stopScanner();
      }
    };

    manageCamera();
    return () => controller.abort();
  }, [
    eventoSeleccionado,
    asistentesDelEvento,
    scanState.scanningPaused,
    scanState.cameraActive,
    startScanner,
    stopScanner
  ]);

  // Efecto #3: Manejo de validación y overlay
  useEffect(() => {
    validationRef.current = scanState.validation;
    
    const validationTimeout = setTimeout(() => {
      if (scanState.validation && isMounted.current) {
        setScanState(prev => ({ ...prev, validation: null }));
      }
    }, 3000);

    return () => clearTimeout(validationTimeout);
  }, [scanState.validation]);

  // Efecto #4: Limpieza al desmontar
  useEffect(() => {
    isMounted.current = true;
    lastSyncTimeRef.current = 0;
    
    return () => {
      isMounted.current = false;
      
      [timeoutRef.current, retryTimeoutRef.current].forEach(timer => {
        if (timer) clearTimeout(timer);
      });
      
      safeStopScanner().catch(error => {
        console.error('[cleanup] Error al detener escáner:', error);
      });
    };
  }, [safeStopScanner]);

  // Efecto #5: Carga inicial de asistentes
  useEffect(() => {
    if (eventoSeleccionado?.event_id) {
      loadAsistentes(eventoSeleccionado.event_id);
    }
  }, [eventoSeleccionado?.event_id, loadAsistentes]);

  // Render del componente
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
              handleEventoChange(selectedEvent);
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

        {/* ✅ NUEVO: Toolbar con filtro y contador */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '15px', 
          padding: '10px 15px',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          margin: '10px 0'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={mostrarSoloHoy}
              onChange={(e) => setMostrarSoloHoy(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>Mostrar solo hoy</span>
          </label>
          
          <span style={{ 
            marginLeft: 'auto', 
            fontWeight: 'bold', 
            fontSize: '16px',
            color: '#4CAF50',
            backgroundColor: 'white',
            padding: '4px 12px',
            borderRadius: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            ✅ {scannedCount}/{asistentesMostrados.length}
          </span>
        </div>

        <div className="scanner-wrapper">
          <div id="qr-reader" ref={qrRef} className="qr-scanner" />
        </div>

        <div className="sync-button-container" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px' }}>
          <button
            className="sync-button"
            onClick={handleSync}
            disabled={scanState.scanningPaused || !eventoSeleccionado}
          >
            🔄 Re-sincronizar asistentes
          </button>
          <button
            className="sync-button"
            onClick={() => contexto.syncBuffer()}
            disabled={!eventoSeleccionado}
            style={{ backgroundColor: '#e6a817' }}
          >
            ✅ Confirmar evento en base de datos
          </button>
          
          {/* 🔍 BOTÓN DE DIAGNÓSTICO */}
          <button
            className="sync-button"
            onClick={() => window.__downloadDiagLogs?.()}
            style={{ backgroundColor: '#666', color: '#fff' }}
          >
            📥 Descargar Logs de Diagnóstico
          </button>
        </div>
      </div>

      {renderValidationOverlay()}
    </div>
  );
}