import react from 'react';
// ==========================================
// 🔧 DUAL MODE: WordPress + Demo
// ==========================================
// Set DEMO_MODE = true para usar datos fake
// Set DEMO_MODE = false (default) para WordPress real

const DEMO_MODE = window.TICKET_FLOW_DEMO === 'true' || (typeof process !== 'undefined' && process.env.DEMO_MODE === 'true');

// Base API configuration
const API_BASE_URL = DEMO_MODE 
  ? '/api/demo' 
  : `${typeof wpApiSettings !== 'undefined' ? wpApiSettings?.root : '/wp-json/'}ticketflow/v1`.replace(/\/$/, '');

let currentNonce = window.ticketflowData?.nonce || '';

// ==========================================
// 📦 MOCK DATA para DEMO MODE
// ==========================================
const MOCK_EVENTS = [
  { id: 'evt_001', nombre: 'Conferencia Tech 2025', fecha: '2025-05-30', estado: 'activo' },
  { id: 'evt_002', nombre: 'Festival Música Santiago', fecha: '2025-06-15', estado: 'activo' }
];

const MOCK_TICKETS = {
  'evt_001': [
    { id: 'tkt_001', ticket_code: 'QR001', nombre: 'Juan Pérez', status: 'PENDING' },
    { id: 'tkt_002', ticket_code: 'QR002', nombre: 'María García', status: 'PENDING' },
    { id: 'tkt_003', ticket_code: 'QR003', nombre: 'Carlos López', status: 'PENDING' }
  ],
  'evt_002': [
    { id: 'tkt_004', ticket_code: 'QR004', nombre: 'Ana Martínez', status: 'PENDING' },
    { id: 'tkt_005', ticket_code: 'QR005', nombre: 'Roberto Sánchez', status: 'PENDING' }
  ]
};

// Almacenamiento en memoria para demo
let demoTicketStore = JSON.parse(JSON.stringify(MOCK_TICKETS));
let demoScanCount = 0;

// Helper para respuestas consistentes
const buildResponse = (success, data = null, message = '') => ({
  success,
  data,
  message,
  timestamp: new Date().toISOString()
});

// ==========================================
// 🎭 DEMO MOCK HANDLER
// ==========================================
const handleDemoRequest = async (endpoint, method = 'GET', body = null) => {
  // Simular latencia de red realista
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log(`[DEMO MODE] ${method} ${endpoint}`, body);

  // Eventos activos
  if (endpoint === '/eventos-activos' && method === 'GET') {
    return buildResponse(true, MOCK_EVENTS, 'Eventos cargados (DEMO)');
  }

  // Sincronizar asistentes
  const syncMatch = endpoint.match(/\/sync-attendees\/(.+)/);
  if (syncMatch && method === 'GET') {
    const eventId = syncMatch[1];
    const attendees = demoTicketStore[eventId] || [];
    return buildResponse(
      true,
      { attendees },
      `Asistentes sincronizados: ${attendees.length} (DEMO)`
    );
  }

  // Validar ticket (escanear QR)
  const scanMatch = endpoint.match(/\/escanear\/(.+?)\/(.+)/);
  if (scanMatch && method === 'GET') {
    const [, eventId, qrCode] = scanMatch;
    const tickets = demoTicketStore[eventId] || [];
    const ticket = tickets.find(t => t.ticket_code === qrCode);

    if (!ticket) {
      return buildResponse(
        false,
        { valid: false, error: 'Ticket no encontrado' },
        'QR inválido (DEMO)'
      );
    }

    if (ticket.status === 'SCANNED') {
      return buildResponse(
        false,
        { valid: false, error: 'Ticket ya escaneado', duplicate: true },
        'Ticket duplicado (DEMO)'
      );
    }

    demoScanCount++;
    ticket.status = 'SCANNED';

    return buildResponse(
      true,
      {
        valid: true,
        id: ticket.id,
        nombre: ticket.nombre,
        ticket_code: ticket.ticket_code,
        status: 'SCANNED'
      },
      `Ticket válido: ${ticket.nombre} (DEMO)`
    );
  }

  // Marcar como escaneado
  const markMatch = endpoint.match(/\/mark-as-scanned\/(.+)/);
  if (markMatch && method === 'POST') {
    const ticketId = markMatch[1];
    // En demo, aceptar siempre
    return buildResponse(true, { id: ticketId }, 'Ticket marcado (DEMO)');
  }

  // Bulk mark scanned
  if (endpoint === '/bulk-mark-scanned' && method === 'POST') {
    const { ids = [] } = body || {};
    return buildResponse(
      true,
      { updated: ids.length },
      `${ids.length} tickets actualizados (DEMO)`
    );
  }

  // Fallback
  return buildResponse(false, null, 'Endpoint no encontrado en DEMO mode');
};

