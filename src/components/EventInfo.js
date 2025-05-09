import React from 'react';
import { useEvento } from '../context/EventoContext';

export default function EventoInfo() {
  const { evento, isEventoDisponible, loading, error } = useEvento();

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
    </div>
  );
}
