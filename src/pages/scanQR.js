import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/ApiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';
  
const OPTIMAL_SCAN_DELAY = 200; // Tiempo mínimo entre escaneos (para feedback visual)
const API_TIMEOUT = 1000; // Timeout para llamadas API
 
const MIN_DISPLAY_TIME = 800; // 1.5 segundos (antes era 400ms)
const ERROR_DISPLAY_TIME = 1000; // 2 segundos para errores
const STOP_RETRY_MAX = 8;
const STOP_RETRY_BASE_MS = 120; // backoff base (120ms, 240ms, 480ms ...)
const MAX_BACKOFF_MS = 10000; // 10 segundos máximo para backoff

export default function ScanQR() {
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

  const [scanState, setScanState] = useState({
    cameraActive: false,
    validation: null,
    showOverlay: false,
    lastScanned: "",
    scanningPaused: false,
    scannerState: Html5QrcodeScannerState.NOT_STARTED
  });

  // Refs
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const timeoutRef = useRef(null);           // overlay/restart timer
  const retryTimeoutRef = useRef(null);      // start backoff timer
  const lastEventIdRef = useRef(null);
  const isMounted = useRef(true);
  const lastScannedRef = useRef("");
  const scanningPausedRef = useRef(false); 
  const validationRef = useRef(null); 

  // Serializador de operaciones (evita start/stop concurrentes)
  const opLockRef = useRef(false);
  const runSerial = useCallback(async (fn, label = "op") => {
    if (opLockRef.current) {
      // Evita carreras: ignoramos operaciones redundantes
      console.warn(`Omitiendo ${label}: operación previa en curso`);
      return;
    }
    opLockRef.current = true;
    try {
      return await fn();
    } finally {
      opLockRef.current = false;
    }
  }, []);

  // Intentos de inicio con backoff
  const startAttemptsRef = useRef(0);

  // Helper: ejecutar función solo si está montado
  const safeCall = useCallback(async (fn, label = "") => {
    if (!isMounted.current) return;
    try {
      const result = await fn();
      return isMounted.current ? result : undefined;
    } catch (err) {
      if (isMounted.current) {
        // AbortError es esperado cuando el stream se corta bruscamente
        if (err?.name === "AbortError") {
          console.warn(`Operación abortada (${label})`);
          return;
        }
        console.warn(`Error en ${label || "operación"}:`, err?.message || err);
      }
    }
  }, []);

  const showToast = (message, type) => {
    console.log(`${type.toUpperCase()}: ${message}`);
  };

  const normalizeUrl = useCallback((urlString) => {
    try {
      let url = new URL(urlString);
      if (url.protocol === "http:") url.protocol = "https:";
      return url.toString();
    } catch {
      return urlString;
    }
  }, []);

  const extractTicketCode = useCallback((qrText) => {
    try {
      const url = new URL(qrText);
      let path = url.pathname;
      if (path.endsWith('/')) path = path.slice(0, -1);
      return path.split('/').pop();
    } catch {
      return qrText;
    }
  }, []);

  // Función segura para detener el escáner// Constants para reintentos

const safeStopScanner = useCallback(async () => { 
  // Modificar el log inicial para solo mostrar en desarrollo
  if (process.env.NODE_ENV === 'development' && !qrScanner.current) {
    console.debug("safeStopScanner: no hay instancia de qrScanner");
    return;
  } 

  // Guardar referencia local para que no cambie en medio de la operación
  const scanner = qrScanner.current;
  const container = document.getElementById("qr-reader");

  if (!isMounted.current) {
    console.debug("safeStopScanner: componente no montado, abortando.");
    return;
  }

  // Helper: chequear que el contenedor sigue en el DOM
  const containerStillInDOM = () => !!container && document.body.contains(container);

  // Helper: obtener estado seguro
  const getStateSafe = () => {
    try {
      return scanner?.getState?.();
    } catch (e) {
      console.warn("getState falló:", e?.message || e);
      return undefined;
    }
  };

  // Si está en transición, reintentar hasta que no lo esté (con límite)
  let attempt = 0;
  while (isMounted.current) {
    const state = getStateSafe();

    // Si ya NO está en modo SCANNING/STARTING/PENDING TRANSITION, rompemos
    // Los valores relevantes documentados: NOT_STARTED, SCANNING, PAUSED, etc.
    // Queremos asegurarnos de que NO quede "scanning" activo antes de clear().
    if (state === undefined) {
      // Si getState falla, intentar stop de todos modos (lo atrapamos más abajo)
      break;
    }

    // Si no está SCANNING o está PAUSED o NOT_STARTED -> intentar stop/clear normalmente
    if (state !== Html5QrcodeScannerState.SCANNING && state !== Html5QrcodeScannerState.NOT_STARTED) {
      // no estamos en scanning o ya not started; salimos del bucle y avanzamos al stop/clear
      break;
    }

    // Si está SCANNING, intentamos stop pero hay que evitar "under transition"
    try {
      await scanner.stop();
      console.debug("safeStopScanner: stop() resolvió OK desde bucle.");
      break;
    } catch (err) {
      const msg = (err && (err.message || err)) || err;
      // Si la librería reporta 'already under transition' u otro, esperamos y reintentamos
      console.warn(`safeStopScanner: intento stop() fallo (int ${attempt}):`, msg);

      attempt++;
      if (attempt >= STOP_RETRY_MAX) {
        console.error("safeStopScanner: alcanzado máximo de reintentos para stop(), abortando.");
        break;
      }

      // Backoff simple
      const waitMs = STOP_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise(res => setTimeout(res, waitMs));
      continue; // reintentar
    }
  } // end while

  // Si llegamos aquí, intentamos detener y limpiar de forma segura
  try {
    // Llamar stop() final (si aún puede ser llamado)
    try {
      if (scanner && scanner.stop && typeof scanner.stop === "function") {
        // Intentamos stop() si todavía parece necesario
        const s = getStateSafe();
        if (s === Html5QrcodeScannerState.SCANNING || s === Html5QrcodeScannerState.PAUSED) {
          await safeCall(() => scanner.stop(), "finalStop");
        } else {
          // Si no está SCANNING, llamar stop() puede fallar en algunos builds; intentamos solo si parece necesario
          try {
            await scanner.stop();
          } catch (e) {
            // Ignorar fallos no críticos aquí, logger para depuración
            console.debug("safeStopScanner: stop() final falló (no crítico):", e?.message || e);
          }
        }
      }
    } catch (stopErr) {
      console.warn("safeStopScanner: stopErr:", stopErr?.message || stopErr);
    }

    // Finalmente clear() — SOLO si el contenedor sigue en el DOM y clear existe
    if (scanner && typeof scanner.clear === "function" && containerStillInDOM()) {
      try {
        await safeCall(() => {
          // clear() suele ser síncrono, pero lo envolvemos en safeCall
          scanner.clear();
        }, "clearScanner");
        console.debug("safeStopScanner: clear() ejecutado OK.");
      } catch (clearErr) {
        // Mensaje típico: "Cannot clear while scan is ongoing, close it first."
        console.warn("Error al limpiar el escáner:", clearErr?.message || clearErr);
        // Intento defensivo extra: volver a intentar stop() y luego clear una vez
        try {
          if (scanner && scanner.stop) await scanner.stop();
          if (containerStillInDOM() && typeof scanner.clear === "function") scanner.clear();
        } catch (secondErr) {
          console.error("safeStopScanner: fallback clear/stop falló:", secondErr?.message || secondErr);
        }
      }
    } else {
      console.debug("safeStopScanner: no se llamó clear(): no existe método o contenedor removido.");
    }
  } catch (err) {
    console.error("safeStopScanner: error en limpieza final:", err?.message || err);
  } finally {
    // Normalizar estado UI
    if (isMounted.current) {
      setScanState(prev => ({
        ...prev,
        cameraActive: false,
        scanningPaused: false,
        scannerState: Html5QrcodeScannerState.NOT_STARTED
      }));
    }
    // Eliminar referencia a la instancia solo si contenedor fue removido o clear logró ejecutarse
    try {
      if (!containerStillInDOM()) {
        qrScanner.current = null;
      } else {
        // Si clear se ejecutó, es seguro liberar referencia también
        if (qrScanner.current && typeof qrScanner.current.getState === "function") {
          const finalState = qrScanner.current.getState();
          if (finalState === Html5QrcodeScannerState.NOT_STARTED) qrScanner.current = null;
        }
      }
    } catch (refErr) {
      console.debug("safeStopScanner: error al limpiar referencia qrScanner:", refErr?.message || refErr);
    }
  }
}, [safeCall]);

  // Iniciar el escáner (con cheques y backoff)
  const startScannerCore = useCallback(async () => {
    if (!eventoSeleccionado) {
      showToast("Selecciona un evento antes de escanear", "warning");
      return;
    }

    // Verificar contenedor DOM antes de crear instancia
    const container = document.getElementById("qr-reader");
    if (!container || !document.body.contains(container)) {
      console.warn("Contenedor #qr-reader no disponible, abortando start.");
      return;
    }

    const config = {
      fps: 10,
      qrbox: 250,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      disableFlip: false
    };

    try {
      // Limpiar escáner existente
      await safeStopScanner();

      // Nueva instancia
      qrScanner.current = new Html5Qrcode("qr-reader");

      // Iniciar escáner
      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => console.warn("Error de escaneo:", errMsg)
      );

      // Arranque OK → reset de intentos
      startAttemptsRef.current = 0;

      if (isMounted.current) {
        setScanState(prev => ({
          ...prev,
          cameraActive: true,
          scanningPaused: false,
          scannerState: Html5QrcodeScannerState.SCANNING
        }));
      }
    } catch (err) {
      console.error("Error iniciando escáner:", err);

      if (isMounted.current) {
        setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.ERROR }));
      }

      // Mensajes más claros según tipo
      const name = err?.name;
      if (name === "NotAllowedError") {
        showToast("Permiso de cámara denegado", "error");
      } else if (name === "NotFoundError") {
        showToast("No se encontró cámara disponible", "error");
      } else if (name === "AbortError") {
        console.warn("Inicio abortado por el navegador/sistema");
      } else {
        showToast("No se pudo iniciar la cámara", "error");
      }

      // Backoff exponencial (hasta 10s)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      const attempt = ++startAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);

      retryTimeoutRef.current = setTimeout(() => {
        if (isMounted.current && eventoSeleccionado) {
          // Usar serializador para no pisar otras ops
          runSerial(startScannerCore, `startScanner(backoff ${attempt})`);
        }
      }, delay);
    }
  }, [eventoSeleccionado, runSerial, safeStopScanner]);

  // Wrappers serializados públicos
  const startScanner = useCallback(async () => {
    return runSerial(startScannerCore, "startScanner");
  }, [runSerial, startScannerCore]);

  const stopScanner = useCallback(async () => {
    return runSerial(safeStopScanner, "stopScanner");
  }, [runSerial, safeStopScanner]);

  const restartScanner = useCallback(async () => {
    return runSerial(async () => {
      await safeStopScanner();
      await startScannerCore();
    }, "restartScanner");
  }, [runSerial, safeStopScanner, startScannerCore]);

const handleScanSuccess = useCallback(async (decodedText) => {
  if (!isMounted.current || scanningPausedRef.current || !qrScanner.current || !eventoSeleccionado) {
    return;
  }

  const ticketCode = extractTicketCode(normalizeUrl(decodedText));
  if (!ticketCode || ticketCode === lastScannedRef.current) return;

  // Bloqueo y preparación del estado
  scanningPausedRef.current = true;
  lastScannedRef.current = ticketCode;
  const scanStartTime = performance.now();

  setScanState(prev => ({
    ...prev,
    scanningPaused: true,
    lastScanned: ticketCode,
    validation: null,
    showOverlay: false,
    scannerState: Html5QrcodeScannerState.PAUSED
  }));

  // Limpieza de timeout previo
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  try {
    // 1. Pausa segura del escáner
    if (qrScanner.current && typeof qrScanner.current.pause === 'function') {
      await safeCall(() => qrScanner.current.pause());
    }

    // 2. Procesamiento del ticket
    let validationState;
    const asistentesEvento = asistentes[eventoSeleccionado.event_id] || [];
    const asistenteLocal = asistentesEvento.find(a => 
      a.ticket_code === ticketCode || a.id === ticketCode
    );

    if (asistenteLocal) {
      // Caso 1: Ticket en caché local
      if (asistenteLocal.status === 'SCANNED') {
        validationState = {
          status: "ya-validado",
          mensaje: `Ticket ya escaneado (${asistenteLocal.nombre || ''})`,
          asistente: asistenteLocal,
          timestamp: Date.now()
        };
      } else {
        // Actualización optimizada
        await updateAsistenteStatus(asistenteLocal.id, 'SCANNED');
        addToBuffer({
          ticket_id: asistenteLocal.id,
          event_id: eventoSeleccionado.event_id,
          timestamp: new Date().toISOString()
        });
        
        validationState = {
          status: "valid",
          mensaje: `Entrada válida - ${asistenteLocal.nombre || ''}`,
          asistente: asistenteLocal,
          timestamp: Date.now()
        };
      }
    } else {
      // Caso 2: Validación con API
      const checkResult = await ScannerAPI.checkTicketStatus(
        eventoSeleccionado.event_id, 
        ticketCode
      );

      if (checkResult.success && checkResult.status === "PENDING") {
        setAsistentes(prev => {
          const currentList = prev[eventoSeleccionado.event_id] || [];
          return {
            ...prev,
            [eventoSeleccionado.event_id]: [
              checkResult.asistente,
              ...currentList.filter(a => a.id !== checkResult.asistente.id)
            ]
          };
        });

        await updateAsistenteStatus(checkResult.asistente.id, 'SCANNED');
        addToBuffer({
          ticket_id: checkResult.asistente.id,
          event_id: eventoSeleccionado.event_id,
          timestamp: new Date().toISOString()
        });

        validationState = {
          status: "valid",
          mensaje: `Entrada válida - ${checkResult.asistente.nombre || ''}`,
          asistente: checkResult.asistente,
          timestamp: Date.now()
        };
      } else if (checkResult.success) {
        validationState = {
          status: checkResult.status.toLowerCase(),
          mensaje: checkResult.mensaje,
          asistente: checkResult.asistente,
          timestamp: Date.now()
        };
      } else {
        validationState = {
          status: "error",
          mensaje: checkResult.mensaje || "QR inválido",
          timestamp: Date.now()
        };
      }
    }

    // Mostrar resultado
    setScanState(prev => ({
      ...prev,
      validation: validationState,
      showOverlay: true
    }));

    // Programar reinicio
    const elapsed = performance.now() - scanStartTime;
    const displayTime = ["error", "ya-validado"].includes(validationState.status)
      ? Math.max(ERROR_DISPLAY_TIME - elapsed, 500)  // 500ms mínimo para errores
      : Math.max(MIN_DISPLAY_TIME - elapsed, 300);   // 300ms mínimo para éxitos

    timeoutRef.current = setTimeout(async () => {
      if (!isMounted.current || !qrScanner.current) return;
      
      scanningPausedRef.current = false;
      lastScannedRef.current = "";
      
      setScanState(prev => ({
        ...prev,
        scanningPaused: false,
        showOverlay: false,
        lastScanned: "",
        scannerState: Html5QrcodeScannerState.SCANNING
      }));

      // Reanudación segura
      try {
        const scanner = qrScanner.current;
        if (scanner && typeof scanner.resume === 'function') {
          await scanner.resume();
        } else {
          await restartScanner();
        }
      } catch (error) {
        console.error("Error al reanudar escáner:", error);
        await restartScanner();
      }
    }, displayTime);

  } catch (error) {
    console.error("Error en escaneo:", error);
    
    setScanState(prev => ({
      ...prev,
      validation: {
        status: "error",
        mensaje: error.message || "Error en la validación",
        timestamp: Date.now()
      },
      showOverlay: true
    }));

    timeoutRef.current = setTimeout(() => {
      if (!isMounted.current) return;
      resetScannerState();
      restartScanner().catch(e => console.error("Error al reiniciar:", e));
    }, ERROR_DISPLAY_TIME);
  }
}, [
  eventoSeleccionado,
  asistentes,
  extractTicketCode, 
  normalizeUrl,
  restartScanner,
  safeCall,
  updateAsistenteStatus,
  addToBuffer,
  resetScannerState,
  setAsistentes
]);


