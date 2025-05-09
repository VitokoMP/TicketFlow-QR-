<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.0.4
 * Text-Domain: wp-react-ticketflow-qr 
 */

if ( ! defined( 'ABSPATH' ) ) exit; // No direct access allowed.
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
        tipo VARCHAR(255) NULL,
        PRIMARY KEY (id),
        KEY ticket_id (ticket_id),
        KEY event_id (event_id),
        KEY user_id (user_id),
        KEY scan_status (scan_status),
        FOREIGN KEY (ticket_id) REFERENCES {$wpdb->prefix}posts(ID) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES {$wpdb->prefix}posts(ID) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES {$wpdb->prefix}users(ID) ON DELETE SET NULL,
        UNIQUE KEY unique_ticket_scan (ticket_id, event_id)        

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
    
        // Tareas programadas y eventos
        add_action('init', [$this, 'schedule_ticket_update']);
        add_action('ticketflow_update_scans', [$this, 'update_scans']);
        add_action('save_post_event', [$this, 'ticketflow_trigger_on_event_publish'], 10, 3);
        add_action('init', [$this, 'insert_events_to_db']); // Inserta eventos al iniciar el plugin
    
        // REST API
        add_action('rest_api_init', [$this, 'create_rest_routes']);
    
        // Agregar página de menú con botón de sincronización
        add_action('admin_menu', function () {
            add_menu_page(
                'Sincronizar Eventos',
                'Sincronizar Eventos',
                'manage_options',
                'sincronizar_eventos',
                [$this, 'ejecutar_sincronizacion_con_boton'], // ← llamado correcto al método de clase
                'dashicons-update-alt',
                100
            );
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
        register_rest_route('ticketflow/v1', '/mep_sincronizar_eventos_y_asistentes', [
            'methods'  => 'GET',
            'callback' => [$this,'mep_sincronizar_eventos_y_asistentes'],
            'permission_callback' => '__return_true', // Temporalmente para pruebas
        ]);

        register_rest_route('ticketflow/v1', '/events', [
            'methods' => 'GET',
            'callback' => [$this, 'get_events_from_db'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route('ticketflow/v1', '/asistentes', [
            'methods' => 'GET',
            'callback' => 'mep_get_asistentes_by_event_ids',
            'permission_callback' => '__return_true', // ajusta según seguridad
        ]);
        
        register_rest_route('ticketflow/v1', '/eventos-activos', [
            'methods' => 'GET',
            'callback' => 'mep_get_eventos_activos',
            'permission_callback' => '__return_true',
        ]);
     }
 
function mep_sincronizar_eventos_y_asistentes() {

    global $wpdb;
    $tipo_evento = 'evento';
    $tipo_asistente = 'asistente';

    $wpdb->query("
    DELETE t1 FROM {$wpdb->prefix}ticketflow_scans t1
    INNER JOIN {$wpdb->prefix}ticketflow_scans t2 
    ON t1.event_id = t2.event_id 
    AND t1.id < t2.id
    WHERE t1.event_id IS NOT NULL
    AND t2.event_id IS NOT NULL");

    // Obtener eventos
    $events = $wpdb->get_results("
        SELECT 
            p.ID AS event_id, 
            p.post_title AS title, 
            start_meta.meta_value AS start_datetime, 
            end_meta.meta_value AS end_datetime
        FROM {$wpdb->prefix}posts AS p
        LEFT JOIN {$wpdb->prefix}postmeta start_meta 
            ON p.ID = start_meta.post_id AND start_meta.meta_key = 'event_start_datetime'
        LEFT JOIN {$wpdb->prefix}postmeta end_meta 
            ON p.ID = end_meta.post_id AND end_meta.meta_key = 'event_end_datetime'
        WHERE p.post_type = 'mep_events'
        ORDER BY start_meta.meta_value ASC
    ", ARRAY_A);

    if (empty($events)) {
        return new WP_REST_Response([
            'success' => false,
            'message' => 'No se encontraron eventos en la base de datos.'
        ], 404);
    }

    // Insertar o actualizar eventos
    foreach ($events as $event) {
        $event_id = $event['event_id'];
        $event_title = $event['title'] ?? '';
        $event_start = $event['start_datetime'] ?? null;
        $event_end = $event['end_datetime'] ?? null;

    
        // Verificar que los datos esenciales estén presentes
        if (!$event_start || !$event_end) continue;
    
        // Insertar o actualizar el evento
        $wpdb->query($wpdb->prepare("
            INSERT INTO {$wpdb->prefix}ticketflow_scans (event_id, event_title, event_start_date, event_end_date, synced, qr_code,tipo)
            VALUES (%d, %s, %s, %s, %d, %s, %s)
            ON DUPLICATE KEY UPDATE
                event_title = VALUES(event_title),
                event_start_date = VALUES(event_start_date),
                event_end_date = VALUES(event_end_date),
                synced = VALUES(synced),
                tipo = VALUES(tipo)
        ", $event_id, sanitize_text_field($event_title), $event_start, $event_end, 0, null,$tipo_evento));
    
        // Agregar el evento a la lista de eventos insertados o actualizados
        $eventos_insertados[] = ['event_id' => $event_id];
    }

    // Obtener asistentes y sincronizar scans
    $event_ids = array_column($events, 'event_id');
    $asistentes = $this->get_attendees_for_events($event_ids);
    foreach ($asistentes as $a) {
        $exists = $wpdb->get_var($wpdb->prepare("
            SELECT COUNT(*) 
            FROM {$wpdb->prefix}ticketflow_scans 
            WHERE ticket_id = %d AND event_id = %d
        ", $a['ticket_number'], $a['event_id']));
    
        if (!$exists) {
            $wpdb->query($wpdb->prepare("
                INSERT INTO {$wpdb->prefix}ticketflow_scans 
                (ticket_id, event_id, user_id, qr_code, scan_status, synced, tipo)
                VALUES (%d, %d, %d, %s, %s, %d, %s)
                ON DUPLICATE KEY UPDATE
                    user_id = VALUES(user_id),
                    qr_code = VALUES(qr_code),
                    scan_status = VALUES(scan_status),
                    synced = VALUES(synced),
                    tipo = VALUES(tipo)

            ", 
                $a['ticket_number'],
                $a['event_id'],
                $a['user_id'],
                $a['qr_code'],
                $a['scan_status'],
                $a['synced'],
                $a['tipo']
            ));
        }
    }
    
    return new WP_REST_Response([
        'success' => true,
        'message' => 'Sincronización completa.'
    ], 200);
}

// Función para traer eventos de la base de datos y que sucede!?
function mep_get_eventos_activos() {
    global $wpdb;
    $tabla = $wpdb->prefix . 'ticketflow_scans';

    $query = "
        SELECT 
            event_id, 
            event_title, 
            event_start_date, 
            event_end_date 
        FROM $tabla
        WHERE tipo = 'evento'
          AND event_end_date >= NOW()
        GROUP BY event_id
        ORDER BY event_start_date ASC
    ";

    $resultados = $wpdb->get_results($query);

    if (!$resultados) {
        return new WP_REST_Response(['message' => 'No hay eventos activos.'], 204);
    }

    return new WP_REST_Response($resultados, 200);
}

        // Función para obtener los asistentes de los eventos
    private function get_attendees_for_events($event_ids) {
        global $wpdb;

        if (empty($event_ids)) return [];

        // 1. Crear vista de eventos activos
        $wpdb->query("DROP VIEW IF EXISTS active_events");

        $wpdb->query("
            CREATE VIEW active_events AS
            SELECT
                e.ID AS event_id,
                e.post_title AS event_title,
                STR_TO_DATE(start_meta.meta_value, '%Y-%m-%d %H:%i:%s') AS start_datetime,
                STR_TO_DATE(end_meta.meta_value, '%Y-%m-%d %H:%i:%s') AS end_datetime
            FROM {$wpdb->prefix}posts e
            LEFT JOIN {$wpdb->prefix}postmeta start_meta 
                ON start_meta.post_id = e.ID AND start_meta.meta_key = 'event_start_datetime'
            LEFT JOIN {$wpdb->prefix}postmeta end_meta 
                ON end_meta.post_id = e.ID AND end_meta.meta_key = 'event_end_datetime'
            WHERE e.post_type = 'mep_events'
            AND e.post_status = 'publish'
            AND STR_TO_DATE(start_meta.meta_value, '%Y-%m-%d %H:%i:%s') <= NOW()
            AND STR_TO_DATE(end_meta.meta_value, '%Y-%m-%d %H:%i:%s') >= NOW()
        ");

        // 2. Insertar asistentes de eventos activos a tabla personalizada
        $wpdb->query("
            INSERT IGNORE INTO {$wpdb->prefix}ticketflow_scans (qr_code, event_id, scan_status)
            SELECT 
                a.post_name AS qr_code,
                CAST(event.meta_value AS UNSIGNED) AS event_id,
                'pending' AS scan_status
            FROM {$wpdb->prefix}posts a
            LEFT JOIN {$wpdb->prefix}postmeta event 
                ON event.post_id = a.ID AND event.meta_key = 'ea_event_id'
            LEFT JOIN active_events e 
                ON e.event_id = CAST(event.meta_value AS UNSIGNED)
            WHERE a.post_type = 'mep_events_attendees'
            AND e.event_id IS NOT NULL
        "); 

        // 3. Obtener los asistentes de los eventos indicados
        $placeholders = implode(',', array_fill(0, count($event_ids), '%d'));
        $sql = "
            SELECT * FROM {$wpdb->prefix}ticketflow_scans
            WHERE event_id IN ($placeholders)
        ";
        $prepared = $wpdb->prepare($sql, ...$event_ids);

        return $wpdb->get_results($prepared, ARRAY_A);
    }

    //funcion para obtener los asistentes por ID de evento
    function mep_get_asistentes_by_event_ids(WP_REST_Request $request) {
        $event_ids = $request->get_param('event_ids');
    
        if (!is_array($event_ids)) {
            return new WP_Error('invalid_param', 'Se requiere un array de IDs de evento.', ['status' => 400]);
        }
    
        $asistentes = get_attendees_for_events($event_ids);
    
        // Agrupar por evento
        $agrupado = [];
        foreach ($asistentes as $asistente) {
            $id = $asistente['event_id'];
            if (!isset($agrupado[$id])) $agrupado[$id] = [];
            $agrupado[$id][] = $asistente;
        }
    
        return rest_ensure_response(['asistentes' => $agrupado]);
    }
    

    function ejecutar_sincronizacion_con_boton() {
        if (isset($_POST['ejecutar_sincronizacion'])) {
            // Llama la función de sincronización
            $resultado = $this->mep_sincronizar_eventos_y_asistentes(); // ✅


            if (is_wp_error($resultado)) {
                echo '<div class="notice notice-error"><p>Error: ' . $resultado->get_error_message() . '</p></div>';
            } else {
                echo '<div class="notice notice-success"><p>Éxito: ' . $resultado->get_data()['message'] . '</p></div>';
            }
        }

        // Formulario con botón
        echo '
            <form method="POST" id="form-sincronizacion">
                <input type="submit" name="ejecutar_sincronizacion" value="Sincronizar Eventos y Asistentes" class="button button-primary" id="btn-sincronizar">
            </form>

            <script>
            document.addEventListener("DOMContentLoaded", function() {
                const btn = document.getElementById("btn-sincronizar");

                btn.addEventListener("click", function(e) {
                    console.log("Botón de sincronización clickeado");
                    // Aquí podrías agregar más lógica, como un tracking con GA, Matomo, o un fetch a tu endpoint.
                });
            });
            </script>
        ';
    }


    function load_jquery_ui() {
        wp_enqueue_script( 'jquery-ui-sortable' );
    }
    function cargar_jquery_ui() {
        // Asegúrate de cargar jQuery UI en el área de administración
        wp_enqueue_script('jquery-ui-sortable');  // jQuery UI ya está incluido en WordPress
    }

    function get_events_from_db(WP_REST_Request $request) {
        global $wpdb;
    
        $query = "
            SELECT 
                p.ID, 
                p.post_title, 
                start_meta.meta_value AS event_start_datetime,
                end_meta.meta_value AS event_end_datetime
            FROM {$wpdb->prefix}posts AS p
            LEFT JOIN {$wpdb->prefix}postmeta AS start_meta 
                ON p.ID = start_meta.post_id AND start_meta.meta_key = 'event_start_datetime'
            LEFT JOIN {$wpdb->prefix}postmeta AS end_meta 
                ON p.ID = end_meta.post_id AND end_meta.meta_key = 'event_end_datetime'
            WHERE p.post_type = 'mep_events'
            ORDER BY start_meta.meta_value ASC
        ";
    
        $events = $wpdb->get_results($query);
    
        if ($events) {
            $response = [];
    
            foreach ($events as $event) {
                $response[] = [
                    'id'                => $event->ID,
                    'title'             => $event->post_title,
                    'start_datetime'    => $event->event_start_datetime,
                    'end_datetime'      => $event->event_end_datetime,
                ];
            }
    
            return new WP_REST_Response($response, 200);
        } else {
            return new WP_REST_Response('No se encontraron eventos.', 404);
        }
    }
        
}

    

new WPRK_Plugin();