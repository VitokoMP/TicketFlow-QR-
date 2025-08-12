// src/pages/Login.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  const handleLogin = () => {
    // Aquí iría la lógica de autenticación real
    navigate("/menu");
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black text-white p-4">
      <h2 className="text-yellow-400 text-2xl mb-6 font-bold">Iniciar Sesión</h2>
      <input
        type="text"
        placeholder="Usuario"
        className="mb-3 p-2 w-64 rounded bg-gray-800 text-white border border-yellow-400"
      />
      <input
        type="password"
        placeholder="Contraseña"
        className="mb-5 p-2 w-64 rounded bg-gray-800 text-white border border-yellow-400"
      />
      <button
        onClick={handleLogin}
        className="bg-yellow-400 text-black px-6 py-2 rounded font-semibold hover:bg-yellow-300"
      >
        Entrar
      </button>
    </div>
  );
}
