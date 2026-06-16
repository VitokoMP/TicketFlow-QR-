# TICKET PURCHASE → SCANNER UPDATE FLOW
## Current Architecture Analysis + Real-Time Event Design

---

## PARTE 1: FLUJO ACTUAL DE COMPRA Y ASISTENTES

### 1.1 Dónde se crean asistentes

**Fuente actual:** Plugin de eventos externo (Meta Event Planner o similar)

```
User Purchase Flow:
  1. Cliente compra ticket en: /eventos/{evento-id}/
  2. Plugin MEP crea post:
     - post_type = 'mep_events_attendees'
     - post_name = QR code (token único)
     - postmeta 'ea_event_id' = event_id
  3. Post almacena: nombre, email, tipo_entrada, etc.
```

**Código actual de sincronización (class-rest-api.php línea 621-636):**
```php
public function sync_attendees_to_scans_table($event_ids) {
  global $wpdb;
  
  $event_ids = (array) $event_ids;
  $total_inserted = 0;

  foreach ($event_ids as $event_id) {
    $event_id = intval($event_id);
    
    // ← Aquí se obtienen los asistentes
    $result = $wpdb->query($wpdb->prepare("
      INSERT IGNORE INTO {$wpdb->prefix}ticketflow_scans (
        qr_code, ticket_id, event_id, scan_status, tipo
      )
      SELECT 
        a.post_name AS qr_code,
        a.ID AS ticket_id,
        %d AS event_id,
        'pending' AS scan_status,
        'asistente' AS tipo
      FROM {$wpdb->prefix}posts a
      LEFT JOIN {$wpdb->prefix}postmeta ea 
        ON ea.post_id = a.ID AND ea.meta_key = 'ea_event_id'
      WHERE a.post_type = 'mep_events_attendees'
      AND ea.meta_value = %d
    ", $event_id, $event_id));

    if ($result !== false) {
      $total_inserted += $result;
    }
  }

  return $total_inserted;
}
```

**Problema actual:**
- Esta función se llama SOLO cuando:
  - Admin hace sync manual (línea 81 en class-core.php)
  - Frontend pide `/sync-attendees/{event_id}` (cada 5 minutos)
- Nuevos asistentes NO se notifican al scanner hasta próximo sync

---

### 1.2 Tabla de asistentes en TicketFlow

**Tabla:** `wp_ticketflow_scans`

```sql
CREATE TABLE wp_ticketflow_scans (
  id INT PRIMARY KEY AUTO_INCREMENT,
  event_id INT,
  qr_code VARCHAR(255),
  ticket_id INT,
  scan_status ENUM('pending', 'scanned'),
  scan_time DATETIME,
  tipo ENUM('evento', 'asistente'),
  synced TINYINT(1),
  
  -- Metadata
  event_title VARCHAR(255),
  event_start_date DATETIME,
  event_end_date DATETIME,
  event_location VARCHAR(255),
  
  INDEX(event_id),
  INDEX(qr_code),
  INDEX(scan_status)
);
```

**Clave:**
- Es una COPIA de datos de MEP
- Diseñada para escaneo rápido (índices locales)
- Source of truth sigue siendo WordPress (posts/postmeta)

---

### 1.3 Flujo actual (Timeline)

```
T=0min: Admin manualmente sincroniza eventos
        POST /sync → mep_sincronizar_eventos_y_asistentes()
        ✓ Se crea wp_ticketflow_scans con todos los asistentes actuales

T=5min: Scanner A pollea automáticamente
        GET /sync-attendees/1
        ✓ Obtiene lista actual de asistentes
        ✓ React state se actualiza
        ✓ Renderer muestra nuevos tickets

T=7min: Cliente compra ticket en MEP
        ✓ Se crea nuevo post mep_events_attendees en WordPress
        ✗ Scanner A NO lo sabe (debe esperar 5 min más)

T=12min: Scanner A pollea de nuevo
         GET /sync-attendees/1
         ✓ Ahora sí obtiene el nuevo asistente
         ✓ Latencia total: 5 minutos (7 min - 12 min)
```

**Problema:** 5 minutos de latencia entre compra y scanner

---

## PARTE 2: DISEÑO DE MECANISMO MÍNIMO EN TIEMPO REAL

### 2.1 Requerimientos

```
✓ Debe notificar escáneres en <1 segundo
✓ WordPress sigue siendo source of truth
✓ Cambios MÍNIMOS a arquitectura existente
✓ Sin dependencias externas (WebSocket server, Redis, etc)
✓ Compatible con WordPress (pluggable, hooks, transients)
✓ Funciona offline (no es bloqueante)
```

