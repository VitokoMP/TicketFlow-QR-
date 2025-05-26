import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";

export default function ScanQR() {
  const {
    asistentes = [],
    scannedCode,
    setScannedCode,
    eventos,
    setLoading,
    loading: loadingContext,
    error: errorContext,
    selectEvento,
  } = useEvento();

  const eventosSafe = Array.isArray(eventos) ? eventos : [];
  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
  const qrRef = useRef(null);
  const qrScanner = useRef(null);
  const lastScannedRef = useRef("");
  const [codigoEscaneado, setCodigoEscaneado] = useState(null);
  const [mensajeQR, setMensajeQR] = useState(""); // <-- NUEVO estado

  // Elimina este useEffect para NO preseleccionar el primer evento
  // useEffect(() => {
  //   if (eventosSafe.length > 0 && !eventoSeleccionado && eventosSafe[0]?.event_id) {
  //     setEventoSeleccionado(eventosSafe[0]);
  //   }
  // }, [eventosSafe]);

  // Asegúrate de que el valor inicial sea null
  //const [eventoSeleccionado, setEventoSeleccionado] = useState(null);

  // Reset cámara y validación al cambiar evento
  useEffect(() => {
    if (eventoSeleccionado) {
      setCameraStarted(false);
      setValidacion(null);
    }
  }, [eventoSeleccionado]);

  // Función para limpiar el código escaneado
  const limpiarCodigo = (codigo) => {
    const partes = codigo.split("/").filter(Boolean);
    return partes[partes.length - 1];
  };

  // Callback del scanner: solo guarda el código, no valida automáticamente
  const onScanSuccess = (decodedText) => {
    console.log("🔗 Código detectado:", decodedText);
    setMensajeQR(`Código detectado: ${decodedText}`); // <-- Mostrar mensaje
    const codigoLimpio = limpiarCodigo(decodedText);
    setCodigoEscaneado(codigoLimpio);
    console.log("🔗 Código Limpioo:", codigoLimpio);
    setScannedCode && setScannedCode(codigoLimpio);
    setTimeout(() => setMensajeQR(""), 2000); // <-- Limpiar mensaje después de 2s
  };

  // Iniciar y limpiar escáner
  useEffect(() => {
    if (!cameraStarted) return;

    let isMounted = true;
    let retryTimeout = null;

    const startScanner = async () => {
      // Limpieza previa si ya hay un escáner
      if (qrScanner.current) {
        try {
          await qrScanner.current.stop();
          await qrScanner.current.clear();
        } catch (e) {
          console.warn("⚠️ Error limpiando escáner antes de iniciar:", e);
        }
        qrScanner.current = null;
      }

      if (!qrRef.current || !document.getElementById('reader')) {
        console.warn("El div #reader no está presente en el DOM.");
        retryTimeout = setTimeout(startScanner, 500);
        return;
      }

      const qrCodeRegionId = "reader";
      qrScanner.current = new Html5Qrcode(qrCodeRegionId);

      console.log("🟡 Iniciando escáner QR...");
      try {
        await qrScanner.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 300, height: 300 } },
          onScanSuccess, // <-- Solo guarda el código
          (errorMessage) => {
            if (!errorMessage.includes("NotFoundException")) {
              console.warn("Error escaneando QR:", errorMessage);
            }
          }
        );
        console.log("🟢 Cámara lista y escáner iniciado.");
      } catch (err) {
        if (isMounted) {
          console.error("No se pudo iniciar la cámara:", err);
          alert("No se pudo acceder a la cámara. Asegúrate de haber dado permisos.");
          setCameraStarted(false);
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (qrScanner.current) {
        qrScanner.current
          .stop()
          .then(() => qrScanner.current.clear())
          .then(() => {
            qrScanner.current = null;
            console.log("🔴 Escáner detenido y limpiado correctamente");
          })
          .catch((err) => {
            console.warn("⚠️ Error al detener o limpiar el escáner:", err);
          });
      }
    };
  }, [cameraStarted]);

  // Ocultar validación visual después de 2 segundos
  useEffect(() => {
    if (validacion) {
      const timeout = setTimeout(() => setValidacion(null), 2000);
      return () => clearTimeout(timeout);
    }
  }, [validacion]);

  const validarCodigo = async (codigo) => {
    console.log("🟡 Iniciando validación para:", codigo, "evento:", eventoSeleccionado?.event_id);
    if (!codigo || !eventoSeleccionado?.event_id) {
      console.log("🔴 Código o evento no válido:", codigo, eventoSeleccionado?.event_id);
      setValidacion("ERROR");
      return;
    }
  
    try {
      // 1. Recuperar el estado del QR
      const url = `/wordpress/wp-json/ticketflow/v1/escanear/${eventoSeleccionado.event_id}/${codigo}`;
      console.log("🔵 Fetch a:", url);
      const res = await fetch(url);
      const data = await res.json();
      console.log("🔍 Estado recibido del backend:", data);
  
      if (data.status === "OK" && data.asistente?.id) {
        // 2. Marcar como escaneado solo si está pendiente
        const markUrl = `/wordpress/wp-json/ticketflow/v1/mark-as-scanned/${data.asistente.id}`;
        console.log("🟢 Marcando como escaneado:", markUrl);
        const markRes = await fetch(markUrl, {
          method: "POST",
        });
        const markData = await markRes.json();
        console.log("✅ Respuesta al marcar como escaneado:", markData);
  
        if (markData.success) {
          console.log("🟢 Código validado correctamente");
          setValidacion("OK");
        } else if (markData.code === "already_scanned") {
          console.log("🟠 Código ya validado anteriormente (respuesta del backend)");
          setValidacion("YA_VALIDADO");
        } else {
          console.log("🔴 Error al marcar como escaneado", markData);
          setValidacion("ERROR");
        }
      } else if (data.status === "SCANNED") {
        console.log("🟠 Código ya validado anteriormente");
        setValidacion("YA_VALIDADO");
      } else if (data.status === "MISMATCH" || data.status === "NOT_FOUND") {
        console.log("🔴 Código no encontrado o no corresponde");
        setValidacion("ERROR");
      } else {
        console.log("🔴 Estado desconocido:", data.status);
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
      await selectEvento(eventoSeleccionado);
      setCameraStarted(true);
    } catch (error) {
      console.error("❌ Error al sincronizar:", error);
      alert("No se pudo iniciar el escáner. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  // Validar solo al presionar el botón
  const onValidarClick = () => {
    if (!codigoEscaneado) {
      alert("No hay código para validar");
      return;
    }
    validarCodigo(codigoEscaneado);
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center">
      {/* Mostrar mensaje QR arriba */}
      {mensajeQR && (
        <div className="fixed top-10 left-1/2 transform -translate-x-1/2 bg-yellow-300 text-black px-4 py-2 rounded shadow z-50">
          {mensajeQR}
        </div>
      )}

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
              eventosSafe.find((evento) => String(evento.event_id) === e.target.value)
            )
          }
        >
          <option value="" disabled>
            -- Selecciona un evento --
          </option>
          {eventosSafe.map((evento) => (
            <option key={evento.event_id} value={String(evento.event_id)}>
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
            {cameraStarted ? "Reiniciar Escáner" : "Iniciar Escáner"}
          </button>
          {cameraStarted && (
            <div className="relative w-full max-w-md mt-6">
              <div
                id="reader"
                ref={qrRef}
                className="w-full"
                style={{ minHeight: "300px", backgroundColor: "#000" }}
              ></div>

              {/* Overlay SOLO sobre el escáner */}
              {validacion && (
                <div className="absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center z-50 rounded-2xl">
                  {validacion === "OK" && (
                    <>
                      <svg
                        className="w-24 h-24 mb-4 animate-bounce"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 48 48"
                      >
                        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path
                          d="M14 26l7 7 13-13"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                      <span className="text-3xl font-bold mb-4">✅ CÓDIGO VÁLIDO</span>
                    </>
                  )}
                  {validacion === "YA_VALIDADO" && (
                    <>
                      <svg
                        className="w-24 h-24 mb-4 animate-pulse"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 48 48"
                      >
                        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path
                          d="M16 16l16 16M32 16l-16 16"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                      <span className="text-3xl font-bold mb-4">⚠️ YA ESCANEADO</span>
                      <button
                        className="px-6 py-3 bg-black bg-opacity-60 text-white rounded-lg text-xl hover:bg-opacity-80 transition"
                        onClick={() => setValidacion(null)}
                      >
                        Volver a escanear
                      </button>
                    </>
                  )}
                  {validacion !== "OK" && validacion !== "YA_VALIDADO" && (
                    <>
                      <svg
                        className="w-24 h-24 mb-4 animate-pulse"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 48 48"
                      >
                        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path
                          d="M16 16l16 16M32 16l-16 16"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                      <span className="text-3xl font-bold mb-4">❌ CÓDIGO NO VÁLIDO</span>
                      <button
                        className="px-6 py-3 bg-black bg-opacity-60 text-white rounded-lg text-xl hover:bg-opacity-80 transition"
                        onClick={() => setValidacion(null)}
                      >
                        Volver a escanear
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Mostrar código escaneado y botón de validación */}
              {codigoEscaneado && (
                <div className="mt-4 p-4 bg-gray-800 rounded">
                  <p>
                    Código escaneado: <strong>{codigoEscaneado}</strong>
                  </p>
                  <button
                    onClick={onValidarClick}
                    className="mt-2 px-4 py-2 bg-yellow-400 text-black rounded"
                  >
                    Validar Entrada
                  </button>
                </div>
              )}
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

