import React, { useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import QRScannerComponent from "../components/QRScannerComponent"; // Assuming you have a reusable QR scanner component

const ScanQR = ({ eventoId }) => {
  const [scanning, setScanning] = useState(true);
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(false);

  const onScan = async (data) => {
    if (data && scanning) {
      setScanning(false); // Pause scanner temporarily
      setLoading(true);
      const qrCode = data.text;

      try {
        const res = await fetch(`/wp-json/ticketflow/v1/escanear/${eventoId}/${qrCode}`);
        const json = await res.json();
        setQrData({ ...json, qrCode });
      } catch (err) {
        console.error("Error escaneando:", err);
        setQrData({ error: "No se pudo validar el código." });
      } finally {
        setLoading(false);
      }
    }
  };

  const confirmarEscaneo = async () => {
    if (!qrData?.asistente?.id) return;

    try {
      const res = await fetch(`/wp-json/ticketflow/v1/confirmar-escanear/${qrData.asistente.id}`, {
        method: "POST",
      });
      const data = await res.json();
      alert(data.message || "Confirmado");
    } catch (err) {
      console.error(err);
      alert("Error al confirmar escaneo");
    } finally {
      setQrData(null);
      setScanning(true); // Reactivate scanner
    }
  };

  const siguiente = () => {
    setQrData(null);
    setScanning(true); // Enable new scan
  };

  return (
    <div className="p-4">
      {scanning ? (
        <QRScannerComponent onScan={onScan} />
      ) : loading ? (
        <p>Validando...</p>
      ) : qrData ? (
        <div className="text-center">
          <h2>{qrData.mensaje}</h2>
          {qrData.asistente && (
            <div className="bg-white p-4 shadow rounded my-4">
              <p>
                <strong>QR:</strong> {qrData.qrCode}
              </p>
              <p>
                <strong>Estado:</strong> {qrData.asistente.scan_status}
              </p>
              {/* Display additional data if needed */}
            </div>
          )}

          {qrData.status === "OK"
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
        await fetchEvento(); // Llamamos a la función para cargar los eventos y asistentes
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
              eventos.find((evento) => evento.id === e.target.value)
            )
          }
        >
          <option value="" disabled>
            -- Selecciona un evento --
          </option>
          {eventos.map((evento) => (
            <option key={evento.id} value={evento.id}>
              {evento.nombre}
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
