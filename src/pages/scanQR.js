// src/pages/ScanQR.jsx
import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";

export default function ScanQR() {
  const {
    scannedCode,
    setScannedCode,
    asistentes,
  } = useEvento();

  const [cameraStarted, setCameraStarted] = useState(false);
  const [validacion, setValidacion] = useState(null); // OK o ERROR
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
  }, [cameraStarted]);

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
 
  const handleStartScanner = async () => {
    try {
      const res = await fetch('/wp-json/mep/v1/insert-eventos-desde-api', {
        method: 'GET',
      });
      const data = await res.json();
  
      if (data.success) {
        console.log('Sincronización completa:', data.message);
        setCameraStarted(true); // <- Aquí, solo si fue exitosa la sincronización
      } else {
        alert('Error al sincronizar: ' + data.message);
      }
    } catch (error) {
      console.error('Error al llamar al endpoint:', error);
      alert('No se pudo iniciar el escáner. Intenta de nuevo.');
    }
  };
  
  
  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center">
      <h1 className="text-3xl text-yellow-400 font-bold mb-6">Ticket Flow</h1>

      {!cameraStarted ? (
        <button
          onClick={() =>{ 
            handleStartScanner();
          }}

          className="px-6 py-3 bg-yellow-400 text-black rounded-lg"
        >
          Iniciar escáner
        </button>
 

      ) : (
        <div id="reader" className="w-full max-w-md" ref={qrRef}></div>
      )}

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
    </div>
  );
}
