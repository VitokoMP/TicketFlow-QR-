// src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';

export const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const checkSession = async () => {
        try {
            const response = await fetch('/wp-json/ticketflow/v1/heartbeat', {
                method: 'POST',
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'active') {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    };

    useEffect(() => {
        const verifySession = async () => {
            const isValid = await checkSession();
            if (!isValid) {
                window.location.href = '/wp-login.php';
            }
            setLoading(false);
        };

        verifySession();
        const interval = setInterval(verifySession, 300000); // 5 minutos

        return () => clearInterval(interval);
    }, []);

    return (
        <AuthContext.Provider value={{ user, setUser, loading }}>
            {children}
        </AuthContext.Provider>
    );
}