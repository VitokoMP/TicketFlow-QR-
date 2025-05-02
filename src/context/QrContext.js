import React, { createContext, useContext, useState } from "react";

const QRContext = createContext();

export const QRProvider = ({ children }) => {
  const [scannedCode, setScannedCode] = useState(null);

  return (
    <QRContext.Provider value={{ scannedCode, setScannedCode }}>
      {children}
    </QRContext.Provider>
  );
};

export const useQR = () => useContext(QRContext);
