<?php
class TicketFlow_REST_API {
    private static $instance;

    public static function instance() {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        add_action('rest_api_init', [$this, 'register_routes']);
        
            // Endpoint para mantener sesión

        add_action('wp_ajax_ticketflow_heartbeat', [$this, 'heartbeat']);

        // Endpoint REST para estadísticas
        ///
        //add_action('rest_authentication_errors', [$this, 'enforce_authentication']);
    }

    /**
     * Configuración de CORS segura
     */
    public function add_cors_headers() {
        $origin = get_http_origin();
        $allowed_origins = [
            home_url(), // Tu sitio principal
            admin_url(), // Admin de WordPress
            // Añade otros dominios permitidos si es necesario
        ];

        if (in_array($origin, $allowed_origins)) {
            header("Access-Control-Allow-Origin: $origin");
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
            header('Access-Control-Allow-Credentials: true');
            header('Access-Control-Allow-Headers: X-WP-Nonce, Content-Type, Authorization');
        }
    }

    /**
     * Verificación de autenticación para endpoints REST
     */
    public function enforce_authentication($result) {
       /* if (!empty($result)) {
            return $result;
        }

        // Solo aplica a nuestros endpoints
        if (strpos($_SERVER['REQUEST_URI'], '/ticketflow/v1/') === false) {
            return $result;
        }

        // Verificar autenticación
        if (!is_user_logged_in()) {
            return new WP_Error(
                'rest_not_logged_in',
                __('Debes iniciar sesión para acceder a este endpoint.', 'wp-react-ticketflow-qr'),
                ['status' => 401]
            );
        }

        return $result;*/
    }

    /**
     * Verificación de permisos para endpoints
     */
    public function verify_request_permissions() {
        // Verificar nonce
        $nonce = $_SERVER['HTTP_X_WP_NONCE'] ?? '';
        if (!wp_verify_nonce($nonce, 'wp_rest')) {
            return new WP_Error(
                'rest_invalid_nonce',
                __('Nonce de seguridad inválido.', 'wp-react-ticketflow-qr'),
                ['status' => 403]
            );
        }

        // Verificar cookies de autenticación
        if (!is_user_logged_in()) {
            return new WP_Error(
                'rest_not_logged_in',
                __('Debes iniciar sesión para acceder a este recurso.', 'wp-react-ticketflow-qr'),
                ['status' => 401]
            );
        }

        return true;
    }


    public function register_routes() {
        
         register_rest_route('ticketflow/v1', '/bulk-mark-scanned', [
        'methods' => 'POST',
        'callback' => [ $this, 'mark_multiple_as_scanned' ],
        'permission_callback' => '__return_true' /* => function() {
            return current_user_can('edit_posts');
            },
            'args' => [
                'ids' => [
                    'required' => true,
                    'type' => 'array',
                    'items' => [
                        'type' => 'integer'
                    ],
                    'validate_callback' => function($ids) {
                        return count($ids) <= 100; // Límite por seguridad
                    }
                ]
            ]*/
        ]);
        //Endpoint Para obtener el NONCE!
        register_rest_route('ticketflow/v1', '/get-nonce', [
            'methods' => 'GET',
            'callback' => [$this, 'get_nonce'],
            'permission_callback' => '__return_true'
        ]);
        
        register_rest_route('ticketflow/v1', '/stats', [
            'methods'  => 'GET',
            'callback' => function($request) {
                $user_id = get_current_user_id();
                return [
                    'events' => count_user_posts($user_id, 'tf_event'),
                    'tickets' => (int) get_user_meta($user_id, 'tf_tickets_sold', true),
                ];
            },
            'permission_callback' => '__return_true'
           // 'permission_callback' => function() {
           //     return current_user_can('ticketflow_view_dashboard');
           // }
        ]);

        // Ejemplo de endpoint protegido
        register_rest_route('ticketflow/v1', '/protected-endpoint', [
            'methods' => 'POST',
            'callback' => [$this, 'protected_endpoint_handler'],
            'permission_callback' => '__return_true'
            //'permission_callback' => [$this, 'verify_request_permissions']
        ]);

        register_rest_route('ticketflow/v1', '/eventos', [
            'methods' => 'GET',
            'callback' => [$this, 'obtener_eventos'],
            'permission_callback' => '__return_true'
            //'permission_callback' => function() {
            //    return current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');
           // }
        ]);

        // Registrar la ruta para sincronizar eventos y asistentes-- ok
        register_rest_route('ticketflow/v1', '/mep_sincronizar_eventos_y_asistentes', [
            'methods'  => 'POST',
            'callback' => [$this,'mep_sincronizar_eventos_y_asistentes'],
           // 'permission_callback' => function() {
           //        return current_user_can('ticketflow_export_qr');
            //  },
            'permission_callback' => '__return_true' // Temporalmente para pruebas
        ]);

        // Registrar la ruta para obtener eventos --ok
        register_rest_route('ticketflow/v1', '/events', [
            'methods' => 'GET',
            'callback' => [$this, 'get_events_from_db'],
           // 'permission_callback' => function() {
           // return current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');},
           'permission_callback' => '__return_true'
        ]);

        register_rest_route('ticketflow/v1', '/sync-attendees/(?P<event_id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'ticketflow_sync_and_get_attendees'],
            'permission_callback' => '__return_true'
        // 'permission_callback' => function() {
        //        return  current_user_can('ticketflow_export_qr');
        //    },
        ]);

