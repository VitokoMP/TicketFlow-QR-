import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScannerState } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import { ScannerAPI } from "../services/ApiService";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/warning.png';
import '../public/css/ScanQR.css';

// ==========================================
// 🔧 CONSTANTES
// ==========================================
const STOP_RETRY_MAX = 8;
const STOP_RETRY_BASE_MS = 120;
const MAX_BACKOFF_MS = 10000;
const SCAN_COOLDOWN_MS = 1200;
const OVERLAY_AUTO_CLOSE_MS = 3000;
const SYNC_INTERVAL_MS = 300_000; // 5 min
const SYNC_BUTTON_COOLDOWN_MS = 20_000;

// ==========================================
// 📅 UTILIDADES DE FECHA (modelo nuevo: event_start_date / event_end_date)
// ==========================================
// El backend entrega "2026-06-30 19:15:00" (sin timezone). Si lo pasamos
// directo a `new Date()`, algunos navegadores lo interpretan distinto
// (Safari puede fallar; Chrome lo trata como hora LOCAL, no UTC).
// Forzamos el formato ISO local agregando la "T" para que el comportamiento
// sea consistente entre navegadores, y se interprete como hora local
// (que es lo correcto, asumiendo que el backend ya manda hora de Santiago).
function parseEventDate(dateStr) {
  if (!dateStr) return null;
  const parsed = new Date(dateStr.replace(' ', 'T'));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isToday(dateStr) {
  const d = parseEventDate(dateStr);
  if (!d) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate()
  );
}

// Disponible para usar en UI o validaciones futuras (ver nota al inicio de la
// respuesta: esta lógica no existía en el componente original).
// Reglas: futuro -> now < start | en curso -> start <= now <= end | terminado -> now > end
function getEventStatus(evento) {
  const start = parseEventDate(evento?.event_start_date);
  const end   = parseEventDate(evento?.event_end_date);
  if (!start || !end) return 'unknown';

  const now = new Date();
  if (now < start) return 'future';
  if (now > end)   return 'ended';
  return 'ongoing';
}

// ==========================================
// 🔍 DIAGNÓSTICO: Buffer circular en memoria
// ==========================================
const DIAG_BUFFER_MAX = 200;
const diagBuffer = [];

function diagLog(tag, data = {}) {
  const entry = { ts: new Date().toISOString(), tag, ...data };
  diagBuffer.push(entry);
  if (diagBuffer.length > DIAG_BUFFER_MAX) diagBuffer.shift();
  console.log(`[${tag}]`, data);
}

