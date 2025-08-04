import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import { useMemo } from "react";

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
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");

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

    if (asistentesParaEvento.length > 0 && !cameraStarted) {
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
      // Limpiar contenedor y detener scanner previo
      qrRef.current.innerHTML = "";
      await stopScanner();

      const scanner = new Html5Qrcode(qrRef.current.id);
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
    <div className="px-4 py-2 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-center">Escáner QR TicketFlow</h2>

      <select
        value={eventoSeleccionado?.event_id || ""}
        onChange={(e) => {
          const selected = eventos.find(ev => String(ev.event_id) === e.target.value);
          if (selected) {
            setValidacion(null);
            setShowOverlay(false);
            selectEvento(selected);
          }
        }}
        className="border p-2 mt-4 w-full rounded"
      >
        <option value="">Selecciona un evento</option>
        {eventos.map(ev => (
          <option key={ev.event_id} value={String(ev.event_id)}>
            {ev.event_title}
          </option>
        ))}
      </select>

      {eventoSeleccionado && (
        <div className="relative mt-6 w-full" style={{ maxWidth: "400px", margin: "0 auto" }}>
          <div id="reader" ref={qrRef} className="w-full h-[320px] sm:h-[400px]" />
          
          {showOverlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-70 z-50">
              <img
                src={validacion?.status === "ok" ? checkImg : crossImg}
                alt={validacion?.status === "ok" ? "Validado" : "Inválido"}
                className="w-32 h-32 md:w-48 md:h-48 animate-pulse"
              />
              <p className={`font-bold mt-4 text-lg ${
                validacion?.status === "ok" ? "text-green-400" : 
                validacion?.status === "ya-validado" ? "text-yellow-400" : 
                "text-red-500"
              }`}>
                {validacion?.status === "ya-validado" ? "Ya fue validado" :
                 validacion?.status === "fail" ? "Código inválido" :
                 validacion?.status === "ok" ? "Asistente validado" :
                 validacion?.mensaje || "Error al validar"}
              </p>
            </div>
          )}

          <button
            onClick={() => handleSync(eventoSeleccionado.event_id)}
            className="mt-4 bg-blue-500 text-white py-2 px-4 rounded w-full"
          >
            Sincronizar Asistentes
          </button>
        </div>
      )}

      {validacion?.status === "ok" && (
        <div className="mt-4 p-4 rounded bg-white shadow text-black text-center">
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