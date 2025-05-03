<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.0.3
 * Text-Domain: wp-react-ticketflow-qr 
 */

if ( ! defined( 'ABSPATH' ) ) exit; // No direct access allowed.
if ( ! defined( 'JWT_AUTH_SECRET_KEY' ) ) {
    define( 'JWT_AUTH_SECRET_KEY', 'asereje' );  // Colócalo dentro del plugin.
}
/**
 * Define Plugins Constants
 */
define ( 'WPRK_PATH', trailingslashit( plugin_dir_path( __FILE__ ) ) );
define ( 'WPRK_URL', trailingslashit( plugins_url( '/', __FILE__ ) ) );
 

/**
 * Creamos jook.
 */
register_activation_hook(__FILE__, function() {
    // Crear roles personalizados
    add_role('ticketflow_productor', 'Productor de Eventos', [
        'read' => true,
        'exportar_qr' => true,
        'cerrar_evento' => true
    ]);

    add_role('ticketflow_escaner', 'Escaneador QR', [
        'read' => true,
        'escanear_qr' => true
    ]);

    global $wpdb;

    $table_name = $wpdb->prefix . 'ticketflow_scans';
    $charset_collate = $wpdb->get_charset_collate();

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    // SQL para crear la tabla con las nuevas columnas
    $sql = "CREATE TABLE $table_name (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        ticket_id BIGINT(20) UNSIGNED NOT NULL,
        event_id BIGINT(20) UNSIGNED NOT NULL,
        qr_code VARCHAR(255) NOT NULL,
        user_id BIGINT(20) UNSIGNED DEFAULT NULL,
        scan_status VARCHAR(50) DEFAULT 'pendiente', 
        scan_time DATETIME DEFAULT NULL,
        synced TINYINT(1) DEFAULT 0,
        event_start_date DATETIME NULL,
        event_end_date DATETIME NULL,
        event_title VARCHAR(255) NULL,
        event_location VARCHAR(255) NULL,
        PRIMARY KEY (id),
        KEY ticket_id (ticket_id),
        KEY event_id (event_id),
        KEY user_id (user_id),
        KEY scan_status (scan_status),
        FOREIGN KEY (ticket_id) REFERENCES {$wpdb->prefix}posts(ID) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES {$wpdb->prefix}posts(ID) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES {$wpdb->prefix}users(ID) ON DELETE SET NULL
    ) $charset_collate;";

    // Ejecutar la creación de la tabla
    dbDelta($sql);
});

/**
 * Clase para crear la página de administración del plugin, encolar los scripts necesarios y definir los puntos finales de la API REST.
 */
class WPRK_Plugin {
  
    
    public function __construct() {
        // Crear menú y encolar scripts
        add_action('admin_menu', [$this, 'create_admin_menu']);        
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('init', [$this, 'schedule_ticket_update']);
        add_action('ticketflow_update_scans', [$this, 'update_scans']);
        add_action('save_post_event', [$this, 'ticketflow_trigger_on_event_publish'], 10, 3);
        add_action('init', [$this, 'insert_events_to_db']); // Esto insertará los eventos cuando se inicialice el plugin
        add_action('rest_api_init', [$this, 'create_rest_routes']);
//        add_action('rest_api_init', 'alekhart_register_sync_tickets_route');
// Agregar un menú en el panel de administración de WordPress
        add_action('admin_menu', function() {
        add_menu_page('Sincronizar Eventos', 'Sincronizar Eventos', 'manage_options', 'sincronizar_eventos', 'ejecutar_sincronizacion_con_boton');
            //jquery
            add_action( 'wp_enqueue_scripts', 'load_jquery_ui' );
            add_action('admin_enqueue_scripts', 'cargar_jquery_ui');

    });
    }

    public function create_admin_menu() {
        add_menu_page(
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            'manage_options',
            'wprk-settings', 
            [$this, 'menu_page_template'],
            'dashicons-tickets-alt',
            20
        );
    }

    public function menu_page_template() {
        echo '<div class="wrap">
            <!-- Contenedor para la aplicación React sin el título -->
            <div id="wprk-admin-app" style="padding: 20px; border: 1px solid #ddd; border-radius: 5px; background-color: #fff; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);"></div>
        </div>';
    }
    

