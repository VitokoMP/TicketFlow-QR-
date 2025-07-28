import React from 'react';
import { useEvento } from '../context/EventoContext';

export default function EventoInfo() {
  const {
    eventoSeleccionado: evento,
    isEventoDisponible,
    asistentes,
    loading,
    error
  } = useEvento();

  if (loading) return <p className="text-white">Cargando evento...</p>;
  if (error) return <p className="text-red-500">Error: {error}</p>;
  if (!evento) return <p className="text-gray-400">No hay evento disponible</p>;

  return (
    <div className="bg-yellow-100 p-4 rounded-lg shadow text-black w-full max-w-lg">
      <h2 className="text-xl font-bold mb-2">🎫 Evento activo</h2>
      <p><strong>Título:</strong> {evento.event_title}</p>
      <p><strong>Inicio:</strong> {evento.event_start_date}</p>
      <p><strong>Lugar:</strong> {evento.event_location || 'No informado'}</p>
      <p>
        <strong>Estado:</strong>{' '}
        <span className={isEventoDisponible ? 'text-green-600' : 'text-red-600'}>
          {isEventoDisponible ? 'Disponible' : 'No disponible'}
        </span>
      </p>

      {isEventoDisponible && asistentes.length > 0 && (
        <div className="mt-4 p-3 border-t border-gray-300">
          <p className="text-green-700 font-semibold">
            ✅ Listo para escanear entradas ({asistentes.length} asistentes cargados)
          </p>
          {/* Aquí puedes insertar el componente del escáner QR */}
          <button
            onClick={() => alert('Escáner activado (aquí va tu componente QR)')}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Activar escáner
          </button>
        </div>
      )}

      {!isEventoDisponible && (
        <p className="text-sm text-gray-600 mt-2">Espera a que se cargue un evento válido.</p>
      )}
    </div>
  );
}
