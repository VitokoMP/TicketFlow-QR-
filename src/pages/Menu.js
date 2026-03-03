


// src/pages/Menu.jsx
import React from "react";

export default function Menu() {
  return (
    <div className="h-screen bg-black text-white p-6">
      <h1 className="text-3xl text-yellow-400 font-bold mb-6">Menú Principal</h1>
      <div className="grid gap-4">
        <button className="w-full py-3 bg-yellow-400 text-black rounded-lg font-semibold">
          Escanear Entradas
        </button>
        <button className="w-full py-3 bg-gray-800 text-yellow-400 border border-yellow-400 rounded-lg">
          Ver Tickets Offline
        </button>
        <button className="w-full py-3 bg-gray-800 text-yellow-400 border border-yellow-400 rounded-lg">
          Sincronizar Datos
        </button>
      </div>
    </div>
  );
}

