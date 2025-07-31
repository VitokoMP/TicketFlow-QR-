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
    selectEvento,
  } = useEvento();

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");
  const [validationResult, setValidationResult] = useState(null); // 'success' | 'error' | null

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
      setAsistentes((prev) => {
        console.log('setAsistentes llamado', prev);
        return {
          ...prev,
          [String(eventId)]: data.attendees,
        };
      });
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

const validarYMarcarAsistente = async (eventId, qrCode) => {
  try {
    const estadoRes = await fetch(`/wp-json/ticketflow/v1/escanear/${eventId}/${qrCode}`);
    const estadoData = await estadoRes.json();

    console.log("🔍 Estado del QR:", estadoData);
    console.log("estadoData completo:", estadoData);
    console.log("estadoData.success:", estadoData.success);
    console.log("estadoData.scanned:", estadoData.scanned);

    if (!estadoData.success && estadoData.status !== 'ALREADY_SCANNED') {
  return { status: "fail", mensaje: "Código inválido o no registrado" };
}

if (estadoData.status === "ALREADY_SCANNED") {
  return { status: "ya-validado", asistente: estadoData.asistente };
}
//Felipe Wn, no estas pudiendo marcar como escaneado si ya fue validado
//revisaste pero aun no validas que los estados estén conectados entre la base de datos la respues y la solicituda marcar.

    console.log("🔁 Marcando como escaneado:", estadoData.asistente.id);
    const markRes = await fetch(`/wp-json/ticketflow/v1/mark-as-scanned/${estadoData.asistente.id}`, {
      method: "POST",
    });
    console.log("markRes status:", markRes.status);

    const markData = await markRes.json();

    console.log("✅ Resultado del marcado:", markData);
    if (markData.success) {
      // 🔥 Actualizar el asistente escaneado en el estado global
      setAsistentes((prev) => {
          const eventoIdStr = String(eventoSeleccionado?.event_id);
          if (!eventoIdStr || !prev[eventoIdStr]) return prev;

          const updatedAsistentes = prev[eventoIdStr].map((a) =>
            String(a.id) === String(markData.asistente.id) ? markData.asistente : a
          );

          console.log("🔁 Reemplazando asistente con ID:", markData.asistente.id);
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
    } else {
      return {
        status: "error",
        mensaje: markData.mensaje || "Error al marcar como escaneado.",
      };
    }
  } catch (error) {
    console.error("❌ Error al validar y marcar:", error);
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
<div className="relative mt-6 w-full" style={{ maxWidth: "400px", margin: "0 auto" }}>
  <div id="reader" ref={qrRef} className="w-full h-[320px] sm:h-[400px]" />

{showOverlay && (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-60 z-40">
    <img
      src={
        validacion?.status === "ok"
          ? checkImg
          : validacion?.status === "ya-validado"
          ? crossImg
          : crossImg
      }
      alt={validacion?.status === "ok" ? "Validado" : "Inválido"}
      className="w-32 h-32 md:w-48 md:h-48 animate-pulse"
    />
    {validacion?.status === "ya-validado" && (
      <p className="text-red-500 font-bold mt-4 text-lg">Ya fue validado</p>
    )}
    {validacion?.status === "fail" && (
      <p className="text-red-500 font-bold mt-4 text-lg">
        Código inválido
      </p>
    )}
    {validacion?.status === "ok" && (
      <p className="text-green-400 font-bold mt-4 text-lg">
        Asistente validado
      </p>
    )}
    {validacion?.status === "error" && (
      <p className="text-red-500 font-bold mt-4 text-lg">
    {validacion?.mensaje || "Error al validar"}
      </p>
)}
  </div>
)}

</div>      

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