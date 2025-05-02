import React, { useState } from 'react';
import './Base.css'; // Importa el archivo de estilos
//import QuoteList from './QuoteList';
//import AddQuote from './components/AddQuote';
import ScanQR from '../pages/scanQR';

const Base = () => {

    return (
        <div>
                <ScanQR></ScanQR>
        </div>
    );
}

export default Base;
