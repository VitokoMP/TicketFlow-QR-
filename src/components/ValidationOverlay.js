import React from 'react';

export default function ValidationOverlay({ status, asistente, onValidate, onClose }) {
  const config = getConfig(status);

  return (
    <div className="validation-overlay">
      <div className="validation-content" style={{ borderColor: config.color }}>
        <div className="validation-icon" aria-hidden>{config.icon}</div>
        <h2>{config.title}</h2>

        {asistente && (
          <div className="asistente-info">
            <p><strong>Nombre:</strong> {asistente.name || asistente.full_name || '-'}</p>
            <p><strong>Ticket:</strong> {asistente.ticket_type || asistente.ticket_name || '-'}</p>
            <p><strong>Código:</strong> {asistente.ticket_code || asistente.code || '-'}</p>
            {asistente.status && <p><strong>Estado:</strong> {asistente.status}</p>}
          </div>
        )}

        <p className="validation-message">{config.message}</p>

        {status === 'pending' && asistente ? (
          <button className="validate-button" onClick={onValidate}>
            CONFIRMAR VALIDACIÓN
          </button>
        ) : (
          <button className="close-button" onClick={onClose}>
            CONTINUAR ESCANEO
          </button>
        )}
      </div>
    </div>
  );
}

function getConfig(status) {
  switch (status) {
    case 'valid':
      return { icon: '✅', title: 'ENTRADA VÁLIDA', color: '#22c55e', message: 'Ticket validado correctamente.' };
    case 'already_used':
      return { icon: '⚠️', title: 'YA USADO', color: '#f59e0b', message: 'Este ticket ya fue escaneado antes.' };
    case 'invalid':
      return { icon: '❌', title: 'INVÁLIDO', color: '#ef4444', message: 'El ticket no es válido para este evento.' };
    case 'checking':
      return { icon: '🔎', title: 'VERIFICANDO', color: '#3b82f6', message: 'Buscando en caché/sincronizando…' };
    case 'pending':
    default:
      return { icon: '🪪', title: 'ENCONTRADO', color: '#6366f1', message: 'Revisa los datos y confirma la validación.' };
  }
}
