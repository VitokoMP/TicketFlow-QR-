import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/apiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';

const SCAN_DELAY = 2000;

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
  const timeoutRef = useRef(null);
  const lastEventIdRef = useRef(null);
  const isMounted = useRef(true);
  const lastScannedRef = useRef("");
  const scanningPausedRef = useRef(false);

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
      if (qrScanner.current) {
        try {
          await qrScanner.current.stop();
        } catch (stopError) {
          console.warn("No se pudo detener el escáner:", stopError.message);
        }
        qrScanner.current.clear();
      }
    } catch (clearError) {
      console.warn("Error al limpiar el escáner:", clearError.message);
    }
  }, []);

  // Iniciar el escáner
  const startScanner = useCallback(async () => {
    if (!eventoSeleccionado) {
      showToast("Selecciona un evento antes de escanear", "warning");
      return;
    }

    const config = {
      fps: 10,
      qrbox: 250,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      disableFlip: false
    };

    try {
      // Limpiar escáner existente de forma segura
      await safeStopScanner();
      
      // Crear nueva instancia
      qrScanner.current = new Html5Qrcode("qr-reader");
      
      // Iniciar escáner
      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => console.warn("Error de escaneo:", errMsg)
      );

      // Actualizar estados
      setScanState(prev => ({ 
        ...prev, 
        cameraActive: true,
        scanningPaused: false,
        scannerState: Html5QrcodeScannerState.SCANNING
      }));
      
    } catch (err) {
      console.error("Error iniciando escáner:", err);
      setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.ERROR }));
      showToast("No se pudo iniciar la cámara", "error");
      
      // Reintentar después de 1 segundo
      setTimeout(() => {
        if (isMounted.current && eventoSeleccionado) {
          startScanner();
        }
      }, 1000);
    }
  }, [eventoSeleccionado, safeStopScanner]);

  // Detener el escáner
  const stopScanner = useCallback(async () => {
    await safeStopScanner();
    if (isMounted.current) {
      setScanState(prev => ({ 
        ...prev, 
        cameraActive: false, 
        scanningPaused: false,
        scannerState: Html5QrcodeScannerState.NOT_STARTED
      }));
    }
  }, [safeStopScanner]);

  // Manejar escaneo exitoso
  const handleScanSuccess = useCallback(async (decodedText) => {
    if (!isMounted.current || scanningPausedRef.current || !qrScanner.current) return;

    const ticketCode = extractTicketCode(normalizeUrl(decodedText));
    if (ticketCode === lastScannedRef.current) return;

    // Bloquear nuevos escaneos
    scanningPausedRef.current = true;
    lastScannedRef.current = ticketCode;
    setScanState(prev => ({
      ...prev,
      scanningPaused: true,
      lastScanned: ticketCode
    }));

    try {
      // Pausar el escáner de forma segura
      try {
        if (qrScanner.current.getState() === Html5QrcodeScannerState.SCANNING) {
          await qrScanner.current.pause();
          setScanState(prev => ({ ...prev, scannerState: Html5QrcodeScannerState.PAUSED }));
        }
      } catch (pauseError) {
        console.warn("No se pudo pausar el escáner:", pauseError.message);
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

      setScanState(prev => ({
        ...prev,
        validation: validationState,
        showOverlay: true
      }));

    } catch (error) {
      console.error("Error en validación:", error);
      setScanState(prev => ({
        ...prev,
        validation: { 
          status: "error", 
          mensaje: "Error validando el código" 
        },
        showOverlay: true
      }));
    } finally {
      if (!isMounted.current) return;

      // Programar reinicio del escáner
      timeoutRef.current = setTimeout(async () => {
        if (!isMounted.current) return;

        try {
          if (qrScanner.current) {
            // Verificar estado antes de intentar reanudar
            const state = qrScanner.current.getState();
            
            if (state === Html5QrcodeScannerState.PAUSED) {
              try {
                await qrScanner.current.resume();
                setScanState(prev => ({ 
                  ...prev, 
                  scannerState: Html5QrcodeScannerState.SCANNING 
                }));
              } catch (resumeError) {
                console.error("Error al reanudar:", resumeError);
                await stopScanner();
                await startScanner();
              }
            } else {
              await stopScanner();
              await startScanner();
            }
          }
        } catch (e) {
          console.error("Error al reanudar escáner:", e);
          try {
            await stopScanner();
            await startScanner();
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
  }, [eventoSeleccionado, extractTicketCode, normalizeUrl, startScanner, stopScanner]);

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

  // Limpieza al desmontar
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stopScanner();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [stopScanner]);

  // Renderizar overlay de validación
  const renderValidationOverlay = useCallback(() => {
    if (!scanState.showOverlay || !scanState.validation) return null;

    const { status, mensaje, asistente } = scanState.validation;
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