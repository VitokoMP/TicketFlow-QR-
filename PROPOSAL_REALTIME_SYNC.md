# PROPUESTA: TICKETFLOW REAL-TIME SYNC
## Sincronización Multi-Scanner en Tiempo Real

---

## EJECUTIVO (1 página)

### El Problema
Hoy, cuando un cliente compra un ticket, los scanners toman **5 minutos** en enterarse.

Con múltiples operadores escaneando en paralelo:
- Scanner A valida ticket
- Scanner B **no lo sabe** por 5 minutos
- Usuario intenta pasar de nuevo → confusión

### La Solución
Implementar **Diff-Sync**: cambios se propagan cada **5 segundos**.

Múltiples scanners ven cambios casi instantáneamente.

### Inversión Requerida

| Componente | Costo | Duración |
|-----------|--------|----------|
| **Infraestructura** | $89/mes recurrente | Permanente |
| **Desarrollo** | $2,500 USD (25 horas × $100/h) | 3-4 semanas |
| **Migration** | Incluido | 1 día |
| **Capacitación** | Incluido | 2 horas |

**Total inicial:** $2,500 USD + Setup

**Costo recurrente:** $89/mes (VPS)

---

## OPCIÓN A: STATUS QUO (Sync cada 5 minutos)

### Pros
- ✅ Funciona hoy
- ✅ Bajo costo infraestructura ($30/mes)
- ✅ Cero desarrollo

### Contras
- ❌ 5 minutos de latencia
- ❌ Duplicados si 2 scanners escanean mismo ticket
- ❌ No visible cuál scanner validó
- ❌ No escalable (>3 eventos simultáneos)

### Cuándo usar
- 1 scanner por evento
- Eventos <200 tickets
- Latencia no es crítica

---

## OPCIÓN B: REAL-TIME DIFF-SYNC (Sync cada 5 segundos)

### Pros
- ✅ **Cambios vistos en <5 segundos**
- ✅ **Duplicados detectados automáticamente**
- ✅ **Auditoría completa** (quién, cuándo, qué)
- ✅ **Escalable** a eventos grandes
- ✅ **Múltiples scanners sincronizan**
- ✅ Rollback automático si hay errores

### Contras
- ❌ Requiere VPS ($89/mes)
- ❌ Implementación 3-4 semanas
- ❌ Mayor complejidad técnica

### Cuándo usar
- 2+ scanners simultáneos
- Eventos >500 tickets
- Precisión es crítica
- Auditoría obligatoria
- Crecimiento futuro

---

## ARQUITECTURA: DIFF-SYNC

```
┌─────────────────────────────────────────────┐
│         WordPress (Source of Truth)         │
│         (Evento + Asistentes)               │
└──────────────────┬──────────────────────────┘
                   │
                   ↓
      ┌────────────────────────────┐
      │   PostgreSQL (VPS)         │
      │ ─────────────────────────  │
      │ • tickets                  │
      │ • ticket_changes (NEW)     │
      │ • sync_state (NEW)         │
      │                            │
      │ Indices: O(<5ms)           │
      └────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ↓          ↓          ↓
    Scanner A   Scanner B   Scanner C
    (Sync 5s)   (Sync 5s)   (Sync 5s)
```

### Flujo de Sincronización

```
Cliente compra ticket
           ↓
WordPress crea post
           ↓
Webhook: tf_attendee_added
           ↓
┌──────────────────────────┐
│ PostgreSQL:              │
│ INSERT INTO tickets(...) │
│ INSERT INTO changes(...) │
│ UPDATE sync_state        │
└──────────────────────────┘
           ↓
Scanner A polls /cambios
           ↓
<150ms después>
           ↓
React state se actualiza
           ↓
UI muestra ticket como validado
```

---

## TÉCNICO: CAMBIOS REQUERIDOS

### 1. Infraestructura (2-3 días)

**Antes:**
```
Shared Hosting
  └─ MySQL compartida (15-20s/query)
```

**Después:**
```
VPS ($89/mes)
  ├─ PostgreSQL dedicada (<200ms/query)
  ├─ Node.js API server
  ├─ Nginx (caching)
  └─ Redis (sessions, opcional)
```

**Proveedor recomendado:** Joyride, Linode, DigitalOcean

### 2. Base de Datos

**Nueva tabla: ticket_changes**
```sql
ticket_changes (
  id, 
  evento_id, 
  ticket_id, 
  old_status, 
  new_status,
  changed_by_device,
  changed_at,
  metadata  -- JSON: notas, IP, etc
)
```

**Índices críticos:**
```
- evento_id + changed_at (búsqueda principal)
- ticket_id (auditoría individual)
- changed_by_device (rastrear scanner)
```

**Por qué PostgreSQL:**
- Transacciones ACID (no pierde datos)
- JSONB para metadata
- Mejor para queries complejas
- Mejor indexación

### 3. Backend - Nuevos Endpoints

#### GET /eventos/{id}/cambios
```
Parámetros:
  desde: timestamp ISO (ej: 2024-01-15T10:30:00Z)
  device_id: identificador del scanner

Retorna:
  cambios: [
    {
      ticket_id,
      old_status,
      new_status,
      changed_by_device,
      changed_at
    }
  ],
  timestamp: timestamp del servidor
```

**Performance:**
- Query: <50ms
- Network: ~50-100ms
- Total: ~150ms

#### POST /eventos/{id}/bulk-mark-scanned
```
Body:
  {
    ids: [1, 2, 3, ...],
    device_id: "iPad-North"
  }

Retorna:
  {
    success: true,
    synced: 3,
    timestamp: "2024-01-15T10:30:05Z"
  }
```

**Garantías:**
- Transacción ACID (todo o nada)
- INSERT en ticket_changes es automático
- Rollback si algo falla

### 4. Frontend (React)

**Cambio en EventoContext.js:**
```javascript
// Antes: Poll cada 5 minutos
setInterval(syncAttendees, 300000);

// Después: Fetch cambios cada 5 segundos
setInterval(fetchChanges, 5000);  // Solo traer deltas
if (cambios.length > 0) {
  syncFullAttendees();  // Full sync si hay cambios
}
```

**Beneficio:**
- Antes: 12 full syncs/hora
- Después: 720 cambios checks/hora + sync solo si hay cambios
- Resultado: Actualización casi instantánea sin sobrecarga

---

## IMPLEMENTACIÓN: CRONOGRAMA

### Semana 1: Setup Infraestructura
- [ ] Provisionar VPS
- [ ] Instalar PostgreSQL + Node.js
- [ ] Migrar datos MySQL → PostgreSQL
- [ ] Testing básico
- **Entregables:** VPS funcional, datos migrados

### Semana 2-3: Backend
- [ ] Crear tabla ticket_changes + índices
- [ ] Implementar GET /cambios
- [ ] Implementar POST /bulk-mark-scanned
- [ ] Testing de concurrencia
- [ ] Performance tuning (índices, queries)
- **Entregables:** API endpoints funcionales, <200ms por query

### Semana 4: Frontend
- [ ] Implementar fetchChanges cada 5s
- [ ] Testing en múltiples devices
- [ ] Rollback automático si falla
- [ ] Auditoría en logs
- **Entregables:** React sync funcionando

### Post-Launch: Monitoreo
- [ ] Dashboard: latencia promedio
- [ ] Alertas: sync failures
- [ ] Logs: rastrear todos los cambios
- [ ] Optimización continua

---

## GARANTÍAS Y SLAS

### Performance
- ✅ Cambios propagados en <5 segundos
- ✅ Query time: <200ms
- ✅ 99.9% uptime (SLA estándar VPS)

### Confiabilidad
- ✅ Sin pérdida de datos (transacciones ACID)
- ✅ Rollback automático en errores
- ✅ Auditoría completa de cambios
- ✅ Recovery en caso de falla

### Escalabilidad
- ✅ Hasta 1000 scanners concurrentes
- ✅ Eventos ilimitados de 10,000+ tickets
- ✅ Storage: ~1MB por 10,000 cambios

---

## ROI: Por Qué Vale la Pena

### Problema Actual
```
2 scanners validando en paralelo
↓
Sin coordinación
↓
Usuario intenta pasar 2 veces
↓
Confusión, fricción
↓
Mala experiencia del evento
```

### Con Diff-Sync
```
2 scanners validando en paralelo
↓
Sync en <5 segundos
↓
Ambos ven cambios
↓
Usuario no puede pasar 2 veces
↓
Operación perfecta
↓
Evento sin fricción
```

### Financiero
- **Inversión:** $2,500 USD (una vez)
- **Mantenimiento:** $89/mes
- **Beneficio:** Eventos más eficientes, mejor experiencia

**Payback:** ~3-6 meses si se usa en 2+ eventos/mes

---

## PREGUNTAS CLAVE PARA EL CLIENTE

Antes de proceder, necesitamos confirmar:

### 1. Infraestructura
- [ ] ¿Entienden que VPS es obligatorio ($89/mes)?
- [ ] ¿Es presupuesto aceptable?
- [ ] ¿Quién mantendrá la infraestructura?

### 2. Datos
- [ ] ¿Tienen datos históricos que migrar?
- [ ] ¿Cuántos asistentes típicamente?
- [ ] ¿Cuántos eventos concurrentes?

### 3. Operación
- [ ] ¿Cuántos scanners típicamente?
- [ ] ¿En qué eventos es más crítico?
- [ ] ¿Qué pasaría si sync falla?

### 4. Expectativas
- [ ] ¿Entienden 3-4 semanas de desarrollo?
- [ ] ¿Hay deadline fijo?
- [ ] ¿Quieren Opción A o B?

---

## RIESGOS Y MITIGACIÓN

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Migration falla | Baja | Alto | Backup completo, testing pre-migration |
| VPS performance no cumple | Baja | Medio | Load testing, índices optimizados |
| Frontend bugs | Media | Bajo | Testing exhaustivo, staging env |
| Database locks/deadlocks | Baja | Bajo | Transacciones, retry logic |
| WP hook no dispara | Baja | Medio | Testing con eventos reales |

---

## NEXT STEPS

### Si dice SÍ:
1. Firmar propuesta
2. Provisionar VPS (día 1)
3. Acceso a datos + WordPress
4. Kick-off técnico (día 3)
5. 1 reunión/semana de status

### Si tiene dudas:
1. Demo con setup local (2 horas)
2. Llamada técnica detallada
3. Revisar alternativas (SSE, WebSocket)
4. Redefinir scope si es necesario

### Si dice NO:
1. Seguir con Opción A (sync 5 min)
2. Documentar por qué fue rechazado
3. Proponer revisión en 6 meses

---

## COMPARATIVA: OPCIÓN A vs B

| Aspecto | Opción A | Opción B |
|--------|----------|----------|
| **Sync tiempo** | 300s | 5s |
| **Múltiples scanners** | ❌ | ✅ |
| **Detección duplicados** | Manual | Automática |
| **Auditoría** | Ninguna | Completa |
| **Escalabilidad** | Limitada | Ilimitada |
| **Infraestructura** | $30/mes | $89/mes |
| **Desarrollo** | $0 | $2,500 |
| **Cronograma** | Hoy | 3-4 semanas |

---

## CONCLUSIÓN

**Opción A** es suficiente si:
- ✅ 1 scanner por evento
- ✅ <200 tickets
- ✅ No hay eventos simultáneos

**Opción B** es necesaria si:
- ✅ 2+ scanners
- ✅ >500 tickets
- ✅ Precisión es crítica
- ✅ Eventos simultáneos

**Recomendación:** B (verdadero product, sin limitaciones)

---

## APÉNDICE: REFERENCIAS TÉCNICAS

### Tecnologías Usadas
- **VPS:** Joyride / DigitalOcean / Linode
- **Database:** PostgreSQL 15+
- **API:** Node.js + Express
- **Frontend:** React (sin cambios a dependencias)
- **Cache:** Nginx (incluido)

### Compatibilidad
- WordPress: 6.0+
- React: 18+
- PHP: 7.4+ (WordPress side)
- Node: 18+ (API side)

### Documentación
- API docs: Swagger generado automáticamente
- Database schema: SQL provided
- Deployment guide: Paso a paso
- Runbooks: Troubleshooting común

---

**Documento Preparado Por:** [Tu nombre]  
**Fecha:** [Fecha]  
**Válido Por:** 30 días  
**Revisiones:** Bajo demanda

