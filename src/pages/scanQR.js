import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/apiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/check.png';
import '../public/css/ScanQR.css';

const SCAN_DELAY = 3000;

export default function ScanQR() {
  const {
    eventos = [],
    asistentes = {},
    setAsistentes,
    fetchEventos,
    eventoSeleccionado,
    setLoading,
    selectEvento,
  } = useEvento();

  const [scanState, setScanState] = useState({
    cameraActive: false,
    validation: null,
    showOverlay: false,
    lastScanned: "",
    scanningPaused: false
  });

  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const timeoutRef = useRef(null);
  const lastEventIdRef = useRef(null);
  const isMounted = useRef(true);

  // Limpieza on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      stopScanner();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Control cámara y evento seleccionado
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
    
    console.log("Eventos disponibles:", eventos);
    console.log("Evento seleccionado:", eventoSeleccionado);
    handleCamera();
  }, [eventoSeleccionado?.event_id, asistentes, scanState.cameraActive, scanState.scanningPaused]);

  // Función para iniciar cámara y escáner
  const startScanner = useCallback(async () => {
  if (!qrRef.current || scanState.cameraActive || scanState.scanningPaused) return;

  try {
    // Verificar permisos de cámara primero
    const hasCameraPermission = await Html5Qrcode.getCameras().then(cameras => cameras.length > 0);
    if (!hasCameraPermission) {
      throw new Error("No se pudo acceder a la cámara. Verifica los permisos.");
    }

    // Limpiar instancia previa
    if (qrScanner.current) {
      await qrScanner.current.stop().catch(() => {});
      qrScanner.current.clear();
    }

    qrScanner.current = new Html5Qrcode(qrRef.current.id);
    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      rememberLastUsedCamera: true,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    };

    // Usar la cámara trasera por defecto
    const cameraConfig = { 
      facingMode: "environment",
      aspectRatio: 1.7778 // 16:9
    };

    await qrScanner.current.start(
      cameraConfig,
      config,
      handleScanSuccess,
      handleScanError
    );

    setScanState(prev => ({ 
      ...prev, 
      cameraActive: true,
      validation: null // Limpiar errores previos
    }));

  } catch (err) {
    console.error("Error iniciando cámara:", err);
    setScanState(prev => ({
      ...prev,
      cameraActive: false,
      validation: {
        status: "error",
        mensaje: err.message || "Error al iniciar cámara. Verifica permisos."
      }
    }));
    
    // Reintentar después de 2 segundos
    setTimeout(() => {
      if (isMounted.current && eventoSeleccionado?.event_id) {
        startScanner();
      }
    }, 2000);
  }
}, [scanState.cameraActive, scanState.scanningPaused, eventoSeleccionado?.event_id]);

  // Función para detener cámara y escáner
  const stopScanner = useCallback(async () => {
  if (qrScanner.current && scanState.cameraActive) {
    try {
      await qrScanner.current.stop();
      qrScanner.current.clear();
      setScanState(prev => ({ ...prev, cameraActive: false }));
    } catch (err) {
      console.error("Error deteniendo escáner:", err);
    }
  } else {
    // El escáner no estaba activo, solo aseguramos estado
    setScanState(prev => ({ ...prev, cameraActive: false }));
  }
}, [scanState.cameraActive]);

  // Manejo exitoso de escaneo
  const handleScanSuccess = useCallback(async (decodedText) => {
    if (!eventoSeleccionado || scanState.showOverlay || scanState.scanningPaused) return;

    let qrCode;
    try {
      const url = new URL(decodedText);
      qrCode = url.pathname.split('/').pop().toLowerCase();
    } catch {
      qrCode = decodedText.trim().toLowerCase();
    }

    if (!qrCode || qrCode === scanState.lastScanned) return;

    // Pausar escáner mientras procesa
    setScanState(prev => ({ ...prev, scanningPaused: true, lastScanned: qrCode }));

    try {
      await qrScanner.current?.pause();

      // Validar y marcar asistencia
      const resultado = await ScannerAPI.checkTicketStatus(eventoSeleccionado.event_id, qrCode);

      if (isMounted.current) {
        setScanState(prev => ({
          ...prev,
          validation: resultado,
          showOverlay: true
        }));
      }

      timeoutRef.current = setTimeout(() => {
        if (isMounted.current) {
          setScanState(prev => ({
            ...prev,
            showOverlay: false,
            validation: null,
            scanningPaused: false
          }));
        }
        qrScanner.current?.resume();
      }, SCAN_DELAY);
    } catch (error) {
      console.error("Error procesando código:", error);
      if (isMounted.current) {
        setScanState(prev => ({
          ...prev,
          scanningPaused: false,
          validation: {
            status: "error",
            mensaje: "Error al procesar el código QR"
          }
        }));
      }
      qrScanner.current?.resume();
    }
  }, [eventoSeleccionado, scanState.lastScanned, scanState.showOverlay]);

  // Manejo error escaneo (solo log)
  const handleScanError = useCallback((errorMessage) => {
    // Puedes loguear o ignorar
    // console.log("Scan error:", errorMessage);
  }, []);

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
    } finally {
      setLoading(false);
    }
  }, [eventoSeleccionado, setLoading, setAsistentes, startScanner, stopScanner]);

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
    if(selectedEvent) selectEvento(selectedEvent);
  }}
>
  <option value="" disabled>
    Seleccione un evento
  </option>
  {eventos.map(evt => (
    <option key={evt.event_id} value={evt.event_id}>
      {evt.event_title} ({evt.event_id})
    </option>
  ))}
</select>
      <div className="scanner-wrapper">
        <div id="qr-reader" ref={qrRef} className="qr-scanner" />
        {scanState.scanningPaused && (
          <div className="scanner-overlay">
            <div className="scan-frame" />
            <div className="scan-instructions">Procesando código escaneado...</div>
          </div>
        )}
      </div>

      {/* Botón movido aquí, debajo del escáner */}
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

    {/* Overlay de validación */}
    {scanState.showOverlay && scanState.validation && (
      <div className="fullscreen-overlay">
        <div className="validation-content">
          {/* ... contenido del overlay ... */}
        </div>
      </div>
    )}
  </div>
);
}