        // Registrar la ruta para obtener asistentes por evento --ok
        register_rest_route('ticketflow/v1', '/asistentes', [
            'methods' => 'GET',
            'callback' => [$this,'mep_get_asistentes_by_event_ids'],
            //'permission_callback' => function () {
            //  return current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');
           // },
        'permission_callback' => '__return_true' // ajusta según seguridad
        ]);
        
        // Registrar la ruta para obtener eventos activos--ok
        register_rest_route('ticketflow/v1', '/eventos-activos', [
            'methods' => 'GET',
            'callback' => [$this, 'mep_get_eventos_activos'],
            'permission_callback' => '__return_true'
           /* 'permission_callback' => function() {
                // 1. Verificar si el usuario está autenticado
                if (!is_user_logged_in()) {
                    error_log('Usuario no autenticado');
                    return false;
                }

                $user = wp_get_current_user();
                error_log('Roles del usuario: ' . print_r($user->roles, true));
                error_log('Capacidades del usuario: ' . print_r($user->allcaps, true));

                // 2. Verificar si tiene un rol permitido (administrador, productor o escaneador)
                $allowed_roles = ['administrator', 'ticketflow_productor', 'escaneador'];
                if (array_intersect($allowed_roles, $user->roles)) {
                    return true;
                }

                // 3. Si no tiene un rol permitido, verificar capacidades específicas
                $has_access = current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');
                if (!$has_access) {
                    error_log('El usuario no tiene permisos para acceder al endpoint.');
                }
                return $has_access;
            }*/
        ]);

        // Registrar la ruta para obtener el estado de escaneo por QR--pendiente
        register_rest_route('ticketflow/v1', '/escanear/(?P<event_id>\d+)/(?P<qr_code>[a-zA-Z0-9\-]+)', [
            'methods' => 'GET',
            'callback' => function($request) {
            $event_id = intval($request['event_id']);
            $qr_code = sanitize_text_field($request['qr_code']);
            return $this->get_scan_status_by_qr($event_id, $qr_code);
            },
            //'permission_callback' => function() {
            //return current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');
           // },
            'permission_callback' => '__return_true' // ajusta según seguridad
        ]);

