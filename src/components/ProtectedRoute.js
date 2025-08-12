// src/components/ProtectedRoute.js
import { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

export function ProtectedRoute({ children }) {
    const { user, loading } = useContext(AuthContext);

    if (loading) return <div>Verificando sesión...</div>;
    if (!user) return <Navigate to="/wp-login.php" replace />;

    return children;
}