// Función auxiliar para resetear estado
const resetScannerState = useCallback(() => {
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

// Función auxiliar para manejo de errores
function handleScanError(error) {
    setScanState(prev => ({
        ...prev,
        validation: {
            status: "error",
            mensaje: error.message || "Error en el escaneo"
        },
        showOverlay: true
    }));

    // Reinicio rápido en caso de error
    timeoutRef.current = setTimeout(() => {
        if (isMounted.current) {
            resetScannerState();
            restartScanner().catch(e => console.error("Error al reiniciar:", e));
        }
    }, 300);
}
  // Sincronizar asistentes manualmente
 const handleSync = useCallback(async () => {
  if (!eventoSeleccionado?.event_id || !setAsistentes) {
    console.error('Faltan dependencias para sincronización');
    return;
  }

  setLoading(true);
  try {
    await stopScanner();
    
    const data = await ScannerAPI.syncAttendees(eventoSeleccionado.event_id);
    if (data.success) {
      setAsistentes(prev => ({
        ...prev,
        [eventoSeleccionado.event_id]: data.attendees || []
      }));
      showToast("Asistentes sincronizados", "success");
    }
  } catch (error) {
    console.error("Error sincronizando:", error);
    showToast("Error al sincronizar", "error");
  } finally {
    setLoading(false);
    startScanner(); // Reiniciar después de sincronizar
  }
}, [eventoSeleccionado, setAsistentes, setLoading, startScanner, stopScanner]);

  useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;

    // Bandera para evitar sincronizaciones redundantes
    let isSyncing = false;
    let lastSyncTime = 0;
    let lastAttendeesHash = '';

    // Función para calcular hash rápido de los asistentes
    const getAttendeesHash = (attendees) => {
        return attendees?.length.toString() || '0';
    };

    const syncAutomatically = async () => {
        // Evitar múltiples sincronizaciones simultáneas
        if (isSyncing) return;
        
        // Verificar si es necesario sincronizar (mínimo 5 minutos)
        const now = Date.now();
        if (now - lastSyncTime < 300000 && lastSyncTime !== 0) return;

        isSyncing = true;
        
        try {
            const data = await ScannerAPI.syncAttendees(eventoSeleccionado.event_id);
            if (data.success) {
                const newHash = getAttendeesHash(data.attendees);
                
                // Solo actualizar estado si hubo cambios
                if (newHash !== lastAttendeesHash) {
                    setAsistentes(prev => ({
                        ...prev,
                        [eventoSeleccionado.event_id]: data.attendees || []
                    }));
                    lastAttendeesHash = newHash;
                }
            }
        } catch (err) {
            console.error('Error sincronizando asistentes:', err);
        } finally {
            isSyncing = false;
            lastSyncTime = Date.now();
        }
    };

    // Sincronización inteligente al montar
    const initialSync = () => {
        if (document.visibilityState === 'visible') {
            syncAutomatically();
        }
    };

    // Manejo de visibilidad de la pestaña
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            syncAutomatically();
        }
    };

    // Configuración de listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(syncAutomatically, 300000);
    
    // Sincronización inicial diferida
    const initialSyncTimer = setTimeout(initialSync, 1000);

    return () => {
        clearInterval(interval);
        clearTimeout(initialSyncTimer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
}, [eventoSeleccionado?.event_id, setAsistentes]);
  
  // Controlar cámara basado en evento seleccionado
  useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;

    const asistentesEvento = asistentes[eventoSeleccionado.event_id] || [];

    const handleCamera = async () => {
      if (eventoSeleccionado.event_id !== lastEventIdRef.current) {
        lastEventIdRef.current = eventoSeleccionado.event_id;
        await stopScanner();
        if (asistentesEvento.length > 0) await startScanner();
        return;
      }

      if (asistentesEvento.length > 0 && !scanState.cameraActive && !scanState.scanningPaused) {
        await startScanner();
      } else if ((asistentesEvento.length === 0 || scanState.scanningPaused) && scanState.cameraActive) {
        await stopScanner();
      }
    };

    handleCamera();
  }, [eventoSeleccionado?.event_id, asistentes, scanState.cameraActive, scanState.scanningPaused, startScanner, stopScanner]);

  // Pausa/continúa por visibilidad de pestaña (no rompe overlay)
  useEffect(() => {
    const onVis = async () => {
      if (!qrScanner.current) return;
      if (document.hidden) {
        // Pausar solo si estaba escaneando
        if (qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
          await safeCall(() => qrScanner.current.pause(), "visibilityPause");
          if (isMounted.current) {
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.PAUSED }));
          }
        }
      } else {
        // Reanudar solo si no está en pausa lógica por overlay
        if (
          !scanningPausedRef.current &&
          qrScanner.current.getState() === Html5QrcodeScannerState.PAUSED
        ) {
          await safeCall(() => qrScanner.current.resume(), "visibilityResume");
          if (isMounted.current) {
            setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.SCANNING }));
          }
        }
      }
    };

    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [safeCall]);

  // Limpieza al desmontar
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // Cancelar timers
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      // Detener cámara de forma segura
      // No usar runSerial aquí para no bloquear el unmount
      safeStopScanner();
    };
  }, [safeStopScanner]);
  // Actualizar referencia de validación
  useEffect(() => {
    validationRef.current = scanState.validation;
  }, [scanState.validation]);
  
  // Renderizar overlay de validación
  const renderValidationOverlay = useCallback(() => {
    if (!scanState.showOverlay || !scanState.validation) return null;

    const { status, mensaje } = scanState.validation;
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
        </div>
      </div>
    );
  }, [scanState.showOverlay, scanState.validation]);

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
            const selectedEvent = eventos.find(ev => ev.event_id.toString() === selectedId);
            if (selectedEvent) selectEvento(selectedEvent);
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
