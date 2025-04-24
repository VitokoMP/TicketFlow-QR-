// src/pages/Splash.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function Splash() {
  const navigate = useNavigate();

  React.useEffect(() => {
    setTimeout(() => navigate("/login"), 2000);
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-black text-yellow-400">
      <h1 className="text-4xl font-bold animate-pulse">TicketFlow</h1>
    </div>
  );
}