/**
 * Secure fetch wrapper mejorado (dual mode)
 */
export const secureFetch = async (endpoint, method = 'GET', body = null) => {
  // Si estamos en DEMO mode, usar mock
  if (DEMO_MODE) {
    return handleDemoRequest(endpoint, method, body);
  }

  // Modo WordPress real
  const headers = {
    'Content-Type': 'application/json',
    'X-WP-Nonce': currentNonce,
  };

  const config = {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : null
  };

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    
    // Manejo de nonce expirado
    if (response.status === 403) {
      const nonceResponse = await fetch(`${API_BASE_URL}/get-nonce`);
      const { nonce } = await nonceResponse.json();
      currentNonce = nonce;
      headers['X-WP-Nonce'] = nonce;
      const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, config);
      const retryData = await retryResponse.json();
      return buildResponse(true, retryData);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Error ${response.status}`);
    }

    const data = await response.json();
    return buildResponse(true, data);
  } catch (error) {
    console.error('API Error:', error);
    return buildResponse(false, null, error.message);
  }
};

// ==========================================
// 📊 HELPER: Status actual del sistema
// ==========================================
window.__getTicketFlowStatus = () => {
  return {
    mode: DEMO_MODE ? '🎭 DEMO' : '🔗 WORDPRESS',
    scanCount: demoScanCount,
    events: MOCK_EVENTS.length,
    timestamp: new Date().toISOString()
  };
};

console.log(
  `%c✨ Ticket Flow iniciado en modo ${DEMO_MODE ? '🎭 DEMO' : '🔗 WORDPRESS'}`,
  'color: #4CAF50; font-weight: bold'
);

/**
 * Implementación mejorada del ScannerAPI
 */
export const ScannerAPI = {
  // Obtener eventos activos
  getActiveEvents: async () => {
    const response = await secureFetch('/eventos-activos');
    if (!response.success) return response;
    
    return buildResponse(
      true,
      Array.isArray(response.data) ? response.data : [],
      'Eventos cargados'
    );
  },
  
  // Sincronizar asistentes (FIXED)
  syncAttendees: async (eventId) => {
    const response = await secureFetch(`/sync-attendees/${eventId}`);
    if (!response.success) return response;

    // Normalizar datos
    const attendees = Array.isArray(response.data?.attendees) 
      ? response.data.attendees.map(item => ({
          id: item.id || '',
          ticket_code: item.ticket_code || item.qr_code || '',
          nombre: item.nombre || item.name || 'Invitado',
          status: item.scan_status === 'scanned' ? 'SCANNED' : 'PENDING' // Asegurar mayúsculas
        }))
      : [];

    return buildResponse(
      true,
      attendees,
      `Asistentes sincronizados: ${attendees.length}`
    );
  },
  
  // Verificar ticket
  checkTicketStatus: async (eventId, qrCode) => {
    const response = await secureFetch(`/escanear/${eventId}/${qrCode}`);
    if (!response.success) return response;
    
    return buildResponse(
      true,
      {
        valid: !!response.data?.valid,
        ...response.data
      },
      response.data?.message || 'Estado del ticket verificado'
    );
  },
  
  // Marcar como escaneado
  markAsScanned: async (ticketId) => {
    const response = await secureFetch(`/mark-as-scanned/${ticketId}`, 'POST');
    return buildResponse(
      response.success,
      response.data,
      response.success ? 'Ticket marcado' : 'Error al marcar ticket'
    );
  },
  
  // Marcado múltiple (batch)
  markMultipleAsScanned: async (ticketIds = []) => {
    if (!Array.isArray(ticketIds)) {  // Fixed parentheses
      return buildResponse(false, null, 'IDs deben ser un array');
    }
    
    const response = await secureFetch(
      '/bulk-mark-scanned', 
      'POST', 
      { ids: ticketIds }
    );
    
    return buildResponse(
      response.success,
      response.data,
      response.success 
        ? `${ticketIds.length} tickets actualizados` 
        : 'Error en actualización múltiple'
    );
  }
};