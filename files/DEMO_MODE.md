# 🎭 Ticket Flow QR - DEMO MODE

## ¿Qué es DEMO_MODE?

Sistema dual que permite que Ticket Flow funcione **sin WordPress** usando datos fake.

Perfecto para:
- ✅ Demostración a clientes
- ✅ Testing
- ✅ Deploy a Netlify
- ✅ Desarrollo offline

---

## 🚀 Cómo Activar DEMO_MODE

### Opción 1: URL Query Parameter (Recomendado para demos)
```
https://tu-demo.netlify.app/?demo=true
```

### Opción 2: LocalStorage (Persistente)
Abre la consola y ejecuta:
```javascript
localStorage.setItem('TICKET_FLOW_DEMO', 'true');
location.reload();
```

Para desactivar:
```javascript
localStorage.removeItem('TICKET_FLOW_DEMO');
location.reload();
```

### Opción 3: Variable de Entorno (Build)
```bash
DEMO_MODE=true npm run build
```

---

## 🔍 Verificar Estado

Abre la consola y ejecuta:
```javascript
__getTicketFlowStatus()
```

Output esperado:
```json
{
  "mode": "🎭 DEMO",
  "scanCount": 15,
  "events": 2,
  "timestamp": "2025-05-27T10:30:00.000Z"
}
```

---

## 📊 Datos DEMO Incluidos

### Eventos
- **evt_001**: Conferencia Tech 2025
- **evt_002**: Festival Música Santiago

### Tickets (por evento)
Cada evento tiene 2-3 tickets de prueba con códigos QR:
- `QR001`, `QR002`, `QR003` (evento 1)
- `QR004`, `QR005` (evento 2)

### Simular Scan de QR
1. Selecciona un evento
2. Escanea (o ingresa manualmente) uno de los QR codes listados arriba
3. Verás validación inmediata: ✅ o ❌

---

## 🔄 Cómo funciona arquitecturamente

```
React App (componentes sin cambios)
    ↓
ApiService (DUAL MODE)
    ↓
¿DEMO_MODE activo?
    ├─ SÍ  → Mock responses (datos fake en memoria)
    └─ NO  → WordPress API real (/wp-json/ticketflow/v1)
```

**Importante**: Los componentes React no cambian. Solo la capa de API.

---

## 🎥 Para Grabar Video Demo

1. Abre: `https://tu-demo.netlify.app/?demo=true`
2. Consola mostrará: `✨ Ticket Flow iniciado en modo 🎭 DEMO`
3. Usa OBS o similar para grabar:
   - Scanner scanning QR codes
   - Contador actualizándose
   - Dashboard mostrando validaciones

---

## ⚙️ Para Deploy a Netlify

```bash
# 1. Haz push a rama demo-netlify
git push origin demo-netlify

# 2. En Netlify:
# - Conecta tu repo GitHub
# - Build command: npm run build
# - Publish directory: dist
# - Agrega env var (opcional):
#   DEMO_MODE=true
```

Listo. Netlify deployará automáticamente en cada push.

---

## 🐛 Troubleshooting

### "No veo logs de DEMO"
- Abre consola (F12 → Console)
- Busca mensaje: `✨ Ticket Flow iniciado en modo`
- Si no aparece, intenta: `localStorage.setItem('TICKET_FLOW_DEMO', 'true')`

### "Scaneo no funciona"
- Verifica que estés en DEMO mode: `__getTicketFlowStatus()`
- Intenta uno de los QR codes predefinidos (QR001, QR002, etc.)
- Consulta logs en console

### "Quiero desactivar DEMO y volver a WordPress"
```javascript
localStorage.removeItem('TICKET_FLOW_DEMO');
location.reload();
```

---

## 📝 Notas para desarrolladores

- `src/services/ApiService.js`: Toda la lógica DEMO_MODE está ahí
- `src/index.js`: Inicialización y detección de modo
- `public/index.html`: HTML de entrada para Netlify
- No se modificaron componentes React (compatibilidad 100%)

---

**Versión**: 1.5.2  
**Rama**: demo-netlify  
**Última actualización**: 2025-05-27
