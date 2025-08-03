import React, { useEffect, useState } from 'react';
import { fetchSessions } from '../api';

export default function Sessions() {
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSessions()
            .then(data => {
                setSessions(data);
                setLoading(false);
            })
            .catch(error => {
                console.error('Error:', error);
                setLoading(false);
            });
    }, []);

    return (
        <div className="ticketflow-sessions">
            {loading ? (
                <p>Cargando sesiones...</p>
            ) : (
                <ul>
                    {sessions.map(session => (
                        <li key={session.id}>
                            <h3>{session.title}</h3>
                            <p>{session.date}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}