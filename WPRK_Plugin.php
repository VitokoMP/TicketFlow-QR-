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

    // Cargar jQuery UI Sortable solo en esta página
    wp_enqueue_script('jquery-ui-sortable');

    wp_enqueue_script(
        'my-react-app',
        WPRK_URL . 'dist/bundle.js',
        ['wp-element', 'jquery', 'jquery-ui-sortable'], // Aseguramos que jQuery esté antes
        null,
        true
    );

    wp_localize_script('my-react-app', 'appLocalizer', [
        'apiUrl' => esc_url(rest_url('wprk/v1')),
        'nonce' => wp_create_nonce('wp_rest'),
    ]);
}
    /**
     * Crear las rutas de la API REST.
     */

    public function create_rest_routes() {
        register_rest_route('ticketflow/v1', '/mep_sincronizar_eventos_y_asistentes', [
            'methods'  => 'POST',
            'callback' => [$this,'mep_sincronizar_eventos_y_asistentes'],
            //'permission_callback' => function() {
            //        return current_user_can('escanear_qr') || current_user_can('exportar_qr');
             //   },
            'permission_callback' => '__return_true', // Temporalmente para pruebas
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

   // error_log('Entrando en la función mep_sincronizar_eventos_y_asistentes');

    global $wpdb;
    $tipo_evento = 'evento';
    $tipo_asistente = 'asistente';/*
//esta query hace un delete de los registros duplicados
    $wpdb->query("
    DELETE t1 FROM {$wpdb->prefix}ticketflow_scans t1
    INNER JOIN {$wpdb->prefix}ticketflow_scans t2 
    ON t1.event_id = t2.event_id 
    AND t1.id < t2.id
    WHERE t1.event_id IS NOT NULL
    AND t2.event_id IS NOT NULL");*/

    // Obtener eventos
    $events = $wpdb->get_results("
        SELECT 
            p.ID AS event_id, 
            p.post_title AS title, 
            start_meta.meta_value AS start_datetime, 
            end_meta.meta_value AS end_datetime
        FROM {$wpdb->prefix}posts AS p
        LEFT JOIN {$wpdb->prefix}postmeta start_meta 
            ON p.ID = start_meta.post_id AND start_meta.meta_key >= 'event_start_datetime'
        LEFT JOIN {$wpdb->prefix}postmeta end_meta 
            ON p.ID = end_meta.post_id AND end_meta.meta_key >= 'event_end_datetime'
        WHERE p.post_type = 'mep_events'
        ORDER BY start_meta.meta_value ASC
    ", ARRAY_A);// Cambié a ARRAY_A para obtener un array asociativo
//como puedo ver los eventos insertados? ycomo obetener la asociacion de campos desde el select hacia react.
//    $eventos_insertados = [];
    // Verificar si se encontraron eventos
    //en el desarrollo de esta funcion. 
    /**
     * if (empty($events)) { //entonces tendras que: llamar a la funcion de eventos activos
           // error_log('No se insertaron eventos en la tickeflow_scans.');

            // Llamar a la función de eventos activos
            $activos_response = $this->mep_get_eventos_activos();
            // Verificar si hay resultados (el código 200 asegura que vienen eventos)
            
            if ($activos_response->get_status() === 200) {
                $activos = $activos_response->get_data();
                // Obtener solo los IDs de los eventos activos
                $event_ids = array_map(function($evento) {
                    return intval($evento->event_id);
                }, $activos);
                // Llamar a la función de sincronización de asistentes
                $asistentes = $this->sync_attendees_to_scans_table($events);//--- aqui van los ids de eventos activos
                //pero la duda es si los activos[] son distintos a los event _ids[]
            }
     */
        // Insertar o actualizar eventos en la tabla ticketflow_scans
        foreach ($events as $event) {
            $event_id = $event['event_id'];
            $event_title = $event['title'] ?? '';
            $event_start = $event['start_datetime'] ?? null;
            $event_end = $event['end_datetime'] ?? null;
            $tipo_evento = 'evento'; // si no viene de otro lado

        
            // Verificar que los datos esenciales estén presentes
            if (!$event_start || !$event_end) continue;
        
            // Insertar o actualizar el evento
            $wpdb->query($wpdb->prepare("
                INSERT INTO {$wpdb->prefix}ticketflow_scans  (event_id, event_title, event_start_date, event_end_date, synced, qr_code, tipo)
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
        // porfavor revisa el doble $$ --- errores clasicos.
        $event_ids = array_map('intval', array_column($events, 'event_id'));
        if (empty($event_ids)) {
            return new WP_REST_Response([
                'success' => false,
                'message' => 'No se encontraron eventos para sincronizar asistentes.'
            ], 404);
        }
       // error_log('Eventos activos encontrados: ' . print_r($activos, true));
        //error_log('IDs a sincronizar: ' . implode(',', $event_ids));

    //**
    // Aqui estamos trabajando con los asistentes 
    //  */
    // Obtener asistentes de la base de datos
    
    // si activos_response esta vacio entonces no hay eventos activos, pero si trae datos y $$event_id, Event_ids no, entonces usamos el array de activos response.
    // me refiero a que 
    $asistentes = $this->sync_attendees_to_scans_table($event_ids); //el event_ids es un array de ids de eventos
    if (empty($asistentes)) {
        return new WP_REST_Response([
            'success' => false,
            'message' => 'No se encontraron asistentes para sincronizar.'
        ], 404);
    }
    
    foreach ($asistentes as $a) {
        if (!isset($a['ticket_number'], $a['event_id'], $a['user_id'], $a['qr_code'])) {
            continue; // salta registros incompletos
        }
    
        $scan_status = isset($a['scan_status']) ? $a['scan_status'] : 'pending';
        $synced = isset($a['synced']) ? (int)$a['synced'] : 0;
        $tipo = isset($a['tipo']) ? $a['tipo'] : 'asistente';
        // Verificar que los datos esenciales estén presentes   
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
                $tipo//KIND OF VALUE    -->$_COOKIE['tipo_asistente']
            ));//
        }// Agregar el asistente a la lista de asistentes insertados o actualizados
    //error_log("Insertando ticket: {$a['ticket_number']} para evento: {$a['event_id']}");
        return new WP_REST_Response([
        'success' => true,
        'message' => 'Sincronización completa.'
    ], 200);// 200 OK
    

}//

// Función para traer eventos de la base de datos y que sucede!?
// esta necesita se llamada desde la funcion que si no encuentra el tramo principal de eventos insertados
// venga a esta funcion y llame a la funcion de eventos activos, asi luego vemos los que ya insertó los vemos,
// los traemos y los usamos para la sincronización de asistentes con los eventos activos. 
//* necesito que los eventos esten asociados a los productores.
//* y que los eventos activos sean los que tengan fecha de inicio y fin en el futuro
//---------------------------------------------------------------------------------------------------------------!
//***   █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█ ▄▄▄▄▄ █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█                                                            ***//
//***   █ ███ █ █ █ ███ █ █   █ █ ███ █ █ █ ███ █                                                            ***//
//***   █ ▀▀▀ █ █ █ ▀▀▀ █ █   █ █ ▀▀▀ █ █ █ ▀▀▀ █                                                            ***//
//***   ▀▀▀▀▀▀▀ ▀ ▀▀▀▀▀▀▀ ▀▀▀▀▀ ▀▀▀▀▀▀▀ ▀ ▀▀▀▀▀▀▀                                                            ***//
//***   █ ▄▄█▀▄▀█ ▄█ ▀▀▀▄ █ ▄▀▄ ▄▀▄ █ ▄▄█▀▄▀█ █▀▀▀█                                                            ***//
//***   █ ▀▀ ▄█▀▀▄ █▄█ ▄ █ █ ▀▀ ▀▀ █ █ ▀▀ ▄█▀▀▄ ▀▀▀▄                                                            ***//
//***   █ █▀ █▄▀▄▀▀ ▄▄▀▀▄▀ ▄▄▀ ▄▄▀ █ █▀ █▄▀▄▀▀ █▀▀▀                                                            ***//
//***   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ //
//***   █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█ ▄▄▄▄▄ █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█                                                            ***//
//***   █ ███ █ █ █ ███ █ █   █ █ ███ █ █ █ ███ █                                                            ***//
//***   █ ▀▀▀ █ █ █ ▀▀▀ █ █   █ █ ▀▀▀ █ █ █ ▀▀▀ █                                                            ***//
//---------------------------------------------------------------------------------------------------------------!
public function mep_get_eventos_activos() {
    //error_log('Entrando en la función mep_get_eventos_activos');
    
    global $wpdb;
    $tabla = $wpdb->prefix . 'ticketflow_scans';
//
//*** Quieren insertarle un filtro al productor para que puedan venderle ticketeras a los productores. *
//  --- ahora que etreno la mente, me toca ver como lo he logrado mejorar, gracias a lograr ser ayudante general.-
//***   █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█ ▄▄▄▄▄ █▀▀▀▀▀█ ▀█ █▀▀▀▀▀█                                                            ***//
// ***/
//preparando el selector para que solo traiga eventos activos
    $query =
    "       SELECT DISTINCT
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
        return new WP_REST_Response([], 200);
    }

    return new WP_REST_Response($resultados, 200);
}
//**
// Aqui esta la funcion que desarralloste durante un mes.
//  * Función para sincronizar asistentes a la tabla de escaneos
//  * Lo mas honesto que me ha tocado es saber quien está presente y quien no.
//  * @param array $event_ids IDs de eventos a sincronizar
//  * @return int Número de asistentes sincronizados
//  */
function sync_attendees_to_scans_table($event_ids) {
    //error_log('Entrando en la función sync_attendees_to_scans_table');
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
        //error_log("No se recibieron IDs de evento válidos.");
        return new WP_Error('no_event_ids', 'No se proporcionaron IDs de evento válidos', ['status' => 400]);
    }
    foreach ($event_ids as $event_id) {
        $event_id = intval($event_id);
            if ($event_id <= 0) { //validamos que el id sea un entero <= 0 para evitar inyecciones sql
               // error_log("ID de evento inválido: $event_id");
                continue;
        }
     // Verificar si el evento ya está sincronizado
 
    $result = $wpdb->query($wpdb->prepare("
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
    ", $event_id, $event_id));//INSERTANDO LOS ASISTENTES EN LA TABLA DE ESCANEOS

    if ($wpdb->last_error) {
        error_log("Error insertando asistentes para evento $event_id: " . $wpdb->last_error);
    }
    if ($result !== false) {
            $totalInsertados += $result;
           // error_log("Insertados $result asistentes para evento $event_id");
        } else {
           // error_log("No se insertaron asistentes para evento $event_id");
        }    
    }
        //RESULTADO DE LA CONSULTA
    return $totalInsertados;

}
// Función para obtener asistentes de eventos específicos
// Esta función obtiene los asistentes de eventos específicos
 public function get_attendees_for_events($event_ids) {
    global $wpdb;

    $event_ids = array_filter(array_map('intval', (array)$event_ids));
    if (empty($event_ids)) {
       // error_log("No se recibieron IDs de evento válidos.");
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
        //error_log("Error al obtener asistentes: " . $wpdb->last_error);
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

public function ejecutar_sincronizacion_con_boton() {
    if (isset($_POST['ejecutar_sincronizacion'])) {
        //error_log("Ejecutando sincronización desde botón");

        $resultado = $this->mep_sincronizar_eventos_y_asistentes(); // tu función real

        if (is_wp_error($resultado)) {
            echo '<div class="notice notice-error"><p>Error: ' . $resultado->get_error_message() . '</p></div>';
        } else {
            echo '<div class="notice notice-success"><p>Éxito: ' . $resultado->get_data()['message'] . '</p></div>';
        }
    }

    echo '
        <form method="POST" id="form-sincronizacion">
            <input type="submit" name="ejecutar_sincronizacion" value="Sincronizar Eventos y Asistentes" class="button button-primary" id="btn-sincronizar">
        </form>
    ';
}



    function load_jquery_ui() {
        wp_enqueue_script( 'jquery-ui-sortable' );
    }
    function cargar_jquery_ui() {
        // Asegúrate de cargar jQuery UI en el área de administración
        wp_enqueue_script('jquery-ui-sortable');  // jQuery UI ya está incluido en WordPress
    }
//**    
    /**
     * Función para sincronizar y obtener asistentes de un evento específico.
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response
     */
    /**
     * Función para sincronizar y obtener asistentes de un evento específico.
     *
     * @param WP_REST_Request $request
     * @return WP_REST_Response
  */
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