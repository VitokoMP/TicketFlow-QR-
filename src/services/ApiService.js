// Base API configuration
const API_BASE_URL = '/wp-json/ticketflow/v1';
let currentNonce = window.ticketflowData?.nonce || '';

/**
 * Secure fetch wrapper with nonce handling
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
        
        // Handle expired nonce
        if (response.status === 403) {
            const nonceResponse = await fetch(`${API_BASE_URL}/get-nonce`);
            const { nonce } = await nonceResponse.json();
            currentNonce = nonce;
            
            // Retry with new nonce
            headers['X-WP-Nonce'] = nonce;
            const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, config);
            return await retryResponse.json();
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

/**
 * Specific API calls for the scanner
 */
export const ScannerAPI = {
    getActiveEvents: () => secureFetch('/eventos-activos'),
    
    syncAttendees: (eventId) => secureFetch(`/sync-attendees/${eventId}`),
    
    checkTicketStatus: (eventId, qrCode) => 
        secureFetch(`/escanear/${eventId}/${qrCode}`),
    
    markAsScanned: (ticketId) => 
        secureFetch(`/mark-as-scanned/${ticketId}`, 'POST'),
    
     // NUEVO: marcar múltiples tickets en batch
    markMultipleAsScanned: (ticketIds = []) =>
        secureFetch('/bulk-mark-scanned', 'POST', { ids: ticketIds })
};