import React, { createContext, useContext, useEffect, useState } from 'react';

const HeartBeatContext = createContext();

export function HBProvider({ children }) {
  const [hbData, setHeartBeatData] = useState(window.ticketflowWP || {});
  const [heartbeat, setHeartbeat] = useState(null);

  // Mantener sesión activa
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${hbData.api?.ajaxUrl}?action=ticketflow_heartbeat`, {
        credentials: 'include',
      });
    }, 5 * 60 * 1000); // Ping cada 5 minutos

    setHeartbeat(interval);
    return () => clearInterval(interval);
  }, [hbData.api]);

  return (
    <HeartBeatContext.Provider value={{ ...hbData, heartbeat }}>
      {children}
    </HeartBeatContext.Provider>
  );
}

export function useHB() {
  return useContext(HeartBeatContext);
}