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

  // ==========================================
  // 📊 ESTADOS
  // ==========================================
  const [scanState, setScanState] = useState({
    validation: null,
    showOverlay: false,
    lastScanned: "",
    pendingTickets: [],
    cameraActive: false
  });

  const [mostrarSoloHoy, setMostrarSoloHoy] = useState(true);

  console.log('[ScanQR] Estado inicial:', scanState);

  // ==========================================
  // 📌 REFS
  // ==========================================
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
  const syncCooldownRef = useRef(0);
  const isScannerStarting = useRef(false);

  // ==========================================
  // 🧮 DATOS
  // ==========================================
  const asistentesDelEvento = useMemo(() => {
    if (!eventoSeleccionado?.event_id) return [];
    return asistentes[eventoSeleccionado.event_id] || [];
  }, [eventoSeleccionado, asistentes]);

  // ✅ Filtro de fechas robusto (sin timezone issues)
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

  const eventosMostrados = useMemo(() => {
    if (!mostrarSoloHoy) return eventos;
    return eventos.filter(ev => isSameDay(ev.event_date));
  }, [eventos, mostrarSoloHoy, isSameDay]);

  // ✅ Contadores optimizados
  const totalCount = asistentesDelEvento.length;
  const scannedCount = asistentesDelEvento.reduce(
    (acc, a) => acc + (a.status === "SCANNED" ? 1 : 0),
    0
  );
  const pendingCount = totalCount - scannedCount;

  // ==========================================
  // 🛠 UTILITIES
  // ==========================================
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
    // Implementa tu sistema de toast aquí
    alert(`${type.toUpperCase()}: ${message}`);
  }, []);

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

  // ==========================================
  // 📷 SCANNER CONTROLS (SIN PAUSE/RESUME)
  // ==========================================
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
      console.log('[safeStopScanner] Actualizando estado UI');
      setScanState(prev => ({
        ...prev,
        cameraActive: false
      }));
    }

    try {
      if (!containerStillInDOM()) {
        qrScanner.current = null;
        isScannerStarting.current = false;
      } else {
        if (qrScanner.current && typeof qrScanner.current.getState === "function") {
          const finalState = qrScanner.current.getState();
          if (finalState === Html5QrcodeScannerState.NOT_STARTED) {
            qrScanner.current = null;
            isScannerStarting.current = false;
          }
        }
      }
    } catch (refErr) {
      console.warn('[safeStopScanner] Error al limpiar referencia:', refErr?.message || refErr);
    }
  }, [safeCall]);

  const startScannerCore = useCallback(async () => {
    console.log('[startScannerCore] Iniciando proceso de inicio del escáner');
    
    if (isScannerStarting.current) {
      console.log('[Scanner] Ya iniciando, omitiendo');
      return;
    }

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

    isScannerStarting.current = true;

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
      isScannerStarting.current = false;

      if (isMounted.current) {
        console.log('[startScannerCore] Actualizando estado');
        setScanState(prev => ({
          ...prev,
          cameraActive: true
        }));
      }
    } catch (err) {
      isScannerStarting.current = false;
      console.error('[startScannerCore] Error al iniciar escáner:', err);

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

  // ==========================================
  // 🎯 HANDLE SCAN
  // ==========================================
  const handleScanSuccess = useCallback(async (decodedText) => {
    const now = Date.now();
    
    // 🔍 LOG DIAGNÓSTICO
    diagLog('QR_DETECTED', {
      qrPreview: decodedText.substring(0, 50) + (decodedText.length > 50 ? '...' : ''),
    });

    // Anti-spam (no más de 1 scan cada 1.5s)
    if (lastScanTimeRef.current && (now - lastScanTimeRef.current) < 1500) {
      diagLog('SPAM_BLOCKED', {
        timeSinceLastScanMs: now - lastScanTimeRef.current,
      });
      return;
    }
    lastScanTimeRef.current = now;

    // Condiciones mínimas
    if (!isMounted.current || !eventoSeleccionado) {
      console.warn('[Scan] Condiciones no cumplidas, abortando');
      return;
    }

    // ⚠️ NO PAUSAMOS EL SCANNER - sigue corriendo

    // Extraer código del ticket
    let ticketCode;
    try {
      const url = new URL(decodedText);
      ticketCode = url.pathname.replace(/\/$/, '').split('/').pop();
    } catch {
      ticketCode = decodedText;
    }
    
    const normalizedTicket = ticketCode?.toLowerCase().trim();
    if (!normalizedTicket) {
      showToast('error', 'Ticket inválido');
      return;
    }

    // Evitar duplicados
    if (lastProcessedTicketRef.current === normalizedTicket) {
      console.warn('[Scan] Ticket duplicado');
      return;
    }
    lastProcessedTicketRef.current = normalizedTicket;

    try {
      diagLog('VALIDATION_START', {
        eventId: eventoSeleccionado.event_id,
        ticket: normalizedTicket,
      });

      const result = await validarTicket(eventoSeleccionado.event_id, normalizedTicket);

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

      // Actualizar contador en tiempo real
      if (result.type === 'valid' && result.asistente) {
        updateAsistenteStatus(eventoSeleccionado.event_id, result.asistente.id, 'SCANNED');
      }

    } catch (error) {
      console.error('[Scan] Error crítico:', error);
      showToast('error', error.message || 'Error inesperado');
    } finally {
      // Resetear duplicado después de 2s
      setTimeout(() => {
        lastProcessedTicketRef.current = null;
      }, 2000);
    }
  }, [eventoSeleccionado, validarTicket, scanState.pendingTickets, showToast, updateAsistenteStatus]);

  const resetScannerState = useCallback(() => {
    console.log('[resetScannerState] Reseteando estado del escáner');
    setScanState(prev => ({
      ...prev,
      showOverlay: false,
      lastScanned: "",
      pendingTickets: []
    }));
  }, []);

  // ==========================================
  // 🔄 SYNC
  // ==========================================
  const handleSync = useCallback(async () => {
    console.log('[handleSync] Iniciando sincronización manual');

    const now = Date.now();
    if (now - syncCooldownRef.current < 20000) {
      const remaining = Math.ceil((20000 - (now - syncCooldownRef.current)) / 1000);
      showToast(`Espera ${remaining}s para sincronizar`, 'warning');
      return;
    }
    syncCooldownRef.current = now;

    if (!eventoSeleccionado?.event_id) {
      showToast('No hay evento seleccionado', 'error');
      return;
    }

    const eventId = String(eventoSeleccionado.event_id);
    setLoading(true);
    await stopScanner();

    try {
      console.log('[handleSync] Sincronizando asistentes para evento:', eventId);
      const { success, attendees = [], message = '' } = await ScannerAPI.syncAttendees(eventId);

      if (success) {
        setAsistentes(prev => ({
          ...prev,
          [eventId]: attendees.map(a => ({
            ...a,
            status: a.status ?? 'PENDING'
          }))
        }));
        showToast(`Sincronizados ${attendees.length} asistentes`, 'success');
      } else {
        showToast(message || 'Error al sincronizar', 'error');
      }
    } catch (error) {
      console.error('[handleSync] Error:', error);
      showToast('Error de conexión al sincronizar', 'error');
    } finally {
      setLoading(false);
      await startScanner();
    }
  }, [eventoSeleccionado, startScanner, stopScanner, setLoading, setAsistentes, showToast]);

  const handleEventoChange = useCallback((selectedEvent) => {
    console.log('[handleEventoChange] Cambiando evento:', selectedEvent.event_id);
    setEventoSeleccionado(selectedEvent);
    loadAsistentes(selectedEvent.event_id);
    resetScannerState();
    // El efecto se encarga de reiniciar el scanner
    stopScanner();
  }, [setEventoSeleccionado, loadAsistentes, resetScannerState, stopScanner]);

  // ==========================================
  // 🎨 RENDER OVERLAY
  // ==========================================
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

    return (
      <div className="fullscreen-overlay">
        <div className="validation-content">
          <img src={config.icon} alt={config.title} className="validation-icon" />
          <h2 style={{ color: config.color }}>{config.title}</h2>
          <p>{mensaje}</p>
          {scanState.validation.asistente && (
            <div className="attendee-info">
              <p><strong>Nombre:</strong> {scanState.validation.asistente.name}</p>
              <p><strong>Email:</strong> {scanState.validation.asistente.email}</p>
            </div>
          )}
          {scanState.pendingTickets?.length > 0 && (
            <p style={{ marginTop: '10px', fontSize: '14px', color: '#aaa' }}>
              Tickets validados hoy: {scanState.pendingTickets.length}
            </p>
          )}
          <button 
            onClick={() => setScanState(prev => ({ ...prev, showOverlay: false, validation: null }))}
            style={{ 
              marginTop: '15px', 
              padding: '8px 20px', 
              cursor: 'pointer',
              background: '#333',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }, [scanState.showOverlay, scanState.validation, scanState.pendingTickets]);

  // ==========================================
  // 🎯 EFFECTS
  // ==========================================
  
  // Efecto #1: Control maestro del scanner (solo start/stop)
  useEffect(() => {
    const controller = new AbortController();
    
    const manageScanner = async () => {
      if (!eventoSeleccionado?.event_id || controller.signal.aborted) return;
      
      console.log('[manageScanner] Asistentes para el evento:', asistentesDelEvento.length);

      // El scanner solo debe estar activo si hay asistentes
      const shouldActivate = asistentesDelEvento.length > 0;
      
      if (shouldActivate && !qrScanner.current) {
        await startScanner();
      } else if (!shouldActivate && qrScanner.current) {
        await stopScanner();
      }
    };
    
    manageScanner();
    return () => controller.abort();
  }, [eventoSeleccionado, asistentesDelEvento, startScanner, stopScanner]);

  // Efecto #2: Sincronización automática
  useEffect(() => {
    const controller = new AbortController();
    let syncInterval;

    const syncAutomatically = async () => {
      if (!eventoSeleccionado?.event_id || controller.signal.aborted) return;

      const eventId = String(eventoSeleccionado.event_id);
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

    syncInterval = setInterval(syncAutomatically, 300000);
    
    // Sincronizar al montar
    setTimeout(syncAutomatically, 1000);

    return () => {
      controller.abort();
      clearInterval(syncInterval);
    };
  }, [eventoSeleccionado?.event_id, setAsistentes]);

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

  // Efecto #6: Si el filtro "Solo hoy" deja afuera al evento seleccionado,
  // hay que limpiar la selección. Si no, el <select> queda "vacío" porque
  // su value ya no calza con ninguna <option>, pero eventoSeleccionado
  // en el estado sigue siendo el mismo, y los contadores (que dependen
  // de eventoSeleccionado/asistentesDelEvento, no de eventosMostrados)
  // se quedan pegados mostrando los datos del evento anterior.
  useEffect(() => {
    if (!eventoSeleccionado) return;

    console.log('TIPO event_id seleccionado:', typeof eventoSeleccionado.event_id, '| valor:', eventoSeleccionado.event_id);
    console.log('TIPO event_id en lista:', typeof eventosMostrados[0]?.event_id, '| valor:', eventosMostrados[0]?.event_id);
    
    const sigueVisible = eventosMostrados.some(
      ev => ev.event_id === eventoSeleccionado.event_id
    );
    if (!sigueVisible) {
      console.log('[filtroSoloHoy] Evento seleccionado ya no está en la lista filtrada, reseteando');
      setEventoSeleccionado(null);
      resetScannerState();
      stopScanner();
    }
  }, [eventosMostrados, eventoSeleccionado, setEventoSeleccionado, resetScannerState, stopScanner]);

  // ==========================================
  // 🎨 RENDER
  // ==========================================
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
          {eventosMostrados.map(evt => (
            <option key={evt.event_id} value={evt.event_id}>
              {evt.event_title} ({evt.event_id})
            </option>
          ))}
        </select>

        <div className="filter-controls">
          <label className="switch">
            <input
              type="checkbox"
              checked={mostrarSoloHoy}
              onChange={(e) => {
                setMostrarSoloHoy(e.target.checked);
                // ✅ NO tocamos el scanner aquí - solo cambia la UI
              }}
            />
            <span className="slider" />
          </label>
          <span className="switch-label">
            {mostrarSoloHoy ? '📅 Solo hoy' : '📋 Todos los eventos'}
          </span>
        </div>

        {/* 📊 CONTADORES OPTIMIZADOS */}
        {eventoSeleccionado && (
          <div className="counters-container">
            <div className="counter-card">
              <span className="counter-label">Total</span>
              <span className="counter-value">{totalCount}</span>
            </div>
            <div className="counter-card">
              <span className="counter-label">✅ Escaneados</span>
              <span className="counter-value" style={{ color: '#4CAF50' }}>
                {scannedCount}
              </span>
            </div>
            <div className="counter-card">
              <span className="counter-label">⏳ Pendientes</span>
              <span className="counter-value" style={{ color: '#FF9800' }}>
                {pendingCount}
              </span>
            </div>
          </div>
        )}

        <div className="scanner-wrapper" style={{ position: 'relative' }}>
          <div id="qr-reader" ref={qrRef} className="qr-scanner" />
          
          {/* Mensaje cuando no hay asistentes */}
          {asistentesDelEvento.length === 0 && eventoSeleccionado && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              zIndex: 10
            }}>
              <span>No hay asistentes para este evento</span>
            </div>
          )}
        </div>

        <div className="sync-button-container">
          <button
            className="sync-button"
            onClick={handleSync}
            disabled={!eventoSeleccionado || asistentesDelEvento.length === 0}
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