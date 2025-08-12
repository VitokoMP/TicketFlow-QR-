import React, { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/apiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png'; // corregido
import '../public/css/ScanQR.css';

  const SCAN_DELAY = 2000; // tiempo antes de reanudar en ms

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
console.log("Eventos recibidos del contexto:", eventos);

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
    const lastScannedRef = useRef("");
    const scanningPausedRef = useRef(false);
    
  // startScanner corregido:
  const startScanner = useCallback(async () => {
    if (!eventoSeleccionado) {
      showToast("Selecciona un evento antes de escanear", "warning");
      return;
    }

    const config = {  fps: 10,              // frames por segundo, equilibrio entre rapidez y CPU
  qrbox: 250,           // tamaño cuadrado en px del área donde busca el QR
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],  // solo códigos QR
  disableFlip: false  };

    try {
      if (qrScanner.current) {
        await qrScanner.current.clear();
      }
      qrScanner.current = new Html5Qrcode("qr-reader");

      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => {}
      );

      setScanState(prev => ({ ...prev, cameraActive: true }));

    } catch (err) {
      console.error("Error iniciando escáner:", err);
      showToast("No se pudo iniciar la cámara", "error");
    }
  }, [eventoSeleccionado, handleScanSuccess]);

    // Función para detener cámara y escáner
    const stopScanner = useCallback(async () => {
      if (qrScanner.current && (scanState.cameraActive || scanState.scanningPaused)) {
        try {
          await qrScanner.current.stop();
          qrScanner.current.clear();
        } catch (err) {
          console.warn("El escáner ya estaba detenido:", err?.message);
        }
      }
      setScanState(prev => ({ ...prev, cameraActive: false, scanningPaused: false }));
    }, [scanState.cameraActive, scanState.scanningPaused]);

      // Limpieza al desmontar
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

      handleCamera();
    }, [eventoSeleccionado?.event_id, asistentes, scanState.cameraActive, scanState.scanningPaused, startScanner, stopScanner]);

    // Método principal de éxito de escaneo 
        function extractTicketCode(qrText) {
      try {
        const url = new URL(qrText);
        let path = url.pathname;
        if (path.endsWith('/')) path = path.slice(0, -1);
        const segments = path.split('/');
        return segments.pop(); // último segmento
            console.log("Código extraído del QR:", code); // <-- Aquí imprimes el código extraído

      } catch {
            console.log("QR no es URL, texto completo:", qrText); // <-- Aquí imprimes el texto tal cual si no es URL

        // No es URL, regresar el texto tal cual
        return qrText;
      }
    }

    function normalizeUrl(urlString) {
      try {
        let url = new URL(urlString);
        if (url.protocol === "http:") {
          url.protocol = "https:";
        }
        return url.toString();
      } catch {
        return urlString;
      }
    }

  const handleScanSuccess = useCallback(async (decodedText) => { 

  if (scanningPausedRef.current) return;
    console.log("QR detectado:", decodedText);

  const normalizedQrText = normalizeUrl(decodedText);
  const ticketCode = extractTicketCode(normalizedQrText);

  if (ticketCode === lastScannedRef.current) return; 

  scanningPausedRef.current = true;
  lastScannedRef.current = ticketCode;

  setScanState(prev => ({
    ...prev,
    scanningPaused: true,
    lastScanned: ticketCode
  }));

  try {
    const result = await ScannerAPI.checkTicketStatus(eventoSeleccionado.event_id, ticketCode);
        console.log("Resultado backend:", result); // <-- Aquí imprimes la respuesta del backend

      setScanState(prev => ({
        ...prev,
        validation: result.valid
          ? { status: "valid", mensaje: "Entrada válida", asistente: result.attendee }
          : { status: "error", mensaje: "QR inválido" },
        showOverlay: true,
      }));
    } catch {
      setScanState(prev => ({
        ...prev,
        validation: { status: "error", mensaje: "Error validando el código" },
        showOverlay: true,
      }));
    } finally {
      timeoutRef.current = setTimeout(() => {
          console.log("Timeout para ocultar overlay ejecutado");

        qrScanner.current?.resume();
        scanningPausedRef.current = false;
        setScanState(prev => ({ ...prev, scanningPaused: false, showOverlay: false }));
      }, SCAN_DELAY);
    }
  }, [eventoSeleccionado]);

  // Limpieza del timeout al desmontar
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
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
        setScanState(prev => ({
          ...prev,
          validation: { status: "error", mensaje: "Error al sincronizar asistentes" }
        }));
      } finally {
        setLoading(false);
      }
    }, [eventoSeleccionado, setLoading, setAsistentes, startScanner, stopScanner]);

    // Overlay de validación
    const renderValidationOverlay = useCallback(() => {
      if (!scanState.showOverlay || !scanState.validation) return null;

      const { status, mensaje, asistente } = scanState.validation;
      const validationConfig = {
        valid: { icon: checkImg, title: "TICKET VÁLIDO", color: "#4CAF50" },
        error: { icon: crossImg, title: "ERROR", color: "#f44336" },
        mismatch: { icon: warningImg, title: "EVENTO INCORRECTO", color: "#FF9800" },
        "ya-validado": { icon: warningImg, title: "YA REGISTRADO", color: "#FFC107" }
      };

      const config = validationConfig[status] || validationConfig.error;

      return (
        <div className="fullscreen-overlay">
          <div className="validation-content">
            <img src={config.icon} alt={config.title} className="validation-icon" />
            <h2 style={{ color: config.color }}>{config.title}</h2>
            <p>{mensaje}</p>
            {asistente && (
              <div className="attendee-info">
                <p><strong>Nombre:</strong> {asistente.name || "N/A"}</p>
                {status === "mismatch" && asistente.event_title && (
                  <p><strong>Evento:</strong> {asistente.event_title}</p>
                )}
              </div>
            )}
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
