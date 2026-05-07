// Base API configuration
const API_BASE_URL = '/wordpress/wp-json/ticketflow/v1';
let currentNonce = window.ticketflowData?.nonce || '';

// Helper para respuestas consistentes
const buildResponse = (success, data = null, message = '') => ({
  success,
  data,
  message,
  timestamp: new Date().toISOString()
});

/**
 * Secure fetch wrapper mejorado
 */
export const secureFetch = async (endpoint, method = 'GET', body = null) => {
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