---

### 2.2 Solución: WordPress Action Hook + Transient Invalidation

#### Arquitectura de Alto Nivel

```
                    WordPress (Source of Truth)
                           ↓
                   [Cliente compra ticket]
                           ↓
                   do_action('tf_attendee_added')
                           ↓
           ┌───────────────┴───────────────┐
           ↓                               ↓
    [Update DB]                   [Set transient 'tf_changed']
    (normal)                      (ping mechanism)
           ↓                               ↓
    [Invalidate cache]            [Scanner B polls /changed]
           ↓                       (every 10-30 sec)
    wp_ticketflow_scans               ↓
           ↓                   [Sees transient]
    [Scanner A requests                ↓
     /sync-attendees/1]         [Force full sync]
           ↓                           ↓
    [Gets new attendees]      [React state updates]
           ↓
    [UI reflects purchase]
```

#### 2.2a: Hook Integration (PHP)

**Ubicación:** Plugin event manager (MEP) → TicketFlow hook

```php
// En el plugin MEP o en un custom hook que TicketFlow crea:
// Cada vez que se crea/actualiza asistente:

add_action('transition_post_status', function($new_status, $old_status, $post) {
  // Interceptar cuando nuevo asistente se publica
  if ($post->post_type !== 'mep_events_attendees') return;
  if ($old_status === 'publish' && $new_status === 'publish') return; // Ya existía
  
  // ← NUEVO ASISTENTE CREADO
  $event_id = get_post_meta($post->ID, 'ea_event_id', true);
  
  // Trigger custom hook
  do_action('tf_attendee_added', [
    'attendee_id' => $post->ID,
    'event_id' => $event_id,
    'qr_code' => $post->post_name,
    'timestamp' => time()
  ]);
  
}, 10, 3);

// En TicketFlow, escuchar el hook:
add_action('tf_attendee_added', function($attendee) {
  // 1. Insertar en wp_ticketflow_scans (si no existe)
  global $wpdb;
  $wpdb->query($wpdb->prepare("
    INSERT IGNORE INTO {$wpdb->prefix}ticketflow_scans (
      qr_code, ticket_id, event_id, scan_status, tipo
    ) VALUES (%s, %d, %d, 'pending', 'asistente')
  ", $attendee['qr_code'], $attendee['attendee_id'], $attendee['event_id']));
  
  // 2. Invalidar el ping
  set_transient('tf_event_changed_' . $attendee['event_id'], 1, HOUR_IN_SECONDS);
});
```

**Ventaja:** 
- Cero latencia entre creación y sincronización
- Automático (no depende de polling)
- Usa mecanismo nativo de WordPress

---

#### 2.2b: Frontend "Change Detection" Endpoint

**Nuevo endpoint en REST API:**

```php
// En class-rest-api.php:

register_rest_route('ticketflow/v1', '/events/(?P<event_id>\d+)/changed', [
    'methods' => 'GET',
    'callback' => [$this, 'check_event_changed'],
    'permission_callback' => '__return_true'
]);

public function check_event_changed($request) {
  $event_id = intval($request['event_id']);
  $last_sync = intval($request->get_param('since')) ?? 0;
  
  // ← Verificar si hubo cambios desde last_sync
  $changed = get_transient('tf_event_changed_' . $event_id);
  
  return rest_ensure_response([
    'changed' => (bool) $changed,
    'timestamp' => time(),
    'should_sync' => (bool) $changed
  ]);
}
```

**Costo:**
- 1 DB query (transient lookup) = <1ms
- HTTP request = ~50-100ms

---

#### 2.2c: Frontend Integration (React)

**Cambio MÍNIMO en EventoContext.js:**

