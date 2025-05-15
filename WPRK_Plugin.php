<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.0.4
 * Text-Domain: wp-react-ticketflow-qr 
 */
//estare activando la ruta para app escaner!

if ( ! defined( 'ABSPATH' ) ) exit; // No direct access allowed.
 /**
 * Define Plugins Constants
 */
define ( 'WPRK_PATH', trailingslashit( plugin_dir_path( __FILE__ ) ) );
define ( 'WPRK_URL', trailingslashit( plugins_url( '/', __FILE__ ) ) );


register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        error_log("FATAL ERROR: " . print_r($error, true));
    }
});
/**
 * Cargar el archivo de funciones de WordPress.
 */

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
//        add_action('init', [$this, 'schedule_ticket_update']);
//        add_action('ticketflow_update_scans', [$this, 'update_scans']);
//        add_action('save_post_event', [$this, 'ticketflow_trigger_on_event_publish'], 10, 3);
//        add_action('init', [$this, 'insert_events_to_db']); // Inserta eventos al iniciar el plugin
    
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
            'permission_callback' => function() {
                    return current_user_can('escanear_qr') || current_user_can('exportar_qr');
                },
//            'permission_callback' => '__return_true', // Temporalmente para pruebas
        ]);

        register_rest_route('ticketflow/v1', '/events', [
            'methods' => 'GET',
            'callback' => [$this, 'get_events_from_db'],
            'permission_callback' => function() {
    return current_user_can('escanear_qr') || current_user_can('exportar_qr');
},

        ]);

        register_rest_route('ticketflow/v1', '/sync-attendees/(?P<event_id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this,'ticketflow_sync_and_get_attendees'],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route('ticketflow/v1', '/asistentes/(?P<id>\d+)', [
            'methods' => 'POST',
            'callback' => [$this,'mep_get_asistentes_by_event_ids'],
            //'permission_callback' => function () {
              //  return current_user_can('escanear_qr') || current_user_can('exportar_qr');
            //},
            'permission_callback' => '__return_true', // ajusta según seguridad
        ]);
        
        register_rest_route('ticketflow/v1', '/eventos-activos', [
            'methods' => 'GET',
            'callback' => [$this,'mep_get_eventos_activos'],
            //'//permission_callback' => function() {
            //return current_user_can('escanear_qr') || current_user_can('exportar_qr');
        //},
          'permission_callback' => '__return_true', // ajusta según seguridad
        ]);
        
     }
 
public function mep_sincronizar_eventos_y_asistentes() {

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

    $event_ids = array_column($events, 'event_id');
    $asistentes = $this->get_attendees_for_events($event_ids);
    
    foreach ($asistentes as $a) {
        if (!isset($a['ticket_number'], $a['event_id'], $a['user_id'], $a['qr_code'])) {
            continue; // salta registros incompletos
        }
    
        $scan_status = isset($a['scan_status']) ? $a['scan_status'] : 'pending';
        $synced = isset($a['synced']) ? (int)$a['synced'] : 0;
        $tipo = isset($a['tipo']) ? $a['tipo'] : 'asistente';
    
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
                $scan_status,
                $synced,
                $tipo
            ));
        }
    }
    
    return new WP_REST_Response([
        'success' => true,
        'message' => 'Sincronización completa.'
    ], 200);
}

// Función para traer eventos de la base de datos y que sucede!?
public function mep_get_eventos_activos() {
    error_log('Entrando en la función mep_get_eventos_activos');
    
    global $wpdb;
    $tabla = $wpdb->prefix . 'ticketflow_scans';

    $query = "
            SELECT DISTINCT
            event_id,
            event_title,
            event_start_date,
            event_end_date,
            event_location
        FROM $tabla
        WHERE tipo = 'evento'
        AND event_end_date >= NOW()
        ORDER BY event_start_date ASC

    ";

    $resultados = $wpdb->get_results($query);

    if (!$resultados) {
        return new WP_REST_Response(['message' => 'No hay eventos activos.'], 204);
    }

    return new WP_REST_Response($resultados, 200);
}

