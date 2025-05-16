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
  // Cooldown para evitar escaneos duplicados rápidos
  const lastScannedRef = useRef("");

  // Seleccionar automáticamente el primer evento si no hay uno seleccionado
  useEffect(() => {
    if (eventosSafe.length > 0 && !eventoSeleccionado && eventosSafe[0]?.event_id) {
      setEventoSeleccionado(eventosSafe[0]);
    }
  }, [eventosSafe]);

  // Iniciar el escáner QR al seleccionar un evento
  useEffect(() => {
    if (eventoSeleccionado) {
      setCameraStarted(false);
      setValidacion(null);
    }
  }, [eventoSeleccionado]);

  useEffect(() => {
    // Mostrar en consola el estado de cameraStarted cuando cambie
    console.log("Estado de cameraStarted:", cameraStarted);
    // Si cameraStarted es false, no iniciar el escáner
    if (!cameraStarted) return;

    // Verificación defensiva del div 'reader'
    if (!qrRef.current || qrRef.current.offsetWidth === 0 || qrRef.current.offsetHeight === 0) {
      console.error("❌ El div 'reader' no está disponible o no tiene tamaño visible.");
      setCameraStarted(false);
      return;
    }

    const qrCodeRegionId = "reader";
    qrScanner.current = new Html5Qrcode(qrCodeRegionId);

    console.log("🟡 Iniciando escáner QR...");
    const startScanner = async () => {
      try {
        await qrScanner.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 300, height: 300 } },
          (decodedText) => {
            // Cooldown para evitar escaneos duplicados
            if (lastScannedRef.current === decodedText) return;
            lastScannedRef.current = decodedText;
            setScannedCode(decodedText);
            validarCodigo(decodedText);
            setTimeout(() => {
              lastScannedRef.current = "";
            }, 2000);
          },
          (errorMessage) => {
            if (!errorMessage.includes("NotFoundException")) {
              console.warn("Error escaneando QR:", errorMessage);
            }
          }
        );
        console.log("🟢 Cámara lista y escáner iniciado.");
      } catch (err) {
        console.error("No se pudo iniciar la cámara:", err);
        alert("No se pudo acceder a la cámara. Asegúrate de haber dado permisos.");
        setCameraStarted(false);
      }
    };

    startScanner();

    // Limpieza robusta del escáner al desmontar o reiniciar
    return () => {
      if (qrScanner.current) {
        qrScanner.current.stop()
          .then(() => qrScanner.current.clear())
          .then(() => {
            console.log("🔴 Escáner detenido y limpiado correctamente");
          })
          .catch((err) => {
            console.warn("⚠️ Error al detener o limpiar el escáner:", err);
          });
      }
    };
  }, [cameraStarted]);

  const validarCodigo = async (codigo) => {
    if (!codigo || !eventoSeleccionado?.event_id) {
      setValidacion("ERROR");
      return;
    }

    try {
      const res = await fetch(`/wp-json/ticketflow/v1/escanear/${eventoSeleccionado.event_id}/${codigo}`);
      if (!res.ok) throw new Error("QR no válido");

      const data = await res.json();

      if (data.status === "OK") {
        // Marca como escaneado si tienes endpoint y el asistente tiene id
        if (data.asistente?.id) {
          await fetch(`/wp-json/ticketflow/v1/mark-as-scanned/${data.asistente.id}`, { method: "POST" });
        }
        setValidacion("OK");
      } else if (data.status === "MISMATCH" || data.status === "NOT_FOUND") {
        setValidacion("ERROR");
      } else if (data.status === "SCANNED") {
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
      alert("Por favor, selecciona un evento válido antes de iniciar el escáner.");
      return;
    }

    try {
      setLoading(true);
      console.log("🟡 Iniciando sincronización con la API...");

      const eventId = eventoSeleccionado.event_id;
      console.log("📌 ID del evento seleccionado:", eventId);

      const res = await fetch(`/wordpress/wp-json/ticketflow/v1/sync-attendees/${eventId}`, {
        method: "GET",
      });

      console.log("📡 Estado de la respuesta HTTP:", res.status, res.statusText);

      if (!res.ok) {
        throw new Error(`Error en la respuesta del servidor: ${res.statusText}`);
      }

      const data = await res.json();
      console.log("📥 Datos recibidos desde sync-attendees:", data);

      if (data.success) {
        console.log("✅ Sincronización exitosa:", data.message);

        // Verifica si los datos que vinieron tienen asistentes inesperados
        if (Array.isArray(data.attendees)) {
          console.log("🧾 Lista de asistentes sincronizados:", data.attendees);
        }

        // Refresca la data desde el backend (contexto)
        await fetchEventos();

        // Revisa si luego de fetchEventos() los asistentes están correctos
        setTimeout(() => {
          console.log("📊 Estado de asistentes tras fetchEventos:", asistentes);
        }, 1000); // Delay para esperar que el contexto se actualice

        setCameraStarted(true);
      } else {
        console.warn("⚠️ Fallo en sincronización:", data.message);
        alert("Error al sincronizar: " + (data.message || "Respuesta inesperada."));
      }
    } catch (error) {
      console.error("❌ Error al llamar al endpoint:", error);
      alert("No se pudo iniciar el escáner. Intenta de nuevo.");
    } finally {
      setLoading(false);
      console.log("🔁 Finalizó proceso handleStartScanner");
    }
  };

  // Manejo de errores y logs
  useEffect(() => {
    // Verificar que el div con id 'reader' esté montado y tenga tamaño visible antes de iniciar cámara
    if (qrRef.current && qrRef.current.offsetWidth > 0 && qrRef.current.offsetHeight > 0) {
      console.log("🟢 El div 'reader' está listo para iniciar la cámara.");
    }
    console.log("Eventos disponibles:", eventosSafe);
    console.log("Evento seleccionado:", eventoSeleccionado);
    console.log("Asistentes:", asistentes);
    if (errorContext) console.error("Error de contexto:", errorContext);
  }, [eventosSafe, eventoSeleccionado, asistentes, errorContext]);

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
            disabled={eventosSafe.length === 0 || !eventoSeleccionado}
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

      {errorContext && (
        <div className="text-red-500 mt-4">Error: {errorContext}</div>
      )}
    </div>
  );
}
