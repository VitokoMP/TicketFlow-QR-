

// ---------------------------
// useScannerLogic.js
// ---------------------------
import { useCallback, useRef, useState } from "react";
import { useEvento } from "./EventoContext";
import { ScannerAPI } from "./apiService";

const Html5QrcodeScannerState = (window && window.Html5QrcodeScannerState) || { PAUSED: 2, SCANNING: 1 };
const MIN_DISPLAY_TIME = 800;
const ERROR_DISPLAY_TIME = 1600;

const getLocalizedMessage = (statusUpper) => {
  switch(statusUpper){
    case "VALID": return "Entrada válida";
    case "ALREADY_SCANNED": return "Ya validado";
    case "PENDING": return "Pendiente";
    default: return "Estado no válido";
  }
};

const getErrorMessage = (error) => {
  const msg = error?.message || "";
  if (msg.toLowerCase().includes("network")) return "Error de conexión";
  if (msg.toLowerCase().includes("timeout")) return "Timeout del servidor";
  return "Error en el escaneo";
};

export function useScannerLogic({ qrScanner, extractTicketCode, normalizeUrl }) {
  const isMounted = useRef(true);
  const scanningPausedRef = useRef(false);
  const lastScannedRef = useRef(null);
  const timeoutRef = useRef(null);

  const [scanState, setScanState] = useState({
    scanningPaused: false,
    lastScanned: null,
    validation: null,
    showOverlay: false,
    scannerState: Html5QrcodeScannerState.SCANNING
  });

  const { eventoSeleccionado, getAsistenteByCode, setAsistenteStatusOptimistic, upsertAsistente } = useEvento();

  const safeCall = async (fn) => { try { return await fn(); } catch { return undefined; } };

  const resetScannerState = () => {
    scanningPausedRef.current = false;
    lastScannedRef.current = null;
    setScanState(prev => ({
      ...prev,
      scanningPaused: false,
      validation: null,
      showOverlay: false,
      scannerState: Html5QrcodeScannerState.SCANNING
    }));
  };

  const restartScanner = async () => {
    await safeCall(async () => {
      if (qrScanner.current?.getState && qrScanner.current.getState() === Html5QrcodeScannerState.PAUSED) {
        await qrScanner.current.resume();
      }
    });
  };

  const scheduleScannerRestart = (scanStartTime, validationState) => {
    const elapsed = performance.now() - scanStartTime;
    const isError = validationState.status === "error" || validationState.status === "ya-validado";
    const displayTime = isError ? ERROR_DISPLAY_TIME : MIN_DISPLAY_TIME;
    const remainingDelay = Math.max(displayTime - elapsed, isError ? 1500 : 800);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!isMounted.current) return;
      resetScannerState();
      restartScanner().catch(console.error);
    }, remainingDelay);
  };

  const handleBackendValidation = async (eventId, ticketCode, localAsistenteId) => {
    const checkResult = await ScannerAPI.checkTicketStatus(eventId, ticketCode);
    if (!checkResult.success) return { validationState: { status:"error", mensaje: checkResult.mensaje||"QR inválido", asistente:null, timestamp:Date.now() } };
    if (checkResult.status === "PENDING") {
      const markResult = await ScannerAPI.markAsScanned(localAsistenteId || checkResult.asistente.id);
      const isAlready = markResult.status==="ALREADY_SCANNED";
      const statusUpper = isAlready ? "ALREADY_SCANNED" : "VALID";
      return { validationState: { status: isAlready?"ya-validado":"valid", mensaje: markResult.mensaje||(isAlready?"Ya validado":"Entrada válida"), asistente: checkResult.asistente, timestamp:Date.now() }, asistenteData: {...checkResult.asistente, status:statusUpper} };
    }
    return { validationState: { status:(checkResult.status||"ERROR").toLowerCase(), mensaje:getLocalizedMessage(checkResult.status||"ERROR"), asistente:checkResult.asistente, timestamp:Date.now() }, asistenteData: checkResult.asistente };
  };

  const handleScanSuccess = useCallback(async (decodedText) => {
    if (!isMounted.current || scanningPausedRef.current || !qrScanner.current || !eventoSeleccionado) return;
    const ticketCode = extractTicketCode(normalizeUrl(decodedText));
    if (!ticketCode || ticketCode===lastScannedRef.current) return;

    scanningPausedRef.current = true;
    lastScannedRef.current = ticketCode;
    const scanStartTime = performance.now();

    setScanState(prev=>({...prev, scanningPaused:true, lastScanned:ticketCode, validation:{status:"verificando", mensaje:"Verificando ticket...", timestamp:Date.now()}, showOverlay:true, scannerState:Html5QrcodeScannerState.PAUSED }));

    safeCall(async ()=>{ if (qrScanner.current?.getState===Html5QrcodeScannerState.SCANNING) await qrScanner.current.pause(); });

    try {
      const evId = eventoSeleccionado.event_id;
      const asistenteLocal = getAsistenteByCode(evId, ticketCode);
      let validationState;
      let needsBackendSync = true;

      if (asistenteLocal) {
        validationState = { status:(asistenteLocal.status||"PENDING").toLowerCase(), mensaje:getLocalizedMessage(asistenteLocal.status||"PENDING"), asistente:asistenteLocal, timestamp:Date.now(), fromCache:true };
        setScanState(prev=>({...prev, validation:validationState}));
        needsBackendSync = (asistenteLocal.status==="PENDING");
        if (needsBackendSync) setAsistenteStatusOptimistic(evId, ticketCode, "VALID");
      }

      if (needsBackendSync) {
        try {
          const backendResult = await handleBackendValidation(evId, ticketCode, asistenteLocal?.id);
          if (backendResult) {
            validationState = backendResult.validationState;
            setScanState(prev=>({...prev, validation:validationState}));
            if (backendResult.asistenteData) upsertAsistente(evId, backendResult.asistenteData);
          }
        } catch(be){ console.error("Backend sync error:",be); if(!validationState) validationState={status:"error", mensaje:getErrorMessage(be), asistente:null, timestamp:Date.now()}; setScanState(prev=>({...prev, validation:validationState, showOverlay:true})); }
      }

      scheduleScannerRestart(scanStartTime, validationState||{status:"error", timestamp:Date.now()});
    } catch(error){ console.error("Critical scan error:",error); const errorState={status:"error", mensaje:getErrorMessage(error), timestamp:Date.now()}; setScanState(prev=>({...prev, validation:errorState, showOverlay:true})); if(timeoutRef.current) clearTimeout(timeoutRef.current); timeoutRef.current=setTimeout(()=>{if(!isMounted.current) return; resetScannerState(); restartScanner().catch(console.error);}, ERROR_DISPLAY_TIME);}
  }, [eventoSeleccionado, extractTicketCode, normalizeUrl, getAsistenteByCode, setAsistenteStatusOptimistic, upsertAsistente]);

  return { scanState, setScanState, handleScanSuccess, restartScanner };
}


