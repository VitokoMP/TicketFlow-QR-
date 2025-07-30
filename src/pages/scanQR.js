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
  //const asistentesEvento = asistentes?.[String(eventoSeleccionado?.event_id)] || [];

const asistentesEvento = useMemo(() => {
  if (!eventoSeleccionado?.event_id) return [];
  const lista = asistentes?.[String(eventoSeleccionado.event_id)] || [];
  console.log("🧮 useMemo -> asistentesEvento:", lista.length);
  return lista;
}, [asistentes, eventoSeleccionado]);


   useEffect(() => {
    console.log("🚨 eventoSeleccionado cambió:", eventoSeleccionado);
  }, [eventoSeleccionado]);

  useEffect(() => {
    console.log("🚨 asistentes cambiaron:", asistentes);
  }, [asistentes]);
  
  useEffect(() => {
    fetchEventos();
  }, []);
  
  useEffect(() => {
  const idEvento = String(eventoSeleccionado?.event_id);
  const lista = asistentes?.[idEvento] || [];

  console.log("🎯 Evento seleccionado:", idEvento);
  console.log("🎯 Estado completo de asistentes:", asistentes);
  console.log("🎯 Asistentes para este evento:", lista);
}, [eventoSeleccionado, asistentes]);


useEffect(() => {
  if (!eventoSeleccionado?.event_id) return;

  const idEvento = String(eventoSeleccionado.event_id);
  const asistentesParaEvento = asistentes?.[idEvento] || [];

  console.log("📊 Verificando asistentes para escáner:", asistentesParaEvento.length);

  if (asistentesParaEvento.length > 0 && !cameraStarted) {
    startScanner();
  }

  if (asistentesParaEvento.length === 0 && cameraStarted) {
    qrScanner.current?.stop().catch(() => {});
    setCameraStarted(false);
  }
}, [asistentes, eventoSeleccionado]);


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

  const handleSync = async (eventId) => {
      console.log("🔄 Iniciando sincronización de asistentes para evento:", eventId);
    setLoading(true);
  try {
    const response = await fetch(`/wp-json/ticketflow/v1/sync-attendees/${eventId}`);
    const data = await response.json();
    console.log("📦 Respuesta cruda del endpoint:", data);
    
    if (data.success && Array.isArray(data.attendees)) {
      setAsistentes((prev) => ({
        ...prev,
        [String(eventId)]: data.attendees,
      }));
      console.log("✅ Asistentes sincronizados para evento", eventId, data.attendees);
    } else {
      console.error("❌ Error en datos recibidos:", data);
    }
  } catch (error) {
    console.error("❌ Error al sincronizar asistentes:", error);
  }
  setLoading(false);
};

const startScanner = async () => {
  if (!qrRef.current) return;

  try {
    if (qrScanner.current && qrScanner.current._isScanning) {
      await qrScanner.current.stop();
    }

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
    console.error("❌ Error al iniciar cámara:", err);
    setValidacion({
      status: "fail",
      mensaje: "No se pudo iniciar la cámara. Usa un navegador compatible y otorga permisos.",
    });
  }
};


const handleScanSuccess = (decodedText) => {
  if (!eventoSeleccionado || asistentesEvento.length === 0) return;

  // Extraer solo el último segmento del QR (después de la última '/')
  const segments = decodedText.trim().split('/');
  const scannedCode = segments[segments.length - 1].toLowerCase();

  if (scannedCode === lastScannedRef.current) return;
  lastScannedRef.current = scannedCode;

  // Debugging opcional
  console.log("📦 Código escaneado (extraído):", scannedCode);
  console.log("🧾 Lista de códigos QR en asistentesEvento:", asistentesEvento.map(a => a.qr_code));

  const match = asistentesEvento.find(
    (a) => (a.qr_code ?? "").trim().toLowerCase() === scannedCode
  );

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
    qrScanner.current?.resume();
  }, 3000);
};

  console.log("Evento seleccionado:", eventoSeleccionado);
  console.log("Asistentes del evento:", asistentesEvento);

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
      setCameraStarted(false);
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
  <div className="mt-4">
    <h3>Asistentes para el evento {eventoSeleccionado.event_title || eventoSeleccionado.event_id}</h3>
    {asistentesEvento.length === 0 ? (
      <p>No hay asistentes cargados.</p>
    ) : (
      <ul className="list-disc pl-5">
        {asistentesEvento.map((a) => (
          <li key={a.id}>
            {a.nombre || a.qr_code || "Sin nombre"}
          </li>
        ))}
      </ul>
    )}
  </div>
)}

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
            src={validacion?.status === "ok" ? checkImg : crossImg}
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