function sync_attendees_to_scans_table($event_id) {
    global $wpdb;
     
    if(!is_array($event_ids)) {
        $event_ids = [$event_ids]; // Asegurarse de que sea un array
    }
    $totalInsertados = 0;
    // Obtener asistentes de la base de datos
    //  
    // Filtrar y validar los IDs de evento
    $total_event_ids = count($event_ids);// Asegúrate de que $event_ids sea un array
    if ($total_event_ids === 0) {
        error_log("No se recibieron IDs de evento válidos.");
        return new WP_Error('no_event_ids', 'No se proporcionaron IDs de evento válidos', ['status' => 400]);
    }
    foreach ($event_ids as $event_id) {
    $event_id = intval($event_id);
    if ($event_id <= 0) return;

    $wpdb->query($wpdb->prepare("
        INSERT IGNORE INTO {$wpdb->prefix}ticketflow_scans (qr_code, event_id, scan_status, tipo)
        SELECT 
            a.post_name AS qr_code,
            %d AS event_id,
            'pending' AS scan_status,
            'asistente' AS tipo
        FROM {$wpdb->prefix}posts a
        LEFT JOIN {$wpdb->prefix}postmeta ea ON ea.post_id = a.ID AND ea.meta_key = 'ea_event_id'
        WHERE a.post_type = 'mep_events_attendees'
            AND ea.meta_value = %d
    ", $event_id, $event_id));

    if ($wpdb->last_error) {
        error_log("Error insertando asistentes para evento $event_id: " . $wpdb->last_error);
    }
}

 function get_attendees_for_events($event_ids) {
    global $wpdb;

    $event_ids = array_filter(array_map('intval', (array)$event_ids));
    if (empty($event_ids)) {
        error_log("No se recibieron IDs de evento válidos.");
        return new WP_Error('no_event_ids', 'No se proporcionaron IDs de evento válidos', ['status' => 400]);
    }

    $placeholders = implode(',', array_fill(0, count($event_ids), '%d'));
    $sql = "
        SELECT * FROM {$wpdb->prefix}ticketflow_scans
        WHERE event_id IN ($placeholders)
    ";

    $prepared = $wpdb->prepare($sql, ...$event_ids);
    if (!$prepared) {
        return new WP_Error('sql_error', 'Error al preparar consulta SQL', ['status' => 500]);
    }

    $result = $wpdb->get_results($prepared, ARRAY_A);

    if ($wpdb->last_error) {
        error_log("Error al obtener asistentes: " . $wpdb->last_error);
        return new WP_Error('db_query_error', 'Error al consultar asistentes', ['status' => 500]);
    }

    return $result;
}


/**
 * FUNCION PARA OBTENER ASISTENTES POR EVENTOS
 */

 public function mep_get_asistentes_by_event_id($data) {
    $id = intval($data['id']);

    if (!$id) {
        return new WP_Error('invalid_id', 'ID de evento inválido.', ['status' => 400]);
    }

    $asistentes = get_attendees_for_events([$id]); // Asegúrate que esta función acepte array de IDs

    if (!is_array($asistentes)) {
        return new WP_Error('no_attendees', 'No se pudieron obtener asistentes.', ['status' => 500]);
    }

    return rest_ensure_response([
        'evento_id' => $id,
        'asistentes' => $asistentes
    ]);
}

    /**
     * Función para ejecutar la sincronización de eventos y asistentes al hacer clic en el botón.
     */

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

    function ticketflow_sync_and_get_attendees($request) {
    $event_id = intval($request['event_id']);
    if ($event_id <= 0) {
        return new WP_Error('invalid_event_id', 'El ID del evento no es válido', ['status' => 400]);
    }

    // Sincroniza
    sync_attendees_to_scans_table($event_id);

    // Obtiene asistentes ya sincronizados
    $attendees = get_attendees_for_event($event_id);

    return rest_ensure_response([
        'event_id' => $event_id,
        'total' => count($attendees),
        'attendees' => $attendees
    ]);
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
        //tenemos que ver este modo
    function mep_get_asistentes_by_event_ids(WP_REST_Request $request) { 
        $event_ids = (array) $request->get_param('event_ids'); // Forzamos a array

        if (empty($event_ids)) {
            return new WP_Error('invalid_param', 'Se requiere al menos un ID de evento.', ['status' => 400]);
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
}

new WPRK_Plugin();