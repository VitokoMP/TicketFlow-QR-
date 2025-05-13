import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import EventoInfo from "../components/EventInfo";

export default function ScanQR() {
  const {
    asistentes, 
    scannedCode, 
    setScannedCode, 
    fetchEvento, 
    loading: loadingContext, 
    error: errorContext, 
  } = useEvento();

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null); 
  const qrRef = useRef(null);
  const qrScanner = useRef(null);

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

  const validarCodigo = (codigo) => {
    const encontrado = asistentes.find(
      (asistente) => asistente.codigo_qr === codigo
    );

    if (encontrado) {
      setValidacion("OK");
    } else {
      setValidacion("ERROR");
    }
  };


  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-3xl text-yellow-400 font-bold mb-6">Ticket Flow</h1>

    <EventoInfo />
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
          <div id="reader" className="w-full max-w-md" ref={qrRef}></div>
          {scannedCode && (
            <div
              className="mt-6 px-4 py-2 rounded-lg"
              style={{
                backgroundColor: validacion === "OK" ? "limegreen" : "red",
                color: "black",
              }}
            >
              {validacion === "OK" ? "✅ Código válido" : "❌ Código no válido"}
              <div className="mt-2">Código: {scannedCode}</div>
            </div>
          )}
        </>
      )}

      {errorContext && <div className="text-red-500 mt-4">Error: {errorContext}</div>} 
    </div>
  );
}
