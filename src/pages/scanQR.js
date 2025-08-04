import React, { useEffect, useRef, useState, useMemo } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import '../public/css/ScanQR.css'; // Cambiado a importación CSS normal

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

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");

  // Función para verificar si un evento está activo (48 horas antes de su fecha)
  const isEventoActivo = (evento) => {
    if (!evento?.event_start_date) return false;
    
    const fechaEvento = new Date(evento.event_start_date);
    const fechaActual = new Date();
    const diferenciaHoras = (fechaEvento - fechaActual) / (1000 * 60 * 60);
    
    return diferenciaHoras <= 48 && diferenciaHoras >= -4; // -4 horas permite eventos que acaban de comenzar
  };

  const asistentesEvento = useMemo(() => {
    if (!eventoSeleccionado?.event_id) return [];
    const lista = asistentes?.[String(eventoSeleccionado.event_id)] || [];
    return lista;
  }, [asistentes, eventoSeleccionado]);

  useEffect(() => {
    fetchEventos();
  }, []);

  useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;

    const idEvento = String(eventoSeleccionado.event_id);
    const asistentesParaEvento = asistentes?.[idEvento] || [];

    if (asistentesParaEvento.length > 0 && !cameraStarted && isEventoActivo(eventoSeleccionado)) {
      startScanner();
    }

    if (asistentesParaEvento.length === 0 && cameraStarted) {
      stopScanner();
    }
  }, [asistentes, eventoSeleccionado]);

  const stopScanner = async () => {
    if (qrScanner.current) {
      await qrScanner.current.stop().catch(() => {});
      qrScanner.current.clear();
      setCameraStarted(false);
    }
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const handleSync = async (eventId) => {
    setLoading(true);
    try {
      const response = await fetch(`/wp-json/ticketflow/v1/sync-attendees/${eventId}`);
      const data = await response.json();
      
      if (data.success && Array.isArray(data.attendees)) {
        setAsistentes((prev) => ({
          ...prev,
          [String(eventId)]: data.attendees,
        }));
      }
    } catch (error) {
      console.error("Error al sincronizar asistentes:", error);
    }
    setLoading(false);
  };

  const startScanner = async () => {
    if (!qrRef.current) return;

    try {
      qrRef.current.innerHTML = "";
      await stopScanner();

      const scanner = new Html5Qrcode(qrRef.current.id || 'qr-scanner-container');
      qrScanner.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScanSuccess
      );

      setCameraStarted(true);
    } catch (err) {
      console.error("Error al iniciar cámara:", err);
      setValidacion({
        status: "fail",
        mensaje: "No se pudo iniciar la cámara. Usa un navegador compatible y otorga permisos.",
      });
    }
  };

  const handleEventChange = (e) => {
    const selectedId = e.target.value;
    const selected = eventos.find(ev => String(ev.event_id) === selectedId);
    
    if (selected && eventoSeleccionado && String(selected.event_id) !== String(eventoSeleccionado.event_id)) {
      setSelectedEvent(selected);
      setShowConfirmDialog(true);
    } else if (selected) {
      confirmEventChange(selected);
    }
  };

  const confirmEventChange = (evento) => {
    if (!isEventoActivo(evento)) {
      alert("Este evento no está activo actualmente (no está dentro del rango de 48 horas antes de su inicio).");
      return;
    }

    setValidacion(null);
    setShowOverlay(false);
    selectEvento(evento);
    setShowConfirmDialog(false);
  };

  const validarYMarcarAsistente = async (eventId, qrCode) => {
    try {
      const estadoRes = await fetch(`/wp-json/ticketflow/v1/escanear/${eventId}/${qrCode}`);
      const estadoData = await estadoRes.json();

      if (!estadoData.success && estadoData.status !== 'ALREADY_SCANNED') {
        return { status: "fail", mensaje: "Código inválido o no registrado" };
      }

      if (estadoData.status === "ALREADY_SCANNED") {
        return { status: "ya-validado", asistente: estadoData.asistente };
      }

      const markRes = await fetch(`/wp-json/ticketflow/v1/mark-as-scanned/${estadoData.asistente.id}`, {
        method: "POST",
      });
      const markData = await markRes.json();
      
      if (markData.success) {
        setAsistentes((prev) => {
          const eventoIdStr = String(eventoSeleccionado?.event_id);
          if (!eventoIdStr || !prev[eventoIdStr]) return prev;

          const updatedAsistentes = prev[eventoIdStr].map((a) =>
            String(a.id) === String(markData.asistente.id) ? markData.asistente : a
          );

          return {
            ...prev,
            [eventoIdStr]: updatedAsistentes,
          };
        });

        return {
          status: "ok",
          asistente: markData.asistente,
          mensaje: "Asistente validado correctamente",
        };
      }
      return {
        status: "error",
        mensaje: markData.mensaje || "Error al marcar como escaneado.",
      };
    } catch (error) {
      return { status: "fail", mensaje: "Error de conexión al validar QR" };
    }
  };

  const handleScanSuccess = async (decodedText) => {
    if (!eventoSeleccionado) return;

    const segments = decodedText.trim().split("/").filter(Boolean);
    const scannedCode = segments[segments.length - 1].toLowerCase();

    if (scannedCode === lastScannedRef.current) return;
    lastScannedRef.current = scannedCode;

    qrScanner.current?.pause();

    const resultado = await validarYMarcarAsistente(eventoSeleccionado.event_id, scannedCode);
    setValidacion(resultado);
    setShowOverlay(true);

    setTimeout(() => {
      setShowOverlay(false);
      setValidacion(null);
      lastScannedRef.current = "";
      qrScanner.current?.resume();
    }, 3000);
  };

  return (
    <div className="scan-container">
      <h2 className="text-xl font-bold text-center">Escáner QR TicketFlow</h2>

      <select
        value={eventoSeleccionado?.event_id || ""}
        onChange={handleEventChange}
        className="event-selector"
      >
        <option value="">Selecciona un evento</option>
        {eventos.map(ev => (
          <option 
            key={ev.event_id} 
            value={String(ev.event_id)}
            disabled={!isEventoActivo(ev)}
          >
            {ev.event_title} {!isEventoActivo(ev) ? "(No activo)" : ""}
          </option>
        ))}
      </select>

      {showConfirmDialog && (
        <div className="confirmation-dialog">
          <div className="dialog-content">
            <p>¿Estás seguro de que quieres cambiar al evento "{selectedEvent?.event_title}"?</p>
            <p>Se detendrá el escaneo del evento actual.</p>
            <div className="dialog-buttons">
              <button 
                onClick={() => confirmEventChange(selectedEvent)}
                className="confirm-button"
              >
                Confirmar
              </button>
              <button 
                onClick={() => setShowConfirmDialog(false)}
                className="cancel-button"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {eventoSeleccionado && isEventoActivo(eventoSeleccionado) && (
        <div className="scanner-wrapper">
          <div id="qr-scanner-container" ref={qrRef} className="qr-scanner" />
          
          {showOverlay && (
            <div className="validation-overlay">
              <div className="validation-content">
                <img
                  src={validacion?.status === "ok" ? checkImg : crossImg}
                  alt={validacion?.status === "ok" ? "Validado" : "Error"}
                  className="validation-icon"
                />
                <p className={`validation-message ${
                  validacion?.status === "ok" ? "text-success" :
                  validacion?.status === "ya-validado" ? "text-warning" :
                  "text-error"
                }`}>
                  {validacion?.status === "ya-validado" ? "Ya fue validado" :
                   validacion?.status === "fail" ? "Código inválido" :
                   validacion?.status === "ok" ? "Validación exitosa" :
                   validacion?.mensaje || "Error al validar"}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => handleSync(eventoSeleccionado.event_id)}
            className="sync-button"
          >
            Sincronizar Asistentes
          </button>
        </div>
      )}

      {validacion?.status === "ok" && (
        <div className="attendee-info">
          <strong>Nombre:</strong>{" "}
          {validacion.asistente?.nombre ||
            validacion.asistente?.name ||
            validacion.asistente?.nombre_completo ||
            "Desconocido"}
        </div>
      )}
    </div>
  );
}