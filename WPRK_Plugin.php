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
        //ruta principal para traer asistentes al evento activo.
        register_rest_route('ticketflow/v1', '/active-attendees', [
            'methods' => 'GET',
            'callback' => [$this, 'fetch_active_event_attendees'],
            'permission_callback' => '__return_true' // Cambia esto si necesitas autenticación
        ]);
        //traer eventos activos.
        register_rest_route('mep/v1', '/insert-eventos-desde-api', [
            'methods' => 'GET',
            'callback' => 'mep_insert_eventos_sin_duplicar',
            'permission_callback' => '__return_true',
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
    
        register_rest_route('ticketflow/v1', '/sincronizar', [
            'methods' => 'POST',
            'callback' => [$this, 'sync_data'],
            'permission_callback' => function () {
                return current_user_can('escanear_qr') || current_user_can('exportar_qr');
            }
        ]);
        register_rest_route('ticketflow/v1', '/tickets-vendidos', [
            'methods'  => 'POST', // Cambiado a POST porque enviarás datos
            'callback' => 'alekhart_sync_tickets_vendidos',
            'permission_callback' => function() {
                return current_user_can('manage_options'); // Cambiar esto según el permiso que necesites
            },
        ]);
    }

    // Activar la tarea programada
    public function schedule_ticket_update() {
        if (!wp_next_scheduled('ticketflow_update_scans')) {
            wp_schedule_event(time(), 'hourly', 'ticketflow_update_scans');
        }
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

        function mep_sincronizar_eventos_y_asistentes() {
            global $wpdb;
        
            // Paso 1: Obtener eventos de la API
            $url = 'http://localhost/wordpress/wp-json/wp/v2/mep_events';
            $response = wp_remote_get($url);
            if (is_wp_error($response)) {
                return new WP_Error('api_error', 'Error al obtener eventos de la API', ['status' => 500]);
            }
        
            $eventos = json_decode(wp_remote_retrieve_body($response), true);
            if (empty($eventos)) {
                return new WP_Error('no_events', 'No se encontraron eventos', ['status' => 404]);
            }
        
            $eventos_insertados = [];
        
            // Paso 2: Procesar eventos
            foreach ($eventos as $evento) {
                if (isset($evento['id'], $evento['title']['rendered'], $evento['event_start_datetime'])) {
                    $event_title = sanitize_text_field($evento['title']['rendered']);
                    $event_start = date('Y-m-d H:i:s', strtotime($evento['event_start_datetime']));
        
                    // Verificar si el evento ya existe por fecha y título
                    $exists = $wpdb->get_var($wpdb->prepare(
                        "SELECT COUNT(*) FROM {$wpdb->prefix}ticketflow_scans 
                         WHERE event_start_date = %s AND event_title = %s",
                        $event_start, $event_title
                    ));
        
                    if (!$exists) {
                        $wpdb->insert("{$wpdb->prefix}ticketflow_scans", [
                            'event_id'         => intval($evento['id']),
                            'event_title'      => $event_title,
                            'event_start_date' => $event_start,
                            'event_end_date'   => date('Y-m-d H:i:s', strtotime($evento['event_end_datetime'])),
                            'event_location'   => sanitize_text_field($evento['mep_location_venue'][0] ?? ''),
                            'synced'           => 0,
                            'qr_code'          => null,
                        ]);
                        $eventos_insertados[] = ['event_id' => intval($evento['id'])];
                    }
                }
            }
        
            // Paso 3: Extraer los event_ids de los eventos insertados
            $event_ids = extract_event_ids($eventos_insertados);
        
            // Paso 4: Obtener asistentes para esos eventos
            if (empty($event_ids)) {
                return new WP_REST_Response(['message' => 'No se insertaron nuevos eventos.'], 200);
            }
        
            $asistentes = get_attendees_for_events($event_ids);
        
            // Paso 5: Procesar los asistentes
            foreach ($asistentes as $a) {
                if (empty($a['ticket_number']) || empty($a['event_id'])) continue;
        
                // Verificar si el asistente ya está registrado con ticket y evento
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
        
            return new WP_REST_Response([
                'success' => true,
                'message' => 'Eventos y asistentes sincronizados correctamente.',
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
        // pendiente
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

// Instanciar la clase
new WPRK_Plugin();