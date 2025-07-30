import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";

export default function ScanQR() {
  const {
    eventos = [],
    asistentes = {},
    setAsistentes,
    fetchEventos,
    eventoSeleccionado,
    setEventoSeleccionado,
    setLoading,
    selectEvento, // <-- agrega esto
  } = useEvento();

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");

  const asistentesEvento = asistentes?.[String(eventoSeleccionado?.event_id)] || [];

  useEffect(() => {
    fetchEventos();
  }, []);


  useEffect(() => {
    if (asistentesEvento.length > 0 && !cameraStarted) {
      startScanner();
    }
    // Limpia el escáner si no hay asistentes
  if (asistentesEvento.length === 0 && cameraStarted) {
    if (qrScanner.current && qrScanner.current._isScanning) {
      qrScanner.current.stop().catch(() => {});
    }
    setCameraStarted(false);
  }
  }, [asistentesEvento]);

  useEffect(() => {
    return () => {
      if (qrScanner.current && qrScanner.current._isScanning) {
        qrScanner.current.stop().catch(() => {});
      }
    };
  }, []);
/*  // Función para sincronizar asistentes desde el servidor
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
        console.log("✅ Asistentes sincronizados:", data.attendees);
      } else {
        console.error("❌ Error al obtener asistentes:", data);
      }
    } catch (error) {
      console.error("❌ Error al sincronizar:", error);
    }
    setLoading(false);
  };*/

  const startScanner = async () => {
    if (!qrRef.current) return;
    try {
      const scanner = new Html5Qrcode(qrRef.current.id);
      qrScanner.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleScanSuccess
      );

      setCameraStarted(true);
      console.log("🟢 Cámara iniciada.");
    } catch (err) {
      setValidacion({
        status: "fail",
        mensaje: "No se pudo iniciar la cámara. Usa un navegador compatible y otorga permisos.",
      });
      console.error("❌ Error al iniciar cámara:", err);
    }
  };

  const handleScanSuccess = (decodedText) => {
    if (!eventoSeleccionado || asistentesEvento.length === 0) return;
    if (decodedText === lastScannedRef.current) return;

    lastScannedRef.current = decodedText;
    const match = asistentesEvento.find((a) => decodedText.includes(a.qr_code));

    // Pausar el escáner para evitar múltiples lecturas
    qrScanner.current?.pause();

    if (match) {
      setValidacion({ status: "ok", asistente: match });
    } else {
      setValidacion({ status: "fail", mensaje: "Código inválido" });
    }

    setShowOverlay(true);

    setTimeout(() => {
      setShowOverlay(false);
      setValidacion(null);
      lastScannedRef.current = "";

      // Reanudar escáner
      qrScanner.current?.resume();
    }, 3000);
  };

  return (
    <div className="px-4 py-2 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-center">Escáner QR TicketFlow</h2>

      <select
  value={eventoSeleccionado?.event_id || ""}
  onChange={(e) => {
  const selected = eventos.find(ev => ev.event_id === Number(e.target.value));
  if (selected) {
    setValidacion(null);
    setShowOverlay(false);
    selectEvento(selected);
    setCameraStarted(false);
  }
}}
  className="border p-2 mt-4 w-full rounded"
>
  <option value="">Selecciona un evento</option>
  {eventos.map(ev => (
    <option key={ev.event_id} value={ev.event_id}>
      {ev.event_title}
    </option>
  ))}
</select>

      {eventoSeleccionado && (
        <div
          id="reader"
          ref={qrRef}
          className="mt-6 w-full"
          style={{ maxWidth: "400px", margin: "0 auto" }}
        />
      )}

      {showOverlay && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 z-50">
          <img
            src={validacion?.status === "ok" ? "public/img/check.png" : "public/img/cross.png"}
            alt={validacion?.status === "ok" ? "Validado" : "Inválido"}
            className="w-32 h-32 md:w-48 md:h-48 animate-pulse"
          />
        </div>
      )}

      {validacion?.status === "ok" && (
        <div className="mt-4 p-4 rounded bg-white shadow text-black text-center">
          <strong>Nombre:</strong>{" "}
          {validacion.asistente?.nombre ||
            validacion.asistente?.name ||
            validacion.asistente?.nombre_completo ||
            "Desconocido"}
          <pre className="text-xs bg-gray-100 text-left p-2 mt-2 rounded overflow-x-auto">
            {JSON.stringify(validacion.asistente, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