        // Registrar la ruta para marcar un ticket como escaneado
        register_rest_route('ticketflow/v1', '/mark-as-scanned/(?P<id>\d+)', [
            'methods' => ['POST','GET'],
            'callback' => [$this, 'mark_as_scanned'],
            'permission_callback' => '__return_true' // Ajusta según seguridad
           // 'permission_callback' => function() {
            //return current_user_can('ticketflow_scan_qr') || current_user_can('ticketflow_export_qr');
           // },
        ]); 
    }

    // Mover aquí todas tus funciones de callback para los endpoints
    public function obtener_eventos() {
        // Implementación actual...
    }

    //********************************######
    // Principal Conección con el Frontend##
    // #####################################
    //****************************#########*/

        public function heartbeat() {
            check_ajax_referer('wp_rest', '_wpnonce');
            wp_send_json_success(['status' => 'active']);
        }

    public function get_nonce() {
        return new WP_REST_Response([
            'nonce' => wp_create_nonce('wp_rest'),
            'cookie_name' => LOGGED_IN_COOKIE
        ], 200);
    }

    public function protected_endpoint_handler(WP_REST_Request $request) {
        // Tu lógica de endpoint aquí
        return new WP_REST_Response(['success' => true], 200);
    }
    
    function ticketflow_redirigir_escaneadores() {
    if (current_user_can('escaneador') && !defined('DOING_AJAX')) {
                $allowed_pages = ['wprk-settings', 'profile.php'];
                $current_page = $_GET['page'] ?? '';
                
                if (!in_array($current_page, $allowed_pages)) {
                    wp_redirect(admin_url('admin.php?page=wprk-settings'));
                    exit;
                }
            } 
                if (current_user_can('escaneador')) {
                error_log('Capacidades del escaneador: ' . print_r(wp_get_current_user()->allcaps, true));
            }
        
                if (current_user_can('escaneador')) {
            error_log('El usuario tiene rol escaneador');
            
            if (current_user_can('manage_wprk_plugin')) {
                error_log('El usuario tiene la capacidad manage_wprk_plugin');
            }
        }
    }
    // Limpieza del menú
    function ticketflow_limpiar_menu() {
        if (current_user_can('escaneador') ){
            remove_menu_page('index.php'); // Dashboard
            remove_menu_page('edit.php'); // Posts}
        }

    }

            //Obtengo los asistentes a evento segun seleccion 
    public function mep_get_asistentes_by_event_ids(WP_REST_Request $request) { 
                    $event_ids = (array) $request->get_param('event_ids');

                    if (empty($event_ids)) {
                        return new WP_Error('invalid_param', 'Se requiere al menos un ID de evento.', ['status' => 400]);
                    }

                    $asistentes = $this->get_attendees_for_events($event_ids);

                    $agrupado = [];
                    foreach ($asistentes as $asistente) {
                        $id = $asistente['event_id'];
                        if (!isset($agrupado[$id])) $agrupado[$id] = [];
                        $agrupado[$id][] = $asistente;
                    }

                    return rest_ensure_response(['asistentes' => $agrupado]);
                }
                
                    public function mark_as_scanned($request) {
                    global $wpdb;
                    $table = $wpdb->prefix . 'ticketflow_scans';
                    $id = intval($request['id']);

                    // Iniciar transacción
                    $wpdb->query('START TRANSACTION;');

                    // Bloquear fila para evitar race conditions
                    $asistente = $wpdb->get_row($wpdb->prepare("
                        SELECT id, scan_status, scan_time, user_id 
                        FROM $table 
                        WHERE id = %d FOR UPDATE
                    ", $id), ARRAY_A);

                    if (!$asistente) {
                        $wpdb->query('ROLLBACK;');
                        return new WP_REST_Response([
                            'success' => false,
                            'status' => 'NOT_FOUND',
                            'mensaje' => 'No se encontró el asistente con ese ID.'
                        ], 404);
                    }

                    if ($asistente['scan_status'] !== 'pending') {
                        $wpdb->query('ROLLBACK;');
                        return new WP_REST_Response([
                            'success' => false,
                            'status' => 'ALREADY_SCANNED',
                            'mensaje' => 'Este asistente ya fue validado anteriormente.',
                            'asistente' => $asistente
                        ], 200);
                    }

                    // Marcar como escaneado
                    $asistente['scan_status'] = 'scanned';
                    $asistente['scan_time']   = current_time('mysql');

                    $update = $wpdb->update(
                        $table,
                        [
                            'scan_status' => $asistente['scan_status'],
                            'scan_time'   => $asistente['scan_time']
                        ],
                        ['id' => $id],
                        ['%s','%s'],
                        ['%d']
                    );

                    if ($update === false) {
                        $wpdb->query('ROLLBACK;');
                        return new WP_REST_Response([
                            'success' => false,
                            'status' => 'ERROR',
                            'mensaje' => 'Error al actualizar el estado en la base de datos.'
                        ], 500);
                    }

                    // Confirmar cambios
                    $wpdb->query('COMMIT;');

                    return new WP_REST_Response([
                        'success' => true,
                        'status' => 'UPDATED',
                        'mensaje' => 'Asistente marcado como escaneado.',
                        'asistente' => $asistente
                    ], 200);
                }



                /**function get_scan_status_by_qr($qr_code) {
                    Estoy realizandola conexion con los asistentes.
                    */
            public function get_scan_status_by_qr($event_id, $qr_code) {
    global $wpdb;
    $table = $wpdb->prefix . 'ticketflow_scans';

    // Intentamos localizar el asistente para este evento
    $asistente = $wpdb->get_row($wpdb->prepare("
        SELECT id, qr_code, scan_status, scan_time, event_id, event_title
        FROM $table
        WHERE event_id = %d AND qr_code = %s AND tipo = 'asistente'
        LIMIT 1
    ", $event_id, $qr_code), ARRAY_A);

    if ($asistente) {
        return [
            'success' => true,
            'status'  => $asistente['scan_status'] === 'pending' ? 'PENDING' : 'ALREADY_SCANNED',
            'asistente' => $asistente,
            'mensaje' => $asistente['scan_status'] === 'pending'
                ? 'Asistente válido y pendiente de validación.'
                : 'Este asistente ya fue validado.'
        ];
    }

    // Si no pertenece a este evento, verificamos si existe en otro
    $otro = $wpdb->get_row($wpdb->prepare("
        SELECT id, qr_code, scan_status, scan_time, event_id, event_title
        FROM $table
        WHERE qr_code = %s AND tipo = 'asistente'
        LIMIT 1
    ", $qr_code), ARRAY_A);

    if ($otro) {
        return [
            'success' => false,
            'status' => 'MISMATCH',
            'asistente' => $otro,
            'mensaje' => 'Este código pertenece a otro evento.'
        ];
    }

    return [
        'success' => false,
        'status' => 'NOT_FOUND',
        'mensaje' => 'Este código QR no está registrado.'
    ];
}


            /**
             * Sabremos cuidar lo que nos importa, aca avanzamos para organizar los estados.
            * MAntenga el foco

            */ 

            public function mep_sincronizar_eventos_y_asistentes() {

            if (get_transient('sync_lock')) {
        return new WP_REST_Response([
            'success' => false,
            'message' => 'Sincronización ya en progreso'
        ], 429);
    }
    set_transient('sync_lock', 1, 60);
                $eventos_insertados = []; // Añade esto al inicio de tu función
                error_log('Entrando en la función mep_sincronizar_eventos_y_asistentes');

                global $wpdb;
                $tipo_evento = 'evento';
                $tipo_asistente = 'asistente';
            //esta query hace un delete de los registros duplicados
                $wpdb->query("
                DELETE t1 FROM {$wpdb->prefix}ticketflow_scans t1
                INNER JOIN {$wpdb->prefix}ticketflow_scans t2 
                ON t1.event_id = t2.event_id 
                AND t1.event_start_date < t2.event_start_date
                WHERE t1.tipo = 'evento' 
                AND t2.tipo = 'evento'");

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
                ", ARRAY_A);// Cambié a ARRAY_A para obtener un array asociativo
            //como puedo ver los eventos insertados? ycomo obetener la asociacion de campos desde el select hacia react.
            //    $eventos_insertados = [];
                // Verificar si se encontraron eventos
                //en el desarrollo de esta funcion. 
                /** 
                 */
                    // Insertar o actualizar eventos en la tabla ticketflow_scans
                    foreach ($events as $event) {
                        $event_id = intval($event['event_id']);
                        $event_title = sanitize_text_field($event['title'] ?? '');
                        $event_start = !empty($event['start_datetime']) ? sanitize_text_field($event['start_datetime']) : null;
                        $event_end = !empty($event['end_datetime']) ? sanitize_text_field($event['end_datetime']) : null;
                        $tipo_evento = 'evento';

                        if (!$event_start || !$event_end) {
                        error_log("Evento ID {$event_id} omitido: falta fecha inicio o fin.");
                        continue;
                        }


                        $wpdb->query($wpdb->prepare("
                            INSERT INTO {$wpdb->prefix}ticketflow_scans (event_id, event_title, event_start_date, event_end_date, synced, qr_code, tipo)
                            VALUES (%d, %s, %s, %s, %d, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                event_title = VALUES(event_title),
                                event_start_date = VALUES(event_start_date),
                                event_end_date = VALUES(event_end_date),
                                synced = VALUES(synced),
                                tipo = VALUES(tipo)
                        ", $event_id, $event_title, $event_start, $event_end, 0, null, $tipo_evento));

                        $eventos_insertados[] = ['event_id' => $event_id];
                    }
                    // porfavor revisa el doble $$ --- errores clasicos.
                    $event_ids = array_map('intval', array_column($events, 'event_id'));
                    if (empty($event_ids)) {
                        return new WP_REST_Response([
                            'success' => false,
                            'message' => 'No se encontraron eventos para sincronizar .'
                        ], 404);
                    }
            
                //**
                // Aqui estamos trabajando con los asistentes 
                //  */
                // Obtener asistentes de la base de datos 


            // Ahora sincroniza asistentes para todos los eventos
                $total_asistentes = $this->sync_attendees_to_scans_table($event_ids);

                return new WP_REST_Response([
                    'success' => true,
                    'message' => 'Sincronización completa.',
                    'eventos_insertados' => $eventos_insertados,
                    'total_asistentes' => $total_asistentes
                ], 200);

            }

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

            public function mep_get_eventos_activos(WP_REST_Request $request) {
                error_log('Entrando en la función mep_get_eventos_activos');
                
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
                global $wpdb;

                // Asegurar que siempre trabajamos con un array
                $event_ids = (array) $event_ids;
                $total_inserted = 0;

                foreach ($event_ids as $event_id) {
                    $event_id = intval($event_id);
                    if ($event_id <= 0) {
                        continue;
                    }

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
                            AND a.post_status = 'publish'
                            AND ea.meta_value = %d
                        ", $event_id, $event_id));

                    if ($result !== false) {
                        $total_inserted += $result;
                    } else {
                        error_log("Error insertando asistentes para evento $event_id: " . $wpdb->last_error);
                    }
                }

                return $total_inserted;
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
                    WHERE event_id IN ($placeholders) AND tipo = 'asistente'
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

            public function mep_get_asistentes_by_event_id($request) {
                $event_id = intval($request->get_param('event_id'));

                if (!$event_id || $event_id <= 0) {
                    return new WP_Error('invalid_event_id', 'ID de evento inválido.', ['status' => 400]);
                }

                $asistentes = $this->get_attendees_for_events([$event_id]);

                if (is_wp_error($asistentes)) {
                    return $asistentes;
                }

                if (empty($asistentes)) {
                    return rest_ensure_response([
                        'message' => 'No hay asistentes que sincronizar.',
                        'success' => true,
                        'attendees' => [],
                        'event_id' => $event_id,
                    ]);
                }

                return rest_ensure_response([
                    'success' => true,
                    'event_id' => $event_id,
                    'attendees' => $asistentes,
                ]);
            }


        
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

            public function ticketflow_sync_and_get_attendees($request) {
                $event_id = 0;
                if (is_object($request) && method_exists($request, 'get_param')) {
                    $event_id = intval($request->get_param('event_id'));
                } elseif (is_array($request) && isset($request['event_id'])) {
                    $event_id = intval($request['event_id']);
                }

                if ($event_id <= 0) {
                    return new WP_Error('invalid_event_id', 'ID de evento no válido', ['status' => 400]);
                }

                $attendees = $this->get_attendees_for_events([$event_id]);

                return rest_ensure_response([
                    'success' => true,
                    'event_id' => $event_id,
                    'total' => count($attendees),
                    'attendees' => $attendees,
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
                        //Ultima mejora para el sistema
            public function mark_multiple_as_scanned($request) {
                global $wpdb;
                $table = $wpdb->prefix . 'ticketflow_scans';
                $ids = array_map('intval', $request['ids']);
                
                if (empty($ids)) {
                    return new WP_REST_Response([
                        'success' => false,
                        'message' => 'No se proporcionaron IDs válidos'
                    ], 400);
                }

                // Iniciar transacción
                $wpdb->query('START TRANSACTION;');

                try {
                    // 1. Bloquear todas las filas primero para evitar deadlocks
                    $placeholders = implode(',', array_fill(0, count($ids), '%d'));
                    $query = $wpdb->prepare(
                        "SELECT id, scan_status, scan_time, user_id 
                        FROM $table 
                        WHERE id IN ($placeholders) 
                        FOR UPDATE",
                        $ids
                    );
                    
                    $asistentes = $wpdb->get_results($query, ARRAY_A);
                    
                    if (count($asistentes) !== count($ids)) {
                        $wpdb->query('ROLLBACK;');
                        return new WP_REST_Response([
                            'success' => false,
                            'message' => 'Algunos asistentes no fueron encontrados',
                            'missing_ids' => array_diff($ids, array_column($asistentes, 'id'))
                        ], 404);
                    }

                    // 2. Clasificar asistentes
                    $current_time = current_time('mysql');
                    $to_update = [];
                    $already_scanned = [];
                    
                    foreach ($asistentes as $asistente) {
                        if ($asistente['scan_status'] === 'pending') {
                            $to_update[] = $asistente['id'];
                        } else {
                            $already_scanned[] = [
                                'id' => $asistente['id'],
                                'status' => $asistente['scan_status'],
                                'scan_time' => $asistente['scan_time']
                            ];
                        }
                    }

                    // 3. Actualización masiva optimizada
                    if (!empty($to_update)) {
                        $placeholders = implode(',', array_fill(0, count($to_update), '%d'));
                        $update_query = $wpdb->prepare(
                            "UPDATE $table 
                            SET scan_status = 'scanned', 
                                scan_time = %s 
                            WHERE id IN ($placeholders)",
                            array_merge([$current_time], $to_update)
                        );
                        
                        $updated = $wpdb->query($update_query);
                        
                        if ($updated === false) {
                            throw new Exception('Error en actualización masiva');
                        }
                    }

                    // 4. Confirmar transacción
                    $wpdb->query('COMMIT;');

                    // 5. Preparar respuesta
                    $response = [
                        'success' => true,
                        'updated_count' => count($to_update),
                        'already_scanned' => $already_scanned,
                        'scan_time' => $current_time
                    ];

                    // 6. Opcional: Registrar en logs
                    if (!empty($already_scanned)) {
                        $response['warning'] = 'Algunos tickets ya estaban escaneados';
                    }

                    return new WP_REST_Response($response, 200);

                } catch (Exception $e) {
                    $wpdb->query('ROLLBACK;');
                    return new WP_REST_Response([
                        'success' => false,
                        'message' => 'Error en la transacción: ' . $e->getMessage()
                    ], 500);
                }
            }

    }