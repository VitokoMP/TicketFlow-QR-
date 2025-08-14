import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/apiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';

const SCAN_DELAY = 2000;
// Máximo backoff 10s
const MAX_BACKOFF_MS = 10000;

const STOP_RETRY_MAX = 8;
const STOP_RETRY_BASE_MS = 120; // backoff base (120ms, 240ms, 480ms ...)

export default function ScanQR() {
  const {
    eventos = [],
    asistentes = {},
    setAsistentes,
    eventoSeleccionado,
    setLoading,
    selectEvento,
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
  if (!qrScanner.current) {
    console.debug("safeStopScanner: no hay instancia de qrScanner, nada que hacer.");
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

  // Manejar escaneo exitoso
  const handleScanSuccess = useCallback(async (decodedText) => {
    if (!isMounted.current || scanningPausedRef.current || !qrScanner.current) return;

    const ticketCode = extractTicketCode(normalizeUrl(decodedText));
    if (ticketCode === lastScannedRef.current) return;

    // Bloquear nuevos escaneos
    scanningPausedRef.current = true;
    lastScannedRef.current = ticketCode;
    if (isMounted.current) {
      setScanState(prev => ({
        ...prev,
        scanningPaused: true,
        lastScanned: ticketCode
      }));
    }

    try {
      // Pausar escáner de forma segura
      if (
        qrScanner.current &&
        qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING &&
        isMounted.current
      ) {
        await safeCall(() => qrScanner.current.pause(), "pauseScanner");
        if (isMounted.current) {
          setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.PAUSED }));
        }
      }

      // Validar ticket
      const checkResult = await ScannerAPI.checkTicketStatus(
        eventoSeleccionado.event_id,
        ticketCode
      );

      let validationState = {
        status: "error",
        mensaje: "Estado desconocido",
      };

      if (checkResult.success) {
        validationState.asistente = checkResult.asistente;

        if (checkResult.status === "PENDING") {
          const markResult = await ScannerAPI.markAsScanned(checkResult.asistente.id);
          validationState.status = markResult.status === "ALREADY_SCANNED" ? "ya-validado" : "valid";
          validationState.mensaje = markResult.mensaje || "Entrada válida";
        } else {
          validationState.status = checkResult.status.toLowerCase();
          validationState.mensaje = checkResult.mensaje;
        }
      } else {
        validationState.mensaje = checkResult.mensaje || "QR inválido";
      }

      if (isMounted.current) {
        setScanState(prev => ({
          ...prev,
          validation: validationState,
          showOverlay: true
        }));
      }

    } catch (error) {
      console.error("Error en validación:", error);
      if (isMounted.current) {
        setScanState(prev => ({
          ...prev,
          validation: {
            status: "error",
            mensaje: "Error validando el código"
          },
          showOverlay: true
        }));
      }
    } finally {
      if (!isMounted.current) return;

      // Programar reinicio del escáner (cancelando cualquier previo)
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        if (!isMounted.current) return;

        try {
          if (qrScanner.current) {
            const state = qrScanner.current.getState();

            if (state === Html5QrcodeScannerState.PAUSED) {
              // Intentar reanudar primero
              await safeCall(() => qrScanner.current.resume(), "resumeScanner");
              if (isMounted.current) {
                setScanState(prev => ({
                  ...prev,
                  scannerState: Html5QrcodeScannerState.SCANNING
                }));
              }
            } else {
              // Si no está PAUSED, hacer reinicio limpio serializado
              await restartScanner();
            }
          }
        } catch (e) {
          console.error("Error al reanudar escáner:", e);
          try {
            await restartScanner();
          } catch (finalError) {
            console.error("Error en reinicio completo:", finalError);
          }
        }

        // Restablecer estados
        if (isMounted.current) {
          scanningPausedRef.current = false;
          setScanState(prev => ({
            ...prev,
            scanningPaused: false,
            showOverlay: false,
            lastScanned: ""
          }));
          lastScannedRef.current = "";
        }
      }, SCAN_DELAY);
    }
  }, [eventoSeleccionado, extractTicketCode, normalizeUrl, restartScanner, safeCall]);

  // Sincronizar asistentes manualmente
  const handleSync = useCallback(async () => {
    if (!eventoSeleccionado?.event_id) return;

    setLoading(true);
    await stopScanner();

    try {
      const data = await ScannerAPI.syncAttendees(eventoSeleccionado.event_id);
      if (data.success) {
        setAsistentes(prev => ({
          ...prev,
          [eventoSeleccionado.event_id]: data.attendees || []
        }));
        await startScanner();
        showToast("Asistentes sincronizados correctamente", "success");
      }
    } catch (error) {
      console.error("Error sincronizando asistentes:", error);
      setScanState(prev => ({
        ...prev,
        validation: {
          status: "error",
          mensaje: "Error al sincronizar asistentes"
        }
      }));
      showToast("Error al sincronizar asistentes", "error");
    } finally {
      setLoading(false);
    }
  }, [eventoSeleccionado, setLoading, setAsistentes, startScanner, stopScanner]);

  // Sincronizar asistentes automáticamente cada 5 minutos
useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/wp-json/ticketflow/v1/sync-attendees/${eventoSeleccionado.event_id}`);
        const data = await res.json();
        if (data.inserted > 0) {
          console.log(`Nuevos asistentes: ${data.inserted}`);
        }
      } catch (err) {
        console.error('Error sincronizando asistentes:', err);
      }
    }, 300000); // 5 minutos

    return () => clearInterval(interval); // Limpieza al desmontar o cambiar de evento
  }, [eventoSeleccionado?.event_id]);
  
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

  // Renderizar overlay de validación
  const renderValidationOverlay = useCallback(() => {
    if (!scanState.showOverlay || !scanState.validation) return null;

    const { status, mensaje } = scanState.validation;
    const validationConfig = {
      valid: { icon: checkImg, title: "TICKET VÁLIDO", color: "#4CAF50" },
      error: { icon: crossImg, title: "ERROR", color: "#f44336" },
      mismatch: { icon: warningImg, title: "TICKET NO PERTENECE A EVENTO", color: "#FF9800" },
      "ya-validado": { icon: warningImg, title: "TICKET YA REGISTRADO", color: "#FFC107" }
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