    public function enqueue_scripts($hook) {
        if ($hook !== 'toplevel_page_wprk-settings') {
            return;
        }

        wp_enqueue_script(
            'my-react-app',
            WPRK_URL . 'dist/bundle.js', // Ruta al archivo bundle.js
            ['wp-element'], // Dependencias de WordPress, incluyendo wp-element para React
            null,
            true // Cargar en el pie del documento
        );

        wp_localize_script('my-react-app', 'appLocalizer', [
            'apiUrl' => esc_url(rest_url('wprk/v1')), // URL para tu API REST
            'nonce' => wp_create_nonce('wp_rest'), // Nonce para autenticación en la API
        ]);
    }

    public function create_rest_routes() {
        register_rest_route('mep/v1', '/mep_sincronizar_eventos_y_asistentes', [
            'methods'  => 'GET',
            'callback' => 'mep_sincronizar_eventos_y_asistentes',
            'permission_callback' => '__return_true', // Temporalmente para pruebas
        ]);
                
        //rutas ticketflow.
        register_rest_route('ticketflow/v1', '/exportar', [
            'methods' => 'GET',
            'callback' => [$this, 'export_json'],
            'permission_callback' => function () {
                return current_user_can('exportar_qr');
            }
        ]);
    
        register_rest_route('ticketflow/v1', '/importar', [
            'methods' => 'POST',
            'callback' => [$this, 'import_json'],
            'permission_callback' => function () {
                return current_user_can('exportar_qr');
            }
        ]);
 
        register_rest_route('ticketflow/v1', '/events/', [
            'methods' => 'GET',
            'callback' => 'get_events_from_db',
        ]);
    
        register_rest_route('ticketflow/v1', '/sincronizar', [
            'methods' => 'POST',
            'callback' => [$this, 'sync_data'],
            'permission_callback' => function () {
                return current_user_can('escanear_qr') || current_user_can('exportar_qr');
            }
        ]);
        register_rest_route('mep/v1', '/tickets-vendidos', [
            'methods' => 'GET',
            'callback' => 'mep_obtener_tickets_vendidos',
            'permission_callback' => '__return_true'
        ]);
    }

    // Activar la tarea programada
    public function schedule_ticket_update() {
        if (!wp_next_scheduled('ticketflow_update_scans')) {
            wp_schedule_event(time(), 'hourly', 'ticketflow_update_scans');
        }
    }

    function mep_sincronizar_eventos_y_asistentes() {
        global $wpdb;
    
        // 1. Obtener eventos desde tu endpoint REST
        $response = wp_remote_get(home_url('/wp-json/ticketflow/v1/events/'));
    
        if (is_wp_error($response)) {
            return new WP_REST_Response(['success' => false, 'message' => 'Error al obtener eventos.'], 500);
        }
    
        $body = wp_remote_retrieve_body($response);
        $events = json_decode($body, true);
    
        if (!is_array($events)) {
            return new WP_REST_Response(['success' => false, 'message' => 'Respuesta inválida del endpoint.'], 500);
        }
    
        $eventos_insertados = [];
    
        foreach ($events as $event) {
            $event_id = $event['id'];
            $event_title = $event['title'] ?? '';
            $event_start = $event['start_date'] ?? null;
            $event_end = $event['end_date'] ?? null;
            $event_location = $event['location'] ?? '';
    
            if (!$event_start || !$event_end) continue;
    
            // Verificar duplicados
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM {$wpdb->prefix}ticketflow_scans 
                 WHERE event_start_date = %s AND event_title = %s",
                $event_start, $event_title
            ));
    
            if (!$exists) {
                $wpdb->insert("{$wpdb->prefix}ticketflow_scans", [
                    'event_id'         => $event_id,
                    'event_title'      => sanitize_text_field($event_title),
                    'event_start_date' => $event_start,
                    'event_end_date'   => $event_end,
                    'event_location'   => sanitize_text_field($event_location),
                    'synced'           => 0,
                    'qr_code'          => null,
                ]);
    
                $eventos_insertados[] = ['event_id' => $event_id];
            }
        }
    
        // Puedes seguir con la sincronización de asistentes si lo deseas
        $event_ids = extract_event_ids($eventos_insertados);
        if (!empty($event_ids)) {
            $asistentes = get_attendees_for_events($event_ids);
            foreach ($asistentes as $a) {
                if (empty($a['ticket_number']) || empty($a['event_id'])) continue;
    
                $exists = $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM {$wpdb->prefix}ticketflow_scans WHERE ticket_id = %d AND event_id = %d",
                    $a['ticket_number'], $a['event_id']
                ));
    
                if (!$exists) {
                    $wpdb->insert("{$wpdb->prefix}ticketflow_scans", [
                        'ticket_id'   => intval($a['ticket_number']),
                        'event_id'    => intval($a['event_id']),
                        'user_id'     => null,
                        'qr_code'     => sanitize_text_field($a['qr_code']),
                        'scan_status' => $a['scan_status'] ?? 'pending',
                        'synced'      => 0,
                    ]);
                }
            }
        }
    
        return new WP_REST_Response([
            'success' => true,
            'message' => 'Sincronización completa usando datos del endpoint.',
        ], 200);
    }
    
// Función para extraer event_ids de los eventos procesados
private function extract_event_ids($events) {
    return array_map(fn($event) => $event['event_id'], $events);
}

// Función para obtener los asistentes de los eventos
private function get_attendees_for_events($event_ids) {
    global $wpdb;

    $placeholders = implode(',', array_fill(0, count($event_ids), '%d'));

    $sql = "
        SELECT 
            a.ID AS attendee_id,
            a.post_name AS qr_code,
            name.meta_value AS name,
            email.meta_value AS email,
            phone.meta_value AS phone,
            event_id.meta_value AS event_id,
            ticket_no.meta_value AS ticket_number,
            scans.scan_status AS scan_status
        FROM {$wpdb->prefix}posts a
        LEFT JOIN {$wpdb->prefix}postmeta name ON name.post_id = a.ID AND name.meta_key = 'attendee_name'
        LEFT JOIN {$wpdb->prefix}postmeta email ON email.post_id = a.ID AND email.meta_key = 'attendee_email'
        LEFT JOIN {$wpdb->prefix}postmeta phone ON phone.post_id = a.ID AND phone.meta_key = 'attendee_phone'
        LEFT JOIN {$wpdb->prefix}postmeta event_id ON event_id.post_id = a.ID AND event_id.meta_key = 'event_id'
        LEFT JOIN {$wpdb->prefix}postmeta ticket_no ON ticket_no.post_id = a.ID AND ticket_no.meta_key = 'ticket_number'
        LEFT JOIN {$wpdb->prefix}ticketflow_scans scans ON scans.qr_code = a.post_name
        WHERE a.post_type = 'mep_attendee' AND event_id.meta_value IN ($placeholders)
    ";

    $prepared = $wpdb->prepare($sql, ...$event_ids);
    return $wpdb->get_results($prepared, ARRAY_A);
}


// Función para insertar eventos activos en la base de datos 
public function insert_events_to_db() {
    global $wpdb;

    // Obtener los eventos activos desde la API
    $events = $this->fetch_active_event_attendees();
    
    if (is_wp_error($events)) {
        return $events;  // Retornamos el error si hubo un problema al obtener los eventos
    }

    // Insertar cada evento en la tabla correspondiente
    $table_name = $wpdb->prefix . 'ticketflow_scans';

    foreach ($events as $event) {
        // Verificar que los datos necesarios están presentes
        if (!isset($event['id'], $event['ticket_id'], $event['qr_code'], $event['user_id'])) {
            continue;  // Saltar si faltan datos
        }

        // Verificar si el evento ya existe
        $existing_event = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table_name WHERE event_id = %d", $event['id']
        ));

        // Si el evento no existe, insertarlo
        if (!$existing_event) {
            $wpdb->insert($table_name, [
                'event_id'    => $event['id'],
                'ticket_id'   => $event['ticket_id'],
                'qr_code'     => $event['qr_code'],
                'user_id'     => $event['user_id'],
                'scan_status' => 'pendiente',  // O el estado adecuado
                'scan_time'   => null,         // Inicialmente no escaneado
                'synced'      => 0,            // Sincronización pendiente
            ]);
        }
    }

    return true;
}

