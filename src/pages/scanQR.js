import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import EventoInfo from "../components/EventInfo";

export default function ScanQR() {
  const {
    asistentes = [],
    scannedCode,
    setScannedCode,
    fetchEvento,
    eventos,
    setLoading, // Aseguramos que setLoading venga del contexto
    loading: loadingContext,
    error: errorContext,
  } = useEvento();

  // Aseguramos que eventos sea siempre un array
  // Esto es importante para evitar errores si eventos no está definido
  //Eventos y el Render del Fetch
  
  const eventosSafe = Array.isArray(eventos) ? eventos : [];

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);

  // Llamar a fetchEvento al montar el componente
  useEffect(() => {
    fetchEvento("http://localhost/wordpress/wp-json/ticketflow/v1/eventos-activos");
  }, []);

  // Seleccionar automáticamente el primer evento si no hay uno seleccionado
  useEffect(() => {
    if (eventosSafe.length > 0 && !eventoSeleccionado) {
      setEventoSeleccionado(eventosSafe[0]);
    }
  }, [eventosSafe]);

  useEffect(() => {
    if (!cameraStarted) return;

    const qrCodeRegionId = "reader";
    qrScanner.current = new Html5Qrcode(qrCodeRegionId);

    qrScanner.current
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 300, height: 300 } },
        (decodedText) => {
          setScannedCode(decodedText);
          validarCodigo(decodedText);
          qrScanner.current.stop();
        },
        () => {}
      )
      .catch((err) => {
        console.error("No se pudo iniciar la cámara", err);
      });

    return () => {
      if (qrScanner.current) {
        qrScanner.current.stop().catch(() => {});
      }
    };
  }, [cameraStarted, setScannedCode]);

  const validarCodigo = async (codigo) => {
    if (!codigo || !eventoSeleccionado?.id) {
      setValidacion("ERROR");
      return;
    }

    try {
      const res = await fetch(
        `/wp-json/ticketflow/v1/escanear/${eventoSeleccionado.id}/${codigo}`
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
    if (loadingContext || !eventoSeleccionado) {
      alert("Por favor, selecciona un evento antes de iniciar el escáner.");
      return;
    }

    try {
      setLoading(true);

      console.log("Iniciando sincronización con la API...");

      const res = await fetch(
        "/wp-json/mep/v1/mep_sincronizar_eventos_y_asistentes",
        {
          method: "GET",
        }
      );

      console.log("Respuesta de la API:", res);

      const data = await res.json();

      if (data.success) {
        console.log("Sincronización completa:", data.message);
        await fetchEvento("http://localhost/wordpress/wp-json/ticketflow/v1/eventos-activos");
        setCameraStarted(true);
      } else {
        alert("Error al sincronizar: " + data.message);
      }
    } catch (error) {
      console.error("Error al llamar al endpoint:", error);
      alert("No se pudo iniciar el escáner. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-3xl text-yellow-400 font-bold mb-6">Ticket Flow</h1>

      <div className="mb-4">
        <label htmlFor="evento" className="block mb-2">
          Selecciona un evento:
        </label>
        <select
          id="evento"
          className="px-4 py-2 rounded-lg text-black"
          value={eventoSeleccionado?.id || ""}
          onChange={(e) =>
            setEventoSeleccionado(
              eventosSafe.find((evento) => evento.id === parseInt(e.target.value))
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
        <button
          onClick={handleStartScanner}
          className="px-6 py-3 bg-yellow-400 text-black rounded-lg"
          disabled={loadingContext}
        >
          Sincronizando...
        </button>
      ) : (
        <>
          <button
            onClick={handleStartScanner}
            className="px-6 py-3 bg-yellow-400 text-black rounded-lg"
            disabled={eventosSafe.length === 0}
          >
            Iniciar Escáner
          </button>
          <div id="reader" className="w-full max-w-md mt-6" ref={qrRef}></div>
          {scannedCode && (
            <div
              className="mt-6 px-4 py-2 rounded-lg"
              style={{
                backgroundColor:
                  validacion === "OK"
                    ? "limegreen"
                    : validacion === "YA_VALIDADO"
                    ? "orange"
                    : "red",
                color: "black",
              }}
            >
              {validacion === "OK"
                ? "✅ Código válido"
                : validacion === "YA_VALIDADO"
                ? "⚠️ Código ya validado"
                : "❌ Código no válido"}
              <div className="mt-2">Código: {scannedCode}</div>
            </div>
          )}
        </>
      )}

      {errorContext && (
        <div className="text-red-500 mt-4">Error: {errorContext}</div>
      )}
    </div>
  );
}
