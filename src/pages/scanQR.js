import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useEvento } from "../context/EventoContext";
import checkImg from '../public/img/check.png';
import crossImg from '../public/img/cross.png';
import warningImg from '../public/img/cross.png'; // Corregí la ruta duplicada
import '../public/css/ScanQR.css';

// Tiempos en milisegundos para mejor control
const SCAN_DELAY = 3000;
const DEBOUNCE_TIME = 500;

export default function ScanQR() {
    const {
        eventos = [],
        asistentes = {},
        setAsistentes,
        fetchEventos,
        eventoSeleccionado,
        setLoading,
        selectEvento,
    } = useEvento();

    const [scanState, setScanState] = useState({
        cameraActive: false,
        validation: null,
        showOverlay: false,
        lastScanned: ""
    });

    const qrRef = useRef(null);
    const qrScanner = useRef(null);
    const timeoutRef = useRef(null);

    // Memoized para mejor performance
    const asistentesEvento = useMemo(() => {
        if (!eventoSeleccionado?.event_id) return [];
        return asistentes[eventoSeleccionado.event_id] || [];
    }, [asistentes, eventoSeleccionado]);

    // Efectos de limpieza
    useEffect(() => {
        fetchEventos();
        
        return () => {
            stopScanner();
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [fetchEventos]);

    // Efecto para manejar cámara basado en eventos/asistentes
    useEffect(() => {
        if (!eventoSeleccionado?.event_id) return;

        if (asistentesEvento.length > 0 && !scanState.cameraActive) {
            startScanner();
        } else if (asistentesEvento.length === 0 && scanState.cameraActive) {
            stopScanner();
        }
    }, [asistentesEvento, eventoSeleccionado, scanState.cameraActive]);

    // Scanner functions
    const startScanner = useCallback(async () => {
        if (!qrRef.current) return;

        try {
            if (qrScanner.current?.isScanning) {
                await qrScanner.current.stop();
            }

            const config = {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                rememberLastUsedCamera: true
            };

            qrScanner.current = new Html5Qrcode(qrRef.current.id);
            
            await qrScanner.current.start(
                { facingMode: "environment" },
                config,
                handleScanSuccess,
                handleScanError
            );

            setScanState(prev => ({ ...prev, cameraActive: true }));
        } catch (err) {
            console.error("Camera error:", err);
            setScanState(prev => ({
                ...prev,
                validation: {
                    status: "error",
                    mensaje: "Error al iniciar cámara. Verifica permisos y conexión."
                }
            }));
        }
    }, []);

    const stopScanner = useCallback(async () => {
        if (qrScanner.current?.isScanning) {
            try {
                await qrScanner.current.stop();
                qrScanner.current.clear();
            } catch (err) {
                console.error("Error stopping scanner:", err);
            }
        }
        setScanState(prev => ({ ...prev, cameraActive: false }));
    }, []);

    // API handlers
    const handleSync = useCallback(async (eventId) => {
        setLoading(true);
        try {
            const response = await fetch(`/wp-json/ticketflow/v1/sync-attendees/${eventId}`);
            const data = await response.json();
            
            if (data.success) {
                setAsistentes(prev => ({
                    ...prev,
                    [eventId]: data.attendees || [],
                }));
            }
        } catch (error) {
            console.error("Sync error:", error);
            setScanState(prev => ({
                ...prev,
                validation: {
                    status: "error",
                    mensaje: "Error al sincronizar asistentes"
                }
            }));
        }
        setLoading(false);
    }, [setAsistentes, setLoading]);

    const validarYMarcarAsistente = useCallback(async (eventId, qrCode) => {
        try {
            // Verificar estado primero
            const estadoRes = await fetch(`/wp-json/ticketflow/v1/escanear/${eventId}/${qrCode}`);
            const estadoData = await estadoRes.json();

            // Manejar diferentes estados
            if (!estadoData.success) {
                return { 
                    status: estadoData.status || "error",
                    mensaje: estadoData.mensaje || "Ticket inválido",
                    asistente: estadoData.asistente 
                };
            }

            // Marcar como escaneado si es válido
            const markRes = await fetch(`/wp-json/ticketflow/v1/mark-as-scanned/${estadoData.asistente.id}`, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': wpApiSettings.nonce // Asegurar seguridad
                }
            });

            const markData = await markRes.json();
            
            if (markData.success) {
                // Actualizar estado global optimizado
                setAsistentes(prev => {
                    const newState = { ...prev };
                    const eventKey = String(eventId);
                    
                    if (newState[eventKey]) {
                        newState[eventKey] = newState[eventKey].map(a => 
                            String(a.id) === String(markData.asistente.id) 
                                ? markData.asistente 
                                : a
                        );
                    }
                    
                    return newState;
                });

                return {
                    status: "valid",
                    mensaje: "¡Ticket válido!",
                    asistente: markData.asistente,
                };
            }
            
            return {
                status: "error",
                mensaje: markData.mensaje || "Error al registrar asistencia",
            };
        } catch (error) {
            console.error("Validation error:", error);
            return { 
                status: "error", 
                mensaje: "Error de conexión" 
            };
        }
    }, [setAsistentes]);

    // Scan handlers
    const handleScanSuccess = useCallback(async (decodedText) => {
        if (!eventoSeleccionado || scanState.showOverlay) return;

        const qrCode = decodedText.trim().split("/").pop().toLowerCase();
        
        // Debounce para evitar escaneos duplicados
        if (qrCode === scanState.lastScanned) return;
        
        setScanState(prev => ({ ...prev, lastScanned: qrCode }));
        await qrScanner.current?.pause();

        const resultado = await validarYMarcarAsistente(eventoSeleccionado.event_id, qrCode);
        
        setScanState(prev => ({
            ...prev,
            validation: resultado,
            showOverlay: true
        }));

        // Reset después de delay
        timeoutRef.current = setTimeout(() => {
            setScanState(prev => ({
                ...prev,
                showOverlay: false,
                validation: null
            }));
            qrScanner.current?.resume();
        }, SCAN_DELAY);
    }, [eventoSeleccionado, validarYMarcarAsistente, scanState.lastScanned, scanState.showOverlay]);

    const handleScanError = useCallback((error) => {
        console.warn("Scan error:", error);
        // Podrías mostrar feedback al usuario si hay muchos errores
    }, []);

    // Render helpers
    const renderValidationOverlay = useCallback(() => {
        if (!scanState.showOverlay || !scanState.validation) return null;

        const { status, mensaje, asistente } = scanState.validation;
        const validationConfig = {
            "valid": { icon: checkImg, title: "TICKET VÁLIDO", color: "#4CAF50" },
            "error": { icon: crossImg, title: "ERROR", color: "#f44336" },
            "mismatch": { icon: warningImg, title: "EVENTO INCORRECTO", color: "#FF9800" },
            "ya-validado": { icon: warningImg, title: "YA REGISTRADO", color: "#FFC107" }
        };

        const config = validationConfig[status] || validationConfig.error;

        return (
            <div className="fullscreen-overlay">
                <div className="validation-content">
                    <img src={config.icon} alt={config.title} className="validation-icon" />
                    <h2 style={{ color: config.color }}>{config.title}</h2>
                    <p>{mensaje}</p>
                    
                    {asistente && (
                        <div className="attendee-info">
                            <p><strong>Nombre:</strong> {asistente.name || "N/A"}</p>
                            {status === "mismatch" && asistente.event_title && (
                                <p><strong>Evento:</strong> {asistente.event_title}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }, [scanState.showOverlay, scanState.validation]);

    return (
        <div className="scanner-container">
            <h1 className="scanner-title">Escáner QR TicketFlow</h1>

            <div className="event-selector-container">
                <select
                    value={eventoSeleccionado?.event_id || ""}
                    onChange={(e) => {
                        const selected = eventos.find(ev => ev.event_id.toString() === e.target.value);
                        if (selected) {
                            setScanState({
                                cameraActive: false,
                                validation: null,
                                showOverlay: false,
                                lastScanned: ""
                            });
                            selectEvento(selected);
                        }
                    }}
                    className="event-selector"
                >
                    <option value="">Selecciona un evento</option>
                    {eventos.map(ev => (
                        <option key={ev.event_id} value={ev.event_id.toString()}>
                            {ev.event_title} ({new Date(ev.event_start_date).toLocaleDateString()})
                        </option>
                    ))}
                </select>
            </div>

            {eventoSeleccionado && (
                <div className="scanner-wrapper">
                    <div id="qr-reader" ref={qrRef} className="qr-scanner" />
                    {scanState.cameraActive && !scanState.showOverlay && (
                        <div className="scanner-overlay">
                            <div className="scan-frame" />
                            <p className="scan-instructions">Escanea el código QR del ticket</p>
                        </div>
                    )}
                </div>
            )}

            {eventoSeleccionado && asistentesEvento.length === 0 && (
                <button 
                    onClick={() => handleSync(eventoSeleccionado.event_id)}
                    className="sync-button"
                    disabled={scanState.showOverlay}
                >
                    Sincronizar Asistentes
                </button>
            )}

            {renderValidationOverlay()}
        </div>
    );
}