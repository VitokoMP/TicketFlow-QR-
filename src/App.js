import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Base from './components/Base'; // Verifica la ruta y el nombre del componente
import NavBar from './components/NavBar'; // Verifica la ruta y el nombre del componente
import Footer from './components/Footer'; // Verifica la ruta y el nombre del componente
import EventoInfo from './components/EventInfo';
import { ProtectedRoute } from './components/ProtectedRoute';


const App = () => (
    <>
    <NavBar />
    <br></br>
    
    <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={
        <ProtectedRoute>
            <Base />
        </ProtectedRoute>
    }/>
    <Route path="/EventInfo" element={<EventoInfo />} />
    <Route path="*" element={<p>There's nothing here: 404!</p>} />
    </Routes>

    <br></br>
    <Footer />
</>
);

export default App;

