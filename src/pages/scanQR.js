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

    const config = { /* config igual */ };

    try {
      if (qrScanner.current) {
        await qrScanner.current.clear();
      }
      qrScanner.current = new Html5Qrcode("qr-reader");

      await qrScanner.current.start(
        { facingMode: "environment" },
        config,
        handleScanSuccess,
        errMsg => console.warn("Error de escaneo:", errMsg)
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


  const handleScanSuccess = useCallback(async (decodedText) => {
    if (scanningPausedRef.current) return;
    if (decodedText === lastScannedRef.current) return;

    scanningPausedRef.current = true;
    lastScannedRef.current = decodedText;

    setScanState(prev => ({
      ...prev,
      scanningPaused: true,
      lastScanned: decodedText
    }));

    try {
      const result = await ScannerAPI.checkTicketStatus(eventoSeleccionado.event_id, decodedText);

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
