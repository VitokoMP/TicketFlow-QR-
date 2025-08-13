import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/apiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';

const SCAN_DELAY = 2000;
const SYNC_DEBOUNCE_TIME = 1000; // 1 segundo para evitar sincronizaciones rápidas

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
    validation: null,
    showOverlay: false,
  });

  // Refs
  const qrScanner = useRef(null);
  const timeoutRef = useRef(null);
  const lastEventIdRef = useRef(null);
  const isMounted = useRef(true);
  const lastScannedRef = useRef("");
  const scanningPausedRef = useRef(false);
  const cameraActiveRef = useRef(false);
  const lastSyncTimeRef = useRef(0);

  // Mostrar notificaciones
  const showToast = (message, type) => {
    console.log(`${type.toUpperCase()}: ${message}`);
  };

  // Normalizar URLs
  const normalizeUrl = useCallback((urlString) => {
    try {
      let url = new URL(urlString);
      if (url.protocol === "http:") url.protocol = "https:";
      return url.toString();
    } catch {
      return urlString;
    }
  }, []);

  // Extraer código del ticket
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

  // Función segura para detener el escáner
  const safeStopScanner = useCallback(async () => {
    try {
      if (!qrScanner.current) return;

      try {
        const state = qrScanner.current.getState?.();
        if (state && state !== Html5QrcodeScannerState.NOT_STARTED) {
          await qrScanner.current.stop().catch(e => {
            console.warn("Error al detener el escáner:", e.message);
          });
        }
      } catch (stopError) {
        console.warn("Error al verificar estado del escáner:", stopError.message);
      }

      // Limpieza manual del contenedor
      const container = document.getElementById("qr-reader");
      if (container) {
        container.innerHTML = "";
      }

      qrScanner.current = null;
      cameraActiveRef.current = false;
    } catch (clearError) {
      console.warn("Error en limpieza completa:", clearError.message);
    }
  }, []);

  // Iniciar el escáner con configuraciones optimizadas
  const startScanner = useCallback(async () => {
    if (!eventoSeleccionado || cameraActiveRef.current) return;

    const config = {
      fps: 10,
      qrbox: 250,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      disableFlip: false,
      videoConstraints: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "environment",
        frameRate: { ideal: 15, max: 30 }
      }
    };

    try {
      await safeStopScanner();
      
      qrScanner.current = new Html5Qrcode("qr-reader");
      
      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => console.warn("Error de escaneo:", errMsg)
      );

      cameraActiveRef.current = true;
    } catch (err) {
      console.error("Error iniciando escáner:", err);
      showToast("No se pudo iniciar la cámara", "error");
      
      setTimeout(() => {
        if (isMounted.current && eventoSeleccionado) {
          startScanner();
        }
      }, 1000);
    }
  }, [eventoSeleccionado, safeStopScanner]);

  // Detener el escáner de forma segura
  const stopScanner = useCallback(async () => {
    if (!cameraActiveRef.current) return;
    await safeStopScanner();
  }, [safeStopScanner]);

  // Manejar escaneo exitoso con protección contra duplicados
  const handleScanSuccess = useCallback(async (decodedText) => {
    if (!isMounted.current || scanningPausedRef.current || !qrScanner.current) return;

    const ticketCode = extractTicketCode(normalizeUrl(decodedText));
    if (ticketCode === lastScannedRef.current) return;

    scanningPausedRef.current = true;
    lastScannedRef.current = ticketCode;

    try {
      if (qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
        await qrScanner.current.pause();
      }

      const checkResult = await ScannerAPI.checkTicketStatus(
        eventoSeleccionado.event_id, 
        ticketCode
      );

      let validationState = { status: "error", mensaje: "Estado desconocido" };

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

      setScanState({ validation: validationState, showOverlay: true });

    } catch (error) {
      console.error("Error en validación:", error);
      setScanState({ 
        validation: { status: "error", mensaje: "Error validando el código" },
        showOverlay: true
      });
    } finally {
      if (!isMounted.current) return;

      timeoutRef.current = setTimeout(async () => {
        if (!isMounted.current) return;

        try {
          if (qrScanner.current?.getState() === Html5QrcodeScannerState.PAUSED) {
            await qrScanner.current.resume();
          } else {
            await stopScanner();
            await startScanner();
          }
        } catch (e) {
          console.error("Error al reanudar escáner:", e);
          await stopScanner();
          await startScanner();
        }

        if (isMounted.current) {
          scanningPausedRef.current = false;
          setScanState(prev => ({ ...prev, showOverlay: false }));
          lastScannedRef.current = "";
        }
      }, SCAN_DELAY);
    }
  }, [eventoSeleccionado, extractTicketCode, normalizeUrl, startScanner, stopScanner]);

  // Sincronizar asistentes con debounce
  const handleSync = useCallback(async () => {
    const now = Date.now();
    if (!eventoSeleccionado?.event_id || 
        scanningPausedRef.current || 
        now - lastSyncTimeRef.current < SYNC_DEBOUNCE_TIME) return;
    
    lastSyncTimeRef.current = now;
    setLoading(true);
    scanningPausedRef.current = true;

    try {
      await stopScanner();
      const data = await ScannerAPI.syncAttendees(eventoSeleccionado.event_id);
      
      if (data.success) {
        setAsistentes(prev => ({
          ...prev,
          [eventoSeleccionado.event_id]: data.attendees || []
        }));
        showToast("Asistentes sincronizados correctamente", "success");
      }
    } catch (error) {
      console.error("Error sincronizando asistentes:", error);
      showToast("Error al sincronizar asistentes", "error");
    } finally {
      setLoading(false);
      scanningPausedRef.current = false;
      if (isMounted.current) {
        await startScanner();
      }
    }
  }, [eventoSeleccionado, setLoading, setAsistentes, startScanner, stopScanner]);

  // Control de cámara optimizado
  useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;

    const asistentesEvento = asistentes[eventoSeleccionado.event_id] || [];
    let mounted = true;
    let cameraTimeout;

    const handleCamera = async () => {
      if (!mounted) return;

      if (eventoSeleccionado.event_id !== lastEventIdRef.current) {
        lastEventIdRef.current = eventoSeleccionado.event_id;
        await stopScanner();
        if (asistentesEvento.length > 0) {
          cameraTimeout = setTimeout(() => {
            if (mounted) startScanner();
          }, 500);
        }
        return;
      }

      const shouldStart = asistentesEvento.length > 0 && 
                        !cameraActiveRef.current && 
                        !scanningPausedRef.current;
      const shouldStop = (asistentesEvento.length === 0 || 
                        scanningPausedRef.current) && 
                        cameraActiveRef.current;

      if (shouldStart) {
        await startScanner();
      } else if (shouldStop) {
        await stopScanner();
      }
    };

    handleCamera();

    return () => {
      mounted = false;
      if (cameraTimeout) clearTimeout(cameraTimeout);
    };
  }, [eventoSeleccionado?.event_id, asistentes, startScanner, stopScanner]);

  // Limpieza completa al desmontar
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      
      const container = document.getElementById("qr-reader");
      if (container) container.innerHTML = "";
      
      if (qrScanner.current) {
        qrScanner.current.clear?.().catch(e => console.warn("Clean error:", e));
        qrScanner.current = null;
      }
    };
  }, []);

  // Selector de eventos con debounce
  const [lastEventChange, setLastEventChange] = useState(0);
  const handleEventChange = useCallback((e) => {
    const now = Date.now();
    if (now - lastEventChange < 500) return;
    
    const selectedId = e.target.value;
    const selectedEvent = eventos.find(ev => ev.event_id.toString() === selectedId);
    if (selectedEvent) {
      selectEvento(selectedEvent);
      setLastEventChange(now);
    }
  }, [eventos, selectEvento, lastEventChange]);

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
          onChange={handleEventChange}
        >
          <option value="" disabled>Seleccione un evento</option>
          {eventos.map(evt => (
            <option key={evt.event_id} value={evt.event_id}>
              {evt.event_title} ({evt.event_id})
            </option>
          ))}
        </select>

        <div className="scanner-wrapper">
          <div id="qr-reader" className="qr-scanner" />
        </div>

        <div className="sync-button-container">
          <button
            className="sync-button"
            onClick={handleSync}
            disabled={scanningPausedRef.current || !eventoSeleccionado}
          >
            {cameraActiveRef.current ? "Re-sincronizar" : "Sincronizar Asistentes"}
          </button>
        </div>
      </div>

      {renderValidationOverlay()}
    </div>
  );
}