```javascript
// Reemplazar polling cada 5 minutos con:
// 1. Ping rápido cada 20 segundos
// 2. Full sync solo si hay cambios

useEffect(() => {
  if (!eventoSeleccionado?.event_id) return;
  
  const eventId = eventoSeleccionado.event_id;
  let intervalId;
  let fullSyncTimestamp = Date.now();
  
  const checkForChanges = async () => {
    try {
      // ← Ping rápido
      const response = await fetch(
        `/wp-json/ticketflow/v1/events/${eventId}/changed`
      );
      const { should_sync } = await response.json();
      
      if (should_sync) {
        // ← Full sync solo si hay cambios
        const result = await ScannerAPI.syncAttendees(eventId);
        if (result.success) {
          setAsistentes(prev => ({
            ...prev,
            [eventId]: result.data
          }));
          fullSyncTimestamp = Date.now();
        }
      }
    } catch (error) {
      console.error('Change detection failed:', error);
    }
  };
  
  // Ping cada 20 segundos
  intervalId = setInterval(checkForChanges, 20000);
  
  // Fallback: full sync cada 5 minutos
  const fallbackId = setInterval(() => {
    ScannerAPI.syncAttendees(eventId).then(result => {
      if (result.success) {
        setAsistentes(prev => ({ ...prev, [eventId]: result.data }));
      }
    });
  }, 300000);
  
  return () => {
    clearInterval(intervalId);
    clearInterval(fallbackId);
  };
}, [eventoSeleccionado?.event_id]);
```

---

### 2.3 Métricas de Performance

```
Escenario: Cliente compra ticket en evento activo con 3 escáneres

Antes (5 min polling):
- T=0s: Compra realizada
- T=300s: Scanner 1 pollea, obtiene nuevo asistente
- Latencia: 300 segundos

Después (20s change detection):
- T=0s: Compra realizada
  - WordPress hook se ejecuta
  - Transient se establece: tf_event_changed_1 = 1
  - wp_ticketflow_scans se actualiza
  
- T=20s: Scanner 1 pinga /changed
  - Obtiene: { should_sync: true }
  - Dispara syncAttendees()
  - Obtiene nuevos asistentes
  - React state se actualiza
  
- Latencia: 20 segundos máximo
```

---

### 2.4 Código Completo - Cambios Mínimos

#### Cambio 1: class-rest-api.php (agregar endpoint)

```php
// Línea ~245, después de endpoints existentes:

register_rest_route('ticketflow/v1', '/events/(?P<event_id>\d+)/changed', [
    'methods' => 'GET',
    'callback' => [$this, 'check_event_changed'],
    'permission_callback' => '__return_true'
]);

// Línea ~900, agregar método:

public function check_event_changed($request) {
    $event_id = intval($request['event_id']);
    $changed = get_transient('tf_event_changed_' . $event_id);
    
    return rest_ensure_response([
        'changed' => (bool) $changed,
        'timestamp' => time()
    ]);
}
```

#### Cambio 2: class-rest-api.php (agregar hook listener)

```php
// En __construct():
add_action('tf_attendee_added', [$this, 'on_attendee_added']);

// Nuevo método:
public function on_attendee_added($attendee) {
    global $wpdb;
    
    // 1. Insertar en wp_ticketflow_scans
    $wpdb->query($wpdb->prepare("
        INSERT IGNORE INTO {$wpdb->prefix}ticketflow_scans 
        (qr_code, ticket_id, event_id, scan_status, tipo)
        VALUES (%s, %d, %d, 'pending', 'asistente')
    ", $attendee['qr_code'], $attendee['attendee_id'], $attendee['event_id']));
    
    // 2. Marcar evento como modificado
    set_transient(
        'tf_event_changed_' . $attendee['event_id'], 
        1, 
        HOUR_IN_SECONDS
    );
    
    error_log('TicketFlow: Attendee added - ' . $attendee['qr_code']);
}
```

#### Cambio 3: EventoContext.js (cambiar polling)

```javascript
// Reemplazar el useEffect de syncAutomatically (línea ~591) con:

useEffect(() => {
  if (!eventoSeleccionado?.event_id) return;
  
  const eventId = eventoSeleccionado.event_id;
  let changeCheckInterval;
  let fallbackSyncInterval;
  
  const checkForChanges = async () => {
    try {
      const response = await fetch(
        `/wp-json/ticketflow/v1/events/${eventId}/changed`
      );
      const data = await response.json();
      
      if (data.changed) {
        console.log('[ChangeDetection] Changes detected, syncing...');
        const result = await ScannerAPI.syncAttendees(eventId);
        
        if (result.success) {
          setAsistentes(prev => ({
            ...prev,
            [eventId]: result.data
          }));
        }
      }
    } catch (error) {
      console.warn('[ChangeDetection] Error:', error);
    }
  };
  
  // Cambio rápido cada 20 segundos
  changeCheckInterval = setInterval(checkForChanges, 20000);
  
  // Fallback cada 5 minutos (por si change detection falla)
  fallbackSyncInterval = setInterval(() => {
    console.log('[FallbackSync] Running fallback sync...');
    ScannerAPI.syncAttendees(eventId).then(result => {
      if (result.success) {
        setAsistentes(prev => ({
          ...prev,
          [eventId]: result.data
        }));
      }
    });
  }, 300000);
  
  // Cambio inicial
  checkForChanges();
  
  return () => {
    clearInterval(changeCheckInterval);
    clearInterval(fallbackSyncInterval);
  };
}, [eventoSeleccionado?.event_id, setAsistentes]);
```

