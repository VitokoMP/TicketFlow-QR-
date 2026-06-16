# Análisis de Persistencia de Sesión - TicketFlow QR

## 🔴 PROBLEMA IDENTIFICADO

**La pantalla resetea el conteo de tickets cuando la pestaña está en suspensión**

### Causa Raíz

En `src/context/EventoContext.js` línea 43:
```javascript
localStorage.removeItem('ticketflow_asistentes');
```

Este comando **borra el localStorage de asistentes cada vez que el EventoProvider se monta**, lo que ocurre:
- Al recargar la página
- Cuando el navegador reactiva la pestaña después de suspensión
- Cuando React remonta el componente por cambios en la estructura

---

## 📊 Variables de Estado y Persistencia

### 1. **React State (Volátil - Se pierde al recargar)**
Ubicación: `src/context/EventoContext.js`

```javascript
// Línea 17-22
const [eventos, setEventos] = useState([]);
const [eventoSeleccionado, setEventoSeleccionado] = useState(null);
const [asistentes, setAsistentes] = useState({});  // ⚠️ EL ESTADO DEL CONTEO
const [loading, setLoading] = useState(false);
const [isOnline, setIsOnline] = useState(navigator.onLine);
const [asistentesCargados, setAsistentesCargados] = useState(false);
```

**Problema**: Estos estados se pierden al recargar o cuando el navegador reactiva la pestaña.

### 2. **LocalStorage (Persistente - Pero se borra manualmente)**
Ubicación: `src/context/EventoContext.js`

```javascript
// Línea 43 - ❌ BORRA EL CACHÉ AL MONTAR
localStorage.removeItem('ticketflow_asistentes');

// Línea 44-45 - Carga del buffer de escaneos pendientes
const savedBuffer = localStorage.getItem('ticketflow_pending_scans');
if (savedBuffer) syncBufferRef.current = JSON.parse(savedBuffer);

// Línea 65 - Intenta guardar (pero se borra en línea 43)
useEffect(() => {
  localStorage.setItem('ticketflow_asistentes', JSON.stringify(asistentes));
}, [asistentes]);

// Línea 69 - Guarda escaneos pendientes
useEffect(() => {
  localStorage.setItem('ticketflow_pending_scans', JSON.stringify(syncBufferRef.current));
}, [syncBufferRef.current.length]);
```

**Problema**: 
- Se intenta guardar en localStorage (línea 65)
- Pero se borra inmediatamente al montar (línea 43)
- El conteo nunca se persiste entre sesiones

### 3. **SyncBuffer (Ref - Temporal)**
Ubicación: `src/context/EventoContext.js` línea 24-25

```javascript
const syncBufferRef = useRef([]);
const syncTimerRef = useRef(null);
```

**Propósito**: Almacenar escaneos pendientes localmente para sincronizar cuando hay conexión.

---

## 🔄 Flujo Completo de Carga de Datos

### Al Montar EventoProvider:
```
1. (Línea 43) ❌ localStorage.removeItem('ticketflow_asistentes')  ← PROBLEMA
2. (Línea 44-45) Cargar pendingScans desde localStorage
3. (Línea 269) Llamar API: getActiveEvents()
4. (Línea 292) Llamar API: loadAsistentes(eventId)
5. (Línea 297) setEventoSeleccionado({...todayEvent, asistentes})
6. (Línea 65) Guardar asistentes en localStorage
```

### Cuando la Pestaña se Reactiva (After Suspend):
```
1. El navegador reactiva el componente
2. EventoProvider se remonta (potencialmente)
3. ❌ localStorage se borra (línea 43) → PÉRDIDA DE DATOS
4. Se intenta recargar desde API
5. Si hay latencia de red, el usuario ve estado vacío
```

---

## 📍 Ubicaciones Clave en el Código

### 1. **EventoContext.js - Inicialización (Líneas 42-66)**
```javascript
useEffect(() => {
  localStorage.removeItem('ticketflow_asistentes');  // ❌ LÍNEA 43
  const savedBuffer = localStorage.getItem('ticketflow_pending_scans');
  
  // ... listeners de online/offline ...
  
  localStorage.setItem('ticketflow_asistentes', JSON.stringify(asistentes));  // Línea 65
}, []);
```

### 2. **scanQR1.js - Consumo del Estado (Línea 22-38)**
```javascript
const {
  eventos = [],
  asistentes = {},  // ← Estado del conteo se consume aquí
  eventoSeleccionado,
  validarTicket,
  // ...
} = useEvento();
```

### 3. **scanQR1.js - Sincronización Automática (Línea 591-701)**
```javascript
const handleVisibilityChange = () => {
  console.log('[handleVisibilityChange] Cambio de visibilidad:', document.visibilityState);
  if (document.visibilityState === 'visible') {
    syncAutomatically();  // ← Se intenta resincronizar pero `asistentes` ya se borraron
  }
};

// Se ejecuta cada 5 minutos
const interval = setInterval(syncAutomatically, 300000);
```

---

## 🎯 Qué se Pierde con el Reseteo

1. **Contador de Tickets Escaneados**
   - Los tickets marcados como `SCANNED` vuelven a `PENDING`
   - El usuario ve como si nunca los hubiera escaneado

2. **Estado Local de Asistentes**
   - El objeto `asistentes[eventId]` se resetea
   - Los cambios de estado locales se pierden

3. **Evento Seleccionado**
   - `eventoSeleccionado` se resetea a `null`

---

## 💡 Solución Recomendada

### Opción 1: NO Borrar localStorage (Recomendado)
Comentar línea 43 y permitir que se restaure desde localStorage:

```javascript
// Línea 43 - CAMBIAR ESTO:
// localStorage.removeItem('ticketflow_asistentes');  // ← COMENTAR ESTA LÍNEA

const savedAsistentes = localStorage.getItem('ticketflow_asistentes');
if (savedAsistentes) {
  setAsistentes(JSON.parse(savedAsistentes));
}
```

### Opción 2: Validar antes de Borrar
Solo borrar si pasó cierto tiempo o si es sesión nueva:

```javascript
const lastClean = localStorage.getItem('ticketflow_last_clean');
const now = Date.now();
if (!lastClean || now - parseInt(lastClean) > 3600000) {  // 1 hora
  localStorage.removeItem('ticketflow_asistentes');
  localStorage.setItem('ticketflow_last_clean', now.toString());
}
```

---

## 📋 Variables a Monitorear

### En la Consola del Navegador:
```javascript
// Ver estado actual
window.__getTicketFlowStatus?.()

// Ver localStorage
localStorage.getItem('ticketflow_asistentes')
localStorage.getItem('ticketflow_pending_scans')

// Ver contexto (si está expuesto)
console.log('[EventoContext] asistentes:', asistentes);
console.log('[EventoContext] eventoSeleccionado:', eventoSeleccionado);
```

### Logs a Buscar:
```
🔍 [DEBUG] Estado global asistentes actualizado:  (línea 32)
🔍 [DEBUG] eventoSeleccionado actualizado:  (línea 36)
[Buffer] Agregado. Total:  (línea 160)
```

---

## 🔧 Verificación Paso a Paso

1. **Abre DevTools** → Console tab
2. **Ejecuta**: `localStorage.getItem('ticketflow_asistentes')`
3. **Espera 5 segundos** → Ejecuta de nuevo
4. **Resultado esperado**: Debe mostrar los mismos datos (o null si nunca se guardó)
5. **Resultado actual**: ❌ Probablemente null (porque se borra en línea 43)

---

## 📌 Resumen

| Aspecto | Estado Actual | Problema |
|--------|----------------|----------|
| Persistencia de estado | localStorage + React state | localStorage se borra cada mount |
| Contador de tickets | Se guarda pero se borra | Usuario ve reset al suspender pestaña |
| Sincronización | Cada 5 minutos + visibilitychange | Intenta pero estado base está vacío |
| Buffer de escaneos | localStorage + Ref | Se mantiene pero sin datos principales |
