import React from 'react';
import { useEvento } from '../context/EventoContext';

export default function EventoInfo() {
  const { evento, isEventoDisponible, loading, error, asistentes, fetchAsistentes } = useEvento();

  // Función para manejar el click en el botón
  const handleConfirmarEvento = () => {
    if (evento && evento.event_id) {
      fetchAsistentes(evento.event_id); // Llamada para traer los asistentes del evento
    }
  };

  if (loading) return <p className="text-white">Cargando evento...</p>;
  if (error) return <p className="text-red-500">Error: {error}</p>;
  if (!evento) return <p className="text-gray-400">No hay evento disponible</p>;

  return (
    <div className="bg-yellow-100 p-4 rounded-lg shadow text-black w-full max-w-lg">
      <h2 className="text-xl font-bold mb-2">🎫 Evento activo</h2>
      <p><strong>Título:</strong> {evento.nombre}</p>
      <p><strong>Inicio:</strong> {evento.fecha}</p>
      <p><strong>Lugar:</strong> {evento.lugar}</p>
      <p>
        <strong>Estado:</strong>{' '}
        <span className={isEventoDisponible ? 'text-green-600' : 'text-red-600'}>
          {isEventoDisponible ? 'Disponible' : 'No disponible'}
        </span>
      </p>

      {isEventoDisponible && (
        <div className="mt-4">
          <button
            onClick={handleConfirmarEvento}
            className="bg-blue-500 text-white py-2 px-4 rounded-lg"
          >
            Confirmar Evento y Cargar Asistentes
          </button>
        </div>
      )}

      <h3 className="text-lg font-semibold mt-4">Asistentes:</h3>
      {asistentes.length > 0 ? (
        <ul>
          {asistentes.map((asistente, index) => (
            <li key={index}>{asistente.nombre || "Nombre no disponible"}</li>
          ))}
        </ul>
      ) : (
        <p>No hay asistentes registrados.</p>
      )}
    </div>
  );
}