// Función para sincronizar asistentes a ticketflow
private function sync_attendees_to_ticketflow($attendees) {
    global $wpdb;
    $table_name = $wpdb->prefix . 'ticketflow_scans';

    foreach ($attendees as $attendee) {
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table_name WHERE event_id = %d AND qr_code = %s",
            $attendee['event_id'], $attendee['qr_code']
        ));

        if (!$existing) {
            $wpdb->insert($table_name, [
                'event_id'    => $attendee['event_id'],
                'ticket_id'   => $attendee['ticket_number'],
                'qr_code'     => $attendee['qr_code'],
                'user_id'     => $attendee['attendee_id'],
                'scan_status' => 'pendiente',
                'scan_time'   => null,
                'synced'      => 0,
            ]);
        } else {
            $wpdb->update($table_name, [
                'scan_status' => 'pendiente',
            ], [
                'event_id' => $attendee['event_id'],
                'qr_code'  => $attendee['qr_code']
            ]);
        }
    }
}

// Función para obtener los asistentes de los eventos activos
public function fetch_active_event_attendees() {
    global $wpdb;

    // Obtener los event_ids activos directamente desde ticketflow_scans
    $sql = "
        SELECT DISTINCT event_id
        FROM {$wpdb->prefix}ticketflow_scans
        WHERE scan_status = 'active'  -- Aquí se asume que 'scan_status' indica si el evento está activo
    ";

    // Obtener los IDs de los eventos activos
    $event_ids = $wpdb->get_col($sql);

    // Verificar si no se encontraron eventos activos
    if (empty($event_ids)) {
        return new WP_Error('no_events', 'No se encontraron eventos activos.', ['status' => 404]);
    }

    // Preparar la consulta SQL para obtener los asistentes de los eventos activos
    $placeholders = implode(',', array_fill(0, count($event_ids), '%d'));

    $sql = "
        SELECT 
            a.ID AS attendee_id,
            a.post_name AS qr_code,
            name.meta_value AS name,
            email.meta_value AS email,
            phone.meta_value AS phone,
            event_id.meta_value AS event_id,
            ticket_no.meta_value AS ticket_number,
            scans.scan_status AS scan_status
        FROM {$wpdb->prefix}posts a
        LEFT JOIN {$wpdb->prefix}postmeta name ON name.post_id = a.ID AND name.meta_key = 'attendee_name'
        LEFT JOIN {$wpdb->prefix}postmeta email ON email.post_id = a.ID AND email.meta_key = 'attendee_email'
        LEFT JOIN {$wpdb->prefix}postmeta phone ON phone.post_id = a.ID AND phone.meta_key = 'attendee_phone'
        LEFT JOIN {$wpdb->prefix}postmeta event_id ON event_id.post_id = a.ID AND event_id.meta_key = 'event_id'
        LEFT JOIN {$wpdb->prefix}postmeta ticket_no ON ticket_no.post_id = a.ID AND ticket_no.meta_key = 'ticket_number'
        LEFT JOIN {$wpdb->prefix}ticketflow_scans scans ON scans.qr_code = a.post_name
        WHERE a.post_type = 'mep_attendee' AND event_id.meta_value IN ($placeholders)
    ";

    // Preparar la consulta con los event_ids obtenidos
    $prepared = $wpdb->prepare($sql, ...$event_ids);

    // Ejecutar la consulta y obtener los resultados
    $results = $wpdb->get_results($prepared, ARRAY_A);

    // Devolver los resultados obtenidos
    return $results;
}

 
    // Actualizar los escaneos
    public function update_scans() {
            global $wpdb;
    
            $event = $this->get_active_event();
            if (!$event) {
                $this->create_default_active_event();
                $event = $this->get_active_event(); 
            }
    
            if (!$event) return;
    
            $tickets = $wpdb->get_results($wpdb->prepare(
                "SELECT ticket_id, status FROM {$wpdb->prefix}ticketflow_scans WHERE event_id = %d",
                $event->ID
            ));
    
            foreach ($tickets as $ticket) {
                if ($ticket->status === 'vendido') {
                    $wpdb->update(
                        $wpdb->prefix . 'ticketflow_scans',
                        ['status' => 'quemado'],
                        ['ticket_id' => $ticket->ticket_id]
                    );
                }
            }
        }

 
