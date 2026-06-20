# TOP 10 VERIFIED FINDINGS - TICKETFLOW QR

## Hallazgos 100% Demostrables en el Código Fuente

**Método:** Código directo, sin escenarios hipotéticos  
**Cada finding:** Archivo exacto + línea + Por qué es problema + Esfuerzo

---

## PRIORIDAD 1: SEGURIDAD

### 1️⃣ CRITICAL: Todos los endpoints REST sin autenticación

**Archivo:** `includes/class-rest-api.php` líneas 97-246  
**Severidad:** CRITICAL  
**Estado:** TODO

Todos los endpoints usan `'permission_callback' => '__return_true'`

```php
register_rest_route('ticketflow/v1', '/bulk-mark-scanned', [
    'permission_callback' => '__return_true'  // ← ABIERTO
]);
```

**Fix:** Cambiar a `current_user_can('ticketflow_scan_qr')`  
**Esfuerzo:** 1-2 horas

---

### 2️⃣ HIGH: Nonce verification written but not used

**Archivo:** `includes/class-rest-api.php` líneas 72-92  
**Severidad:** HIGH  
**Estado:** TODO

Función `verify_request_permissions()` existe pero está comentada.

**Fix:** Descomentar y usar en endpoints  
**Esfuerzo:** 30 minutos

---

## PRIORIDAD 2: CONFIABILIDAD

### 3️⃣ CRITICAL: localStorage borrado al montar EventoProvider

**Archivo:** `src/context/EventoContext.js` línea 43  
**Severidad:** CRITICAL  
**Estado:** ✅ PARCIALMENTE ARREGLADO

```javascript
localStorage.removeItem("ticketflow_asistentes"); // ← Borra TODO
```

**Impacto:** Pérdida de estado al reiniciar app  
**Fix:** Restaurar desde localStorage antes de borrro  
**Esfuerzo:** 2 horas (ya iniciado)

---

### 4️⃣ HIGH: No retry en syncBuffer() cuando falla API

**Archivo:** `src/context/EventoContext.js` líneas 175-196  
**Severidad:** HIGH  
**Estado:** TODO

Sin retry logic, escaneos se pierden en caso de error.

**Fix:** Agregar exponential backoff  
**Esfuerzo:** 2-3 horas

---

### 5️⃣ HIGH: updateAsistenteStatus optimista sin rollback

**Archivo:** `src/context/EventoContext.js` líneas 75-118  
**Severidad:** HIGH  
**Estado:** TODO

Estado cambia localmente sin garantía de sync.

**Fix:** Agregar callback de rollback  
**Esfuerzo:** 3-4 horas

---

## PRIORIDAD 3: DATOS

### 6️⃣ HIGH: Database transaction deadlock en mark_multiple_as_scanned

**Archivo:** `includes/class-rest-api.php` líneas 809-893  
**Severidad:** HIGH  
**Estado:** TODO

No hay retry en caso de deadlock.

**Fix:** Agregar retry con backoff  
**Esfuerzo:** 2-3 horas

---

### 7️⃣ MEDIUM: JSON.parse sin validación en localStorage

**Archivo:** `src/context/EventoContext.js` líneas 44-45  
**Severidad:** MEDIUM  
**Estado:** TODO

```javascript
if (savedBuffer) syncBufferRef.current = JSON.parse(savedBuffer); // ← Sin try-catch
```

**Fix:** Envolver en try-catch  
**Esfuerzo:** 1 hora

---

## PRIORIDAD 4: PERFORMANCE

### 8️⃣ MEDIUM: O(n) búsquedas en validarTicket

**Archivo:** `src/context/EventoContext.js` líneas 205-215  
**Severidad:** MEDIUM  
**Estado:** TODO

Usa `.find()` para cada validación = O(n) con 5000+ asistentes.

**Fix:** Usar Map para O(1) lookup  
**Esfuerzo:** 2-3 horas

---

### 9️⃣ MEDIUM: Múltiples useEffect escriben localStorage sin sync

**Archivo:** `src/context/EventoContext.js` líneas 65-81  
**Severidad:** MEDIUM  
**Estado:** TODO

Dos `setItem()` simultáneos en mismo storage.

**Fix:** Batch updates o single effect  
**Esfuerzo:** 1-2 horas

---

### 🔟 MEDIUM: console.log extensivamente en hot paths

**Archivo:** `src/pages/scanQR1.js` + `src/context/EventoContext.js`  
**Severidad:** MEDIUM  
**Estado:** TODO

50+ logs por escaneo = overhead de performance.

**Fix:** Remover o condicional por env  
**Esfuerzo:** 2-3 horas

---

## RESUMEN SPRINT PLANNING

| #   | Hallazgo                     | Tipo           | Esfuerzo | Riesgo  |
| --- | ---------------------------- | -------------- | -------- | ------- |
| 1   | Endpoints sin auth           | Security       | 1-2h     | CRÍTICO |
| 2   | Nonce comentado              | Security       | 0.5h     | CRÍTICO |
| 3   | localStorage borrado         | Reliability    | 2h       | CRÍTICO |
| 4   | syncBuffer sin retry         | Reliability    | 2-3h     | ALTO    |
| 5   | updateAsistente sin rollback | Data Integrity | 3-4h     | CRÍTICO |
| 6   | Database deadlock            | Reliability    | 2-3h     | ALTO    |
| 7   | JSON.parse sin try-catch     | Reliability    | 1h       | MEDIO   |
| 8   | O(n) búsquedas               | Scalability    | 2-3h     | MEDIO   |
| 9   | Multiple writes localStorage | Reliability    | 1-2h     | BAJO    |
| 10  | Excessive console.log        | Scalability    | 2-3h     | BAJO    |

**TOTAL:** ~21-28 horas

---

## PROPUESTA DE SPRINTS

### Sprint 1: Security + Critical Data (5 días)

- Fix #1: Auth (2h)
- Fix #2: Nonce (0.5h)
- Fix #5: Rollback (4h)
- Fix #4: Retry (3h)
- **Total:** ~9.5h

### Sprint 2: Reliability (3 días)

- Fix #6: Deadlock (3h)
- Fix #7: Try-catch (1h)
- Fix #9: Batch writes (2h)
- **Total:** ~6h

### Sprint 3: Performance (2 días)

- Fix #8: Index search (3h)
- Fix #10: Remove logs (2h)
- **Total:** ~5h