window.__getDiagLogs = () => { console.table(diagBuffer); return diagBuffer; };
window.__downloadDiagLogs = () => {
  const blob = new Blob([JSON.stringify(diagBuffer, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scanqr-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
window.__clearDiagLogs = () => { diagBuffer.length = 0; };

// ==========================================
// 🏭 COMPONENTE PRINCIPAL
// ==========================================
export default function ScanQR() {
  const contexto = useEvento();
  const {
    eventos,
    asistentes,
    eventoSeleccionado,
    validarTicket,
    setLoading,
    setEventoSeleccionado,
    updateAsistenteStatus,
    loadAsistentes,
  } = contexto;

  const setAsistentes = useCallback(
    (value) => contexto.setAsistentes(value),
    [contexto]
  );

  // ==========================================
  // 📊 ESTADOS (mínimos necesarios)
  // ==========================================
  const [mostrarSoloHoy, setMostrarSoloHoy] = useState(true);
  const [cameraActive, setCameraActive]     = useState(false);
  const [validation, setValidation]         = useState(null); // { status, mensaje, asistente }
  const [showOverlay, setShowOverlay]       = useState(false);

  // ==========================================
  // 📌 REFS
  // ==========================================
  const qrRef                  = useRef(null);
  const qrScanner              = useRef(null);
  const isMounted              = useRef(true);
  const isScannerStarting      = useRef(false);
  const startAttemptsRef       = useRef(0);
  const retryTimeoutRef        = useRef(null);
  const overlayTimeoutRef      = useRef(null);
  const lastSyncTimeRef        = useRef(0);
  const syncButtonCooldownRef  = useRef(0);

  // 🔒 Lock global de validación — UN solo scan activo a la vez
  const qrLockRef              = useRef(false);
  const lastScanTimeRef        = useRef(0);

  // 🔗 Ref estable para handleScanSuccess (rompe dependencia circular con startScannerCore)
  const handleScanSuccessRef   = useRef(null);

  // ==========================================
  // 🧮 DATOS DERIVADOS
  // ==========================================
  // ✅ Migrado a event_start_date. isToday/parseEventDate viven fuera del
  // componente porque no dependen de props/estado (evita recrearlos en cada render).
  const eventosMostrados = useMemo(() => {
    if (!mostrarSoloHoy) return eventos;
    return eventos.filter(ev => isToday(ev.event_start_date));
  }, [eventos, mostrarSoloHoy]);

  const asistentesDelEvento = useMemo(() => {
    if (!eventoSeleccionado?.event_id) return [];
    return asistentes[eventoSeleccionado.event_id] || [];
  }, [eventoSeleccionado, asistentes]);

  // ✅ Contadores calculados desde la fuente de verdad real (sin pendingTickets duplicado)
  const totalCount   = asistentesDelEvento.length;
  const scannedCount = asistentesDelEvento.filter(a => a.status === 'SCANNED').length;
  const pendingCount = totalCount - scannedCount;

  // ==========================================
  // 📷 SCANNER — STOP ROBUSTO
  // ==========================================
  const safeStopScanner = useCallback(async () => {
    const scanner   = qrScanner.current;
    const container = document.getElementById('qr-reader');
    if (!scanner) return;

    const inDOM      = () => container && document.body.contains(container);
    const getState   = () => { try { return scanner.getState?.(); } catch { return undefined; } };

    let attempt = 0;
    while (isMounted.current) {
      const state = getState();
      if (state === undefined) break;
      if (
        state !== Html5QrcodeScannerState.SCANNING &&
        state !== Html5QrcodeScannerState.PAUSED
      ) break;

      try {
        await scanner.stop();
        break;
      } catch (err) {
        attempt++;
        if (attempt >= STOP_RETRY_MAX) break;
        const wait = Math.min(STOP_RETRY_BASE_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
        await new Promise(res => setTimeout(res, wait));
      }
    }

    if (inDOM() && typeof scanner.clear === 'function') {
      try { await scanner.clear(); } catch { /* no crítico */ }
    }

    qrScanner.current   = null;
    isScannerStarting.current = false;
    if (isMounted.current) setCameraActive(false);
  }, []);

  // ==========================================
  // 📷 SCANNER — START
  // ==========================================
  const startScannerCore = useCallback(async () => {
    if (isScannerStarting.current || !eventoSeleccionado) return;

    const container = document.getElementById('qr-reader');
    if (!container || !document.body.contains(container)) return;

    isScannerStarting.current = true;

    try {
      await safeStopScanner();

      qrScanner.current = new Html5Qrcode('qr-reader');

      await qrScanner.current.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: 250,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          disableFlip: false,
        },
        // ✅ Usamos ref estable → nunca fuerza restart del scanner por cambio de callback
        (decodedText) => handleScanSuccessRef.current?.(decodedText),
        (errMsg) => console.warn('[scanner] error de lectura:', errMsg)
      );

      startAttemptsRef.current = 0;
      isScannerStarting.current = false;
      if (isMounted.current) setCameraActive(true);

      diagLog('SCANNER_STARTED', { eventId: eventoSeleccionado.event_id });
    } catch (err) {
      isScannerStarting.current = false;

      const name = err?.name;
      if (name === 'NotAllowedError') console.error('[scanner] Permiso denegado');
      else if (name === 'NotFoundError') console.error('[scanner] Sin cámara disponible');
      else if (name === 'AbortError') return;
      else console.error('[scanner] Error al iniciar:', err);

      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      const attempt = ++startAttemptsRef.current;
      const delay   = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      retryTimeoutRef.current = setTimeout(() => {
        if (isMounted.current && eventoSeleccionado) startScannerCore();
      }, delay);
    }
  }, [eventoSeleccionado, safeStopScanner]);

  // ==========================================
  // 🎯 HANDLE SCAN SUCCESS
  // ==========================================
  const handleScanSuccess = useCallback(async (decodedText) => {
    // 🔒 Lock global: un solo scan activo a la vez
    if (qrLockRef.current) {
      diagLog('SCAN_LOCKED');
      return;
    }

    // Anti-spam secundario por tiempo
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_COOLDOWN_MS) {
      diagLog('SPAM_BLOCKED', { ms: now - lastScanTimeRef.current });
      return;
    }

    if (!isMounted.current || !eventoSeleccionado) return;

    // Adquirir lock
    qrLockRef.current = true;
    lastScanTimeRef.current = now;

    // ⏸️ PAUSAR scanner durante validación (evita lecturas nuevas mientras procesamos)
    try {
      const state = qrScanner.current?.getState?.();
      if (state === Html5QrcodeScannerState.SCANNING) {
        await qrScanner.current.pause(true);
        diagLog('SCANNER_PAUSED');
      }
    } catch { /* continuar de todas formas */ }

    // Extraer código
    let ticketCode;
    try {
      const url = new URL(decodedText);
      ticketCode = url.pathname.replace(/\/$/, '').split('/').pop();
    } catch {
      ticketCode = decodedText;
    }
    const normalizedTicket = ticketCode?.toLowerCase().trim();

    diagLog('QR_DETECTED', { ticket: normalizedTicket?.substring(0, 30) });

    if (!normalizedTicket) {
        await releaseScannerAfterOverlay();
        return;
    }

    try {
      diagLog('VALIDATION_START', { eventId: eventoSeleccionado.event_id, ticket: normalizedTicket });

      const result = await validarTicket(eventoSeleccionado.event_id, normalizedTicket);

      if (result.type === 'valid' && result.asistente) {
        updateAsistenteStatus(eventoSeleccionado.event_id, result.asistente.id, 'SCANNED');
      }

      showValidationOverlay({
        status:    result.type,
        mensaje:   result.message,
        asistente: result.asistente,
      });

      diagLog('VALIDATION_DONE', { status: result.type });
    } catch (error) {
      console.error('[scan] Error crítico:', error);
      showValidationOverlay({ status: 'error', mensaje: error.message || 'Error inesperado' });
    }
  }, [eventoSeleccionado, validarTicket, updateAsistenteStatus]);

  // Mantener ref siempre actualizada (sin nunca recrear el scanner)
  useEffect(() => {
    handleScanSuccessRef.current = handleScanSuccess;
  }, [handleScanSuccess]);

  // ==========================================
  // 🪟 OVERLAY — abrir / cerrar
  // ==========================================
  const releaseScannerAfterOverlay = useCallback(async () => {
    // Reanudar scanner
    try {
      const state = qrScanner.current?.getState?.();
      if (state === Html5QrcodeScannerState.PAUSED) {
        await qrScanner.current.resume();
        diagLog('SCANNER_RESUMED');
      }
    } catch { /* no crítico */ }

    // Liberar lock con pequeño delay para evitar re-lectura inmediata del mismo QR
    setTimeout(() => {
      qrLockRef.current = false;
    }, SCAN_COOLDOWN_MS);
  }, []);

  const showValidationOverlay = useCallback((validationData) => {
    // Limpiar timeout previo si lo había
    if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current);

    setValidation(validationData);
    setShowOverlay(true);

    // Cierre automático
    overlayTimeoutRef.current = setTimeout(async () => {
      if (!isMounted.current) return;
      setShowOverlay(false);
      setValidation(null);
      await releaseScannerAfterOverlay();
    }, OVERLAY_AUTO_CLOSE_MS);
  }, [releaseScannerAfterOverlay]);

  const closeOverlay = useCallback(async () => {
    if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current);
    setShowOverlay(false);
    setValidation(null);
    await releaseScannerAfterOverlay();
  }, [releaseScannerAfterOverlay]);

  // ==========================================
  // 🔄 SYNC
  // ==========================================
  const runSync = useCallback(async (eventId) => {
    try {
      const { success, attendees = [], data, message = '' } = await ScannerAPI.syncAttendees(eventId);
      const list = attendees.length ? attendees : (Array.isArray(data) ? data : []);

      if (success && isMounted.current) {
        setAsistentes(prev => {
          const current = prev[eventId] || [];
          const merged  = [...current];

          list.forEach(incoming => {
            const idx = merged.findIndex(a => a.id === incoming.id);
            if (idx >= 0) {
              // Preservar SCANNED local si el servidor no lo sabe todavía
              merged[idx] = {
                ...incoming,
                status: merged[idx].status === 'SCANNED' ? 'SCANNED' : (incoming.status ?? 'PENDING'),
              };
            } else {
              merged.push({ ...incoming, status: incoming.status ?? 'PENDING' });
            }
          });

          return { ...prev, [eventId]: merged };
        });
        lastSyncTimeRef.current = Date.now();
        diagLog('SYNC_OK', { eventId, count: list.length });
        return list.length;
      } else {
        console.warn('[sync] Respuesta sin éxito:', message);
        return 0;
      }
    } catch (error) {
      console.error('[sync] Error:', error);
      throw error;
    }
  }, [setAsistentes]);

  const handleManualSync = useCallback(async () => {
    const now = Date.now();
    if (now - syncButtonCooldownRef.current < SYNC_BUTTON_COOLDOWN_MS) {
      const remaining = Math.ceil((SYNC_BUTTON_COOLDOWN_MS - (now - syncButtonCooldownRef.current)) / 1000);
      alert(`Espera ${remaining}s para sincronizar de nuevo`);
      return;
    }
    if (!eventoSeleccionado?.event_id) return;
    syncButtonCooldownRef.current = now;

    setLoading(true);
    try {
      const count = await runSync(String(eventoSeleccionado.event_id));
      alert(`Sincronizados ${count} asistentes`);
    } catch {
      alert('Error de conexión al sincronizar');
    } finally {
      setLoading(false);
    }
  }, [eventoSeleccionado, runSync, setLoading]);

  // ==========================================
  // 🔄 CAMBIO DE EVENTO
  // ==========================================
  const handleEventoChange = useCallback((selectedEvent) => {
    setEventoSeleccionado(selectedEvent);
    loadAsistentes(selectedEvent.event_id);
    closeOverlay();
  }, [setEventoSeleccionado, loadAsistentes, closeOverlay]);

  // ==========================================
  // 🎯 EFFECTS — unificados y sin conflictos
  // ==========================================

  // Efecto MAESTRO: ciclo de vida del scanner
  // Solo depende del event_id — no de asistentesDelEvento ni de handleScanSuccess
  useEffect(() => {
    if (!eventoSeleccionado?.event_id) {
      safeStopScanner();
      return;
    }

    startScannerCore();

    return () => {
      safeStopScanner();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventoSeleccionado?.event_id]);
  // ☝️ Intencionalmente omitimos startScannerCore/safeStopScanner de deps
  // para que el scanner solo se reinicie cuando CAMBIA el evento, no en cada render.

  // Efecto: sincronización automática cada 5 minutos
  useEffect(() => {
    if (!eventoSeleccionado?.event_id) return;
    const eventId = String(eventoSeleccionado.event_id);

    // Sincronizar al seleccionar evento (con pequeño delay para no bloquear el arranque)
    const initialTimer = setTimeout(() => {
      if (isMounted.current) runSync(eventId).catch(() => {});
    }, 1000);

    const interval = setInterval(() => {
      if (isMounted.current) runSync(eventId).catch(() => {});
    }, SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [eventoSeleccionado?.event_id, runSync]);

  // Efecto: si el filtro "Solo hoy" deja al evento actual fuera de la lista visible,
  // deseleccionamos. Solo actúa cuando eventosMostrados ya tiene datos (evita false-positive
  // durante carga inicial donde la lista puede estar vacía transitoriamente).
  useEffect(() => {
    if (!eventoSeleccionado || eventosMostrados.length === 0) return;

    const sigueVisible = eventosMostrados.some(
      ev => String(ev.event_id) === String(eventoSeleccionado.event_id)
    );
    if (!sigueVisible) {
      console.log('[filtro] Evento seleccionado fuera del filtro actual, reseteando');
      setEventoSeleccionado(null);
      closeOverlay();
    }
  }, [eventosMostrados]); // eslint-disable-line react-hooks/exhaustive-deps
  // ☝️ Solo queremos que corra cuando cambia la LISTA FILTRADA, no en cada render del resto.

  // Efecto: limpieza al desmontar
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (retryTimeoutRef.current)  clearTimeout(retryTimeoutRef.current);
      if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current);
      safeStopScanner().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================
  // 🎨 RENDER OVERLAY
  // ==========================================
  const renderOverlay = () => {
    if (!showOverlay || !validation) return null;

    const configs = {
      valid:         { icon: checkImg,   title: 'TICKET VÁLIDO',               color: '#4CAF50' },
      'ya-validado': { icon: warningImg, title: 'TICKET YA REGISTRADO',        color: '#FFC107' },
      mismatch:      { icon: warningImg, title: 'TICKET NO PERTENECE AL EVENTO', color: '#FF9800' },
      invalid:       { icon: crossImg,  title: 'INVÁLIDO',                     color: '#f44336' },
      error:         { icon: crossImg,  title: 'ERROR',                        color: '#f44336' },
      pending:       { icon: warningImg, title: 'PENDIENTE',                   color: '#FF9800' },
    };

    const cfg = configs[validation.status] || configs.error;

    return (
      <div className="fullscreen-overlay">
        <div className="validation-content">
          <img src={cfg.icon} alt={cfg.title} className="validation-icon" />
          <h2 style={{ color: cfg.color }}>{cfg.title}</h2>
          <p>{validation.mensaje}</p>
          {validation.asistente && (
            <div className="attendee-info">
              <p><strong>Nombre:</strong> {validation.asistente.name}</p>
              <p><strong>Email:</strong>  {validation.asistente.email}</p>
            </div>
          )}
          <p style={{ marginTop: 10, fontSize: 14, color: '#aaa' }}>
            Validados en esta sesión: {scannedCount}
          </p>
          <button
            onClick={closeOverlay}
            style={{
              marginTop: 15, padding: '8px 20px', cursor: 'pointer',
              background: '#333', color: 'white', border: 'none',
              borderRadius: 4, fontWeight: 'bold',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  };

  // ==========================================
  // 🎨 RENDER PRINCIPAL
  // ==========================================
  return (
    <div className="scanner-container">
      <header className="header">
        <div className="logo">TicketFlow QR</div>
      </header>

      <div className="scanner-content">
        {/* Selector de evento */}
        <select
          className="event-selector"
          value={eventoSeleccionado?.event_id || ''}
          onChange={e => {
            const selected = eventos.find(ev => ev.event_id.toString() === e.target.value);
            if (selected) handleEventoChange(selected);
          }}
        >
          <option value="" disabled>Seleccione un evento</option>
          {eventosMostrados.map(evt => (
            <option key={evt.event_id} value={evt.event_id}>
              {evt.event_title} ({evt.event_id})
            </option>
          ))}
        </select>

        {/* Filtro Solo hoy */}
        <div className="filter-controls">
          <label className="switch">
            <input
              type="checkbox"
              checked={mostrarSoloHoy}
              onChange={e => setMostrarSoloHoy(e.target.checked)}
            />
            <span className="slider" />
          </label>
          <span className="switch-label">
            {mostrarSoloHoy ? '📅 Solo hoy' : '📋 Todos los eventos'}
          </span>
        </div>

        {/* Contadores — solo visibles cuando hay evento seleccionado */}
        {eventoSeleccionado && (
          <div className="counters-container">
            <div className="counter-card">
              <span className="counter-label">Total</span>
              <span className="counter-value">{totalCount}</span>
            </div>
            <div className="counter-card">
              <span className="counter-label">✅ Escaneados</span>
              <span className="counter-value" style={{ color: '#4CAF50' }}>{scannedCount}</span>
            </div>
            <div className="counter-card">
              <span className="counter-label">⏳ Pendientes</span>
              <span className="counter-value" style={{ color: '#FF9800' }}>{pendingCount}</span>
            </div>
          </div>
        )}

        {/* Visor QR */}
        <div className="scanner-wrapper" style={{ position: 'relative' }}>
          <div id="qr-reader" ref={qrRef} className="qr-scanner" />

          {/* Mensaje sin asistentes */}
          {eventoSeleccionado && totalCount === 0 && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.7)', color: 'white',
              borderRadius: 12, fontSize: 18, fontWeight: 'bold', zIndex: 10,
            }}>
              No hay asistentes para este evento
            </div>
          )}
        </div>

        {/* Botones */}
        <div className="sync-button-container">
          <button
            className="sync-button"
            onClick={handleManualSync}
            disabled={!eventoSeleccionado}
          >
            🔄 Re-sincronizar asistentes
          </button>

          <button
            className="sync-button"
            onClick={() => contexto.syncBuffer()}
            disabled={!eventoSeleccionado}
            style={{ backgroundColor: '#e6a817' }}
          >
            ✅ Confirmar evento en base de datos
          </button>

          <button
            className="sync-button"
            onClick={() => window.__downloadDiagLogs?.()}
            style={{ backgroundColor: '#666', color: '#fff' }}
          >
            📥 Descargar Logs de Diagnóstico
          </button>
        </div>
      </div>

      {renderOverlay()}
    </div>
  );
}