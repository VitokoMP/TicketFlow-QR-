export const fetchSessions = async () => {
    const response = await fetch(
        `${window.ticketflowApi.apiUrl}/sessions`,
        {
            headers: {
                'X-WP-Nonce': window.ticketflowApi.nonce
            }
        }
    );
    
    if (!response.ok) {
        throw new Error('Error al cargar sesiones');
    }
    
    return await response.json();
};