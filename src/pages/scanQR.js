import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";

export default function ScanQR() {
  const {
    asistentes = [],
    scannedCode,
    setScannedCode,
    fetchEventos,
    eventos,
    setLoading,
    loading: loadingContext,
    error: errorContext,
  } = useEvento();

  const eventosSafe = Array.isArray(eventos) ? eventos : [];
  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");

  useEffect(() => {
    if (eventosSafe.length > 0 && !eventoSeleccionado && eventosSafe[0]?.event_id) {
      setEventoSeleccionado(eventosSafe[0]);
    }
  }, [eventosSafe]);

  useEffect(() => {
    if (eventoSeleccionado) {
      setCameraStarted(false);
      setValidacion(null);
    }
  }, [eventoSeleccionado]);

  useEffect(() => {
    if (!cameraStarted || !qrRef.current || qrRef.current.offsetWidth === 0) return;

    const qrCodeRegionId = "reader";
    qrScanner.current = new Html5Qrcode(qrCodeRegionId);

    const startScanner = async () => {
      try {
        await qrScanner.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 300, height: 300 } },
          (decodedText) => {
            if (lastScannedRef.current === decodedText) return;
            lastScannedRef.current = decodedText;
            setScannedCode(decodedText);
            validarCodigo(decodedText);
            setTimeout(() => (lastScannedRef.current = ""), 2000);
          },
          (errorMessage) => {
            console.warn("Error escaneando QR:", errorMessage);
          }
        );
        console.log("🟢 Cámara lista.");
      } catch (err) {
        console.error("❌ Error al iniciar escáner:", err);
        alert("No se pudo acceder a la cámara.");
        setCameraStarted(false);
      }
    };

    startScanner();

    return () => {
      if (qrScanner.current) {
        qrScanner.current
          .stop()
          .then(() => console.log("🔴 Escáner detenido"))
          .catch((err) => console.warn("⚠️ Error al detener escáner:", err));
      }
    };
  }, [cameraStarted]);

  const validarCodigo = async (codigo) => {
    if (!codigo || !eventoSeleccionado?.event_id) {
      setValidacion("ERROR");
      return;
    }

    try {
      const res = await fetch(
        `/wp-json/ticketflow/v1/escanear/${eventoSeleccionado.event_id}/${codigo}`
      );
      if (!res.ok) throw new Error("QR no válido");

      const data = await res.json();
      if (data.scan_status === "pending") {
        await fetch(`/wp-json/ticketflow/v1/mark-as-scanned/${data.id}`, {
          method: "POST",
        });
        setValidacion("OK");
      } else if (data.scan_status === "scanned") {
        setValidacion("YA_VALIDADO");
      } else {
        setValidacion("ERROR");
      }
    } catch (error) {
      console.error("Error en validación:", error);
      setValidacion("ERROR");
    }
  };

  const handleStartScanner = async () => {
    if (loadingContext || !eventoSeleccionado?.event_id) {
      alert("Selecciona un evento válido.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(
        `/wp-json/ticketflow/v1/sync-attendees/${eventoSeleccionado.event_id}`
      );
      if (!res.ok) throw new Error("Sincronización fallida");

      const data = await res.json();
      if (data.success) {
        console.log("✅ Sincronización:", data.message);
        await fetchEventos();
        setCameraStarted(true);
      } else {
        alert("Error al sincronizar: " + (data.message || "Desconocido"));
      }
    } catch (err) {
      console.error("❌ Error de sincronización:", err);
      alert("Error al sincronizar evento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-3xl text-yellow-400 font-bold mb-6">Ticket Flow</h1>

      <div className="mb-4">
        <label htmlFor="evento">Selecciona un evento:</label>
        <select
          id="evento"
          className="px-4 py-2 rounded-lg text-black"
          value={eventoSeleccionado?.event_id || ""}
          onChange={(e) =>
            setEventoSeleccionado(
              eventosSafe.find((evento) => evento.event_id === parseInt(e.target.value))
            )
          }
        >
          <option value="" disabled>
            -- Selecciona un evento --
          </option>
          {eventosSafe.map((evento) => (
            <option key={evento.event_id} value={evento.event_id}>
              {evento.event_title}
            </option>
          ))}
        </select>
      </div>

      {loadingContext ? (
        <button className="px-6 py-3 bg-yellow-400 text-black rounded-lg" disabled>
          Sincronizando...
        </button>
      ) : (
        <>
          <button
            onClick={handleStartScanner}
            className="px-6 py-3 bg-yellow-400 text-black rounded-lg"
            disabled={!eventoSeleccionado}
          >
            Iniciar Escáner
          </button>

          <div id="reader" className="w-full max-w-md mt-6" ref={qrRef}></div>

          {validacion && (
            <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
              <div
                className={`text-6xl font-bold px-8 py-6 rounded-2xl shadow-2xl transition-all duration-500 ${
                  validacion === "OK"
                    ? "bg-green-400 text-black"
                    : validacion === "YA_VALIDADO"
                    ? "bg-orange-400 text-black"
                    : "bg-red-500 text-white"
                }`}
              >
                {validacion === "OK"
                  ? "✅ CÓDIGO VÁLIDO"
                  : validacion === "YA_VALIDADO"
                  ? "⚠️ YA ESCANEADO"
                  : "❌ CÓDIGO NO VÁLIDO"}
              </div>
            </div>
          )}
        </>
      )}

      {errorContext && <div className="text-red-500 mt-4">Error: {errorContext}</div>}
    </div>
  );
}