function alekhart_sync_tickets_vendidos($request) {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';
        $insertados = [];
        
        // Obtener todas las órdenes completadas o en proceso
        $orders = wc_get_orders([
            'status' => ['completed', 'processing'],
            'limit'  => -1,
        ]);
        
        // Recorrer todas las órdenes
        foreach ($orders as $order) {
            foreach ($order->get_items() as $item) {
                $product_id = $item->get_product_id();
                $user_id    = $order->get_user_id();
                $event_id   = get_post_meta($product_id, '_event_id', true);
                $ticket_id  = $item->get_id();
                
                if (!$event_id) continue;  // Si no hay evento, continuar
    
                // Verificar si el evento ya fue insertado en la tabla
                $evento_ya_insertado = $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM $table WHERE event_id = %d", $event_id
                ));
                
                // Si el evento no ha sido insertado, continuar
                if (!$evento_ya_insertado) continue;
    
                // Evitar duplicados por ticket_id
                $ticket_ya_insertado = $wpdb->get_var($wpdb->prepare(
                    "SELECT COUNT(*) FROM $table WHERE ticket_id = %d", $ticket_id
                ));
                
                // Si el ticket ya fue insertado, continuar
                if ($ticket_ya_insertado) continue;
    
                // Insertar ticket en la base de datos
                $wpdb->insert($table, [
                    'ticket_id'   => $ticket_id,
                    'user_id'     => $user_id,
                    'event_id'    => $event_id,
                    'scan_status' => 'pendiente',
                    'scan_time'   => null,
                    'synced'      => 0, // Aún no sincronizado
                ]);
                
                // Agregar el ticket_id a la lista de insertados
                $insertados[] = $ticket_id;
            }
        }
        
        // Retornar la respuesta con los tickets insertados
        return rest_ensure_response([
            'success'    => true,
            'insertados' => $insertados,
        ]);
    }
}


// Agregar una acción de WordPress para ejecutar la función con un botón
function ejecutar_sincronizacion_con_boton() {
    if (isset($_POST['ejecutar_sincronizacion'])) {
        // Llama la función de sincronización
        $resultado = mep_sincronizar_eventos_y_asistentes();

        if (is_wp_error($resultado)) {
            echo 'Error: ' . $resultado->get_error_message();
        } else {
            echo 'Éxito: ' . $resultado->get_data()['message'];
        }
    }

    // Formulario con un botón para ejecutar la sincronización
    echo '<form method="POST">
            <input type="submit" name="ejecutar_sincronizacion" value="Sincronizar Eventos y Asistentes" class="button button-primary">
          </form>';
}

function load_jquery_ui() {
    wp_enqueue_script( 'jquery-ui-sortable' );
}
function cargar_jquery_ui() {
    // Asegúrate de cargar jQuery UI en el área de administración
    wp_enqueue_script('jquery-ui-sortable');  // jQuery UI ya está incluido en WordPress
}

// Función para obtener eventos desde la base de datos
function get_events_from_db(WP_REST_Request $request) {
    global $wpdb;

    // Definir la consulta SQL
    $query =  "
    SELECT 
        p.ID, 
        p.post_title, 
        MAX(CASE WHEN pm.meta_key = 'event_start_datetime' THEN pm.meta_value END) AS event_start_datetime,
        MAX(CASE WHEN pm.meta_key = 'event_end_datetime' THEN pm.meta_value END) AS event_end_datetime
    FROM {$wpdb->prefix}posts AS p
    LEFT JOIN {$wpdb->prefix}postmeta AS pm
        ON p.ID = pm.post_id
    WHERE p.post_type = 'mep_events'
    AND pm.meta_key IN ('event_start_datetime', 'event_end_datetime')
    GROUP BY p.ID
    ORDER BY event_start_datetime ASC
";

    // Ejecutar la consulta y obtener los resultados
    $events = $wpdb->get_results($query);

    if ($events) {
        // Devolver los eventos en formato JSON
        return new WP_REST_Response($events, 200);
    } else {
        // Si no hay eventos, devolver un mensaje
        return new WP_REST_Response('No se encontraron eventos.', 404);
    }
}


new WPRK_Plugin();