#### Cambio 4: En plugin MEP o custom plugin, disparar el hook

```php
// Cuando se crea nuevo asistente (donde sea que esto suceda):
// Típicamente en un hook como 'save_post_mep_events_attendees'

add_action('save_post_mep_events_attendees', function($post_id, $post) {
  if ($post->post_type !== 'mep_events_attendees') return;
  if (wp_is_post_revision($post_id)) return;
  
  $event_id = get_post_meta($post_id, 'ea_event_id', true);
  
  if ($event_id) {
    do_action('tf_attendee_added', [
      'attendee_id' => $post_id,
      'event_id' => $event_id,
      'qr_code' => $post->post_name,
      'timestamp' => time()
    ]);
  }
}, 10, 2);
```

---

## PARTE 3: COMPARACIÓN DE OPCIONES

| Opción | Latencia | Complejidad | Cambios | Mantenimiento |
|--------|----------|------------|---------|---------------|
| **Actual (5min polling)** | 300s | Muy baja | 0 | Bajo |
| **Change Detection** (propuesta) | 20-25s | Baja | 3 archivos | Bajo |
| **WebSocket** | 0.1s | Alta | Muchos | Alto |
| **SSE (Server-Sent Events)** | 0.5s | Media | 4-5 archivos | Medio |
| **Redis Pub/Sub** | 0.1s | Media | Muchos | Medio |

**Recomendación:** Change Detection es el mejor balance

---

## PARTE 4: IMPLEMENTACIÓN PASO A PASO

### Fase 1: Agregar endpoint (1-2 horas)
- [ ] Agregar `/events/{id}/changed` endpoint
- [ ] Test: Crear transient, verificar que endpoint lo retorna
- [ ] Test: Limpiar transient, verificar que retorna false

### Fase 2: Agregar hook listener (1-2 horas)
- [ ] En class-rest-api.php, escuchar `tf_attendee_added`
- [ ] Test: Simular creación de asistente, verificar que `wp_ticketflow_scans` se actualiza
- [ ] Test: Verificar que transient se establece

### Fase 3: Cambiar frontend polling (2-3 horas)
- [ ] Reemplazar syncAutomatically en EventoContext.js
- [ ] Test: Verificar que pinga /changed cada 20s
- [ ] Test: Crear asistente, verificar que scanner se actualiza en <25s

### Fase 4: Integración con MEP (2-3 horas)
- [ ] Identificar dónde MEP crea asistentes
- [ ] Agregar hook que dispare `tf_attendee_added`
- [ ] Test end-to-end: Compra → scanner actualiza

### Fase 5: Monitoring (1-2 horas)
- [ ] Logs en cada transición
- [ ] Dashboard: "Time since last update"
- [ ] Alert si change detection falla

**Total:** ~10-14 horas para implementación + testing

---

## PARTE 5: FALLBACK Y RESILENCIA

### Si `/changed` endpoint falla
```javascript
// Fallback automático cada 5 minutos (ya está en código)
fallbackSyncInterval = setInterval(checkForChanges, 300000);
```

### Si transient se limpia accidentalmente
```javascript
// Nada cambia - simplemente espera al próximo fallback sync
// Máxima latencia: 5 minutos (igual que antes)
```

### Si WordPress está caído
```
- Scanner continúa con último estado caché
- Cambios se pierden temporalmente
- Se recuperan en próximo sync cuando WP vuelva
```

---

## PARTE 6: PRÓXIMOS PASOS

1. **Investigación:** Verificar dónde exactamente MEP crea asistentes
   - Hook de WordPress exacto
   - Metadata que se establece
   - Flujo post-compra

2. **Validación:** Diseño de base de datos
   - ¿Se puede confiar en `post_name` como QR?
   - ¿Hay campo de estado en postmeta?

3. **Implementación:** Comenzar con Fase 1 (endpoint)
   - No rompe nada
   - Fácil de testear
   - Reversible

4. **Testing:** Script que simule compras
   - Crear asistentes en rápida sucesión
   - Verificar que transient se actualiza
   - Medir latencia real
