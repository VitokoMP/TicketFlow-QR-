<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.2.0
 * License: GPL2
 * Text-Domain: wp-react-ticketflow-qr 
 */

// No direct access allowed
if (!defined('ABSPATH')) exit;

// Definimos las constantes del plugin
define('WPRK_PATH', trailingslashit(plugin_dir_path(__FILE__)));
define('WPRK_URL', trailingslashit(plugins_url('/', __FILE__)));

/**
 * Clase principal del plugin TicketFlow QR
 */
class WPRK_Plugin {
      
    public function __construct() {
            $this->initialize_hooks();
            add_action('wp_enqueue_scripts', function() {
                wp_deregister_script('wc-cart-fragments');
            }, 100);
            add_shortcode('ticketflow_app', function($atts) {
        // Encolar scripts
        wp_enqueue_script(
            'ticketflow-react',
            plugins_url('/dist/bundle.js', __FILE__),
            [],
            filemtime(plugin_dir_path(__FILE__) . 'dist/bundle.js'),
            true
        );

        // Pasar datos a React
        wp_localize_script('ticketflow-react', 'ticketflowApi', [
            'apiUrl' => esc_url(rest_url('ticketflow/v1')),
            'nonce' => wp_create_nonce('wp_rest')
        ]);

        // Contenedor para React
        return '<div id="ticketflow-root"></div>';
    });
        add_action('init', [$this, 'fix_cors_and_ssl_issues']);
        add_filter('style_loader_tag', [$this, 'replace_font_urls'], 10, 1);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_font_fixes'], 100);
        add_filter('get_site_icon_url', function($url) {
            return str_replace('http://', 'https://', $url);
        });
        // Encolar fuentes localmente
        add_action('wp_enqueue_scripts', function() {
            // Elimina estilos problemáticos del tema
            wp_dequeue_style('basel-fonts');
            
            // Registra tus propias fuentes
            wp_enqueue_style(
                'ticketflow-fonts', 
                plugins_url('/fonts/basel-fonts.css', __FILE__),
                [],
                '1.0'
            );
            
            // Tu CSS personalizado
            wp_enqueue_style(
                'ticketflow-main-css',
                plugins_url('/dist/main.css', __FILE__),
                [],
                filemtime(plugin_dir_path(__FILE__) . 'dist/main.css')
            );
        }, 100);
    }
    
    private function initialize_hooks() {
        // Activation hooks
        register_activation_hook(__FILE__, [$this, 'on_activation']);
        
        // Admin menu
        add_action('admin_menu', [$this, 'create_admin_menu']);
        
        // Scripts and styles
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        
        // REST API
        add_action('rest_api_init', [$this, 'create_rest_routes']);
        add_action('rest_api_init', [$this, 'configure_cors_headers']);
        
        // User role restrictions
        add_action('admin_init', [$this, 'restrict_scanner_role_access']);
        add_action('admin_menu', [$this, 'limit_admin_menu_for_scanner'], 999);
        
        // jQuery UI
        add_action('admin_enqueue_scripts', [$this, 'load_jquery_ui']);
    }
    
    /**
     * Activation hook
     */
    public function on_activation() {
        flush_rewrite_rules();
        $this->wprk_add_custom_roles();
        $this->create_scans_table();
    }
    
    /**
     * Add custom roles
     */
    public function wprk_add_custom_roles() {
        add_role('escaneador', 'Escaneador', [
            'read' => true,
            'manage_wprk_plugin' => true,
        ]);
        
        add_role('ticketflow_productor', 'Productor de Eventos', [
            'read' => true,
            'exportar_qr' => true,
            'cerrar_evento' => true,
            'edit_posts' => false,
        ]);
    }
    
    /**
     * Create scans table
     */
    private function create_scans_table() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'ticketflow_scans';
        $charset_collate = $wpdb->get_charset_collate();

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        // SQL para crear la tabla con las nuevas columnas
        $sql = "CREATE TABLE $table_name (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            event_id BIGINT(20) UNSIGNED NOT NULL,
            event_start_date DATETIME NULL,
            event_end_date DATETIME NULL,
            event_title VARCHAR(255) NULL,
            event_location VARCHAR(255) NULL,
            ticket_id BIGINT(20) UNSIGNED NULL,
            qr_code VARCHAR(255) NULL,
            user_id BIGINT(20) UNSIGNED DEFAULT NULL,
            scan_status VARCHAR(50) DEFAULT 'pendiente',
            scan_time DATETIME DEFAULT NULL,
            synced TINYINT(1) DEFAULT 0,
            tipo VARCHAR(255) NULL,
            PRIMARY KEY (id),
            KEY idx_ticket_id (ticket_id),
            KEY idx_event_id (event_id),
            KEY idx_user_id (user_id),
            KEY idx_scan_status (scan_status),
            FOREIGN KEY (event_id) REFERENCES {$wpdb->prefix}posts(ID) ON DELETE CASCADE,
            UNIQUE KEY unique_ticket_event (ticket_id, event_id)
        ) $charset_collate;";

        dbDelta($sql);
    }
    
    /**
     * Create admin menu
     */
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

        add_menu_page(
            'Sincronizar Eventos',
            'Sincronizar Eventos',
            'manage_options',
            'sincronizar_eventos',
            [$this, 'ejecutar_sincronizacion_con_boton'],
            'dashicons-update-alt',
            100
        );
    }
    
    /**
     * Admin page template
     */
    public function menu_page_template() {
        echo '<div class="wrap">
            <div id="wprk-admin-app" style="
                padding: 20px; 
                border: 1px solid rgb(221, 221, 221); 
                border-radius: 5px; 
                background-color: rgb(52, 54, 49); 
                box-shadow: rgba(0, 0, 0, 0.1) 0px 0px 10px; 
                width: 100%; 
                height: 100%; 
                display: flex; 
                flex-direction: column;
            "></div>
        </div>';
    }
    
    /**
     * Enqueue scripts
     */
    public function enqueue_scripts($hook) {
        if ($hook !== 'toplevel_page_wprk-settings') {
            return;
        }

        wp_enqueue_script(
            'my-react-app',
            WPRK_URL . 'dist/bundle.js',
            ['wp-element', 'jquery', 'jquery-ui-sortable'],
            null,
            true
        );

        wp_localize_script('my-react-app', 'appLocalizer', [
            'apiUrl' => esc_url(rest_url('wprk/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);
    }
    
    /**
     * Configure CORS headers
     */
    public function configure_cors_headers() {
        remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');

        add_filter('rest_pre_serve_request', function ($value) {
            header('Access-Control-Allow-Origin: https://ticketflowqr.test'); 
            header('Access-Control-Allow-Credentials: true');
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
            header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Nonce');
            return $value;
        });
    }
    
    /**
     * Restrict scanner role access
     */
    public function restrict_scanner_role_access() {
        if (current_user_can('escaneador') && !defined('DOING_AJAX')) {
            $current_screen = get_current_screen();
            if ($current_screen && $current_screen->base === 'dashboard') {
                wp_redirect(admin_url('admin.php?page=wprk-settings'));
                exit;
            }
        }
    }
    
    /**
     * Limit admin menu for scanner role
     */
    public function limit_admin_menu_for_scanner() {
        if (current_user_can('escaneador')) {
            global $menu, $submenu;
            
            // Main menu restrictions
            $allowed = ['toplevel_page_wprk-settings'];
            foreach ($menu as $key => $item) {
                if (!in_array($item[2], $allowed)) {
                    remove_menu_page($item[2]);
                }
            }
            
            // Submenu restrictions
            if (isset($submenu['wprk-settings']) && !current_user_can('manage_wprk_plugin')) {
                $submenu['wprk-settings'] = [];
            }
        }
    }
    
    /**
     * Create REST routes
     */
    public function create_rest_routes() {
        // Event routes
        register_rest_route('ticketflow/v1', '/events', [
            'methods' => 'GET',
            'callback' => [$this, 'get_events_from_db'],
            'permission_callback' => function() {
                return current_user_can('escanear_qr') || current_user_can('exportar_qr');
            },
        ]);
        
        register_rest_route('ticketflow/v1', '/eventos-activos', [
            'methods' => 'GET',
            'callback' => [$this, 'mep_get_eventos_activos'],
            'permission_callback' => '__return_true',
        ]);
        
        // Attendee routes
        register_rest_route('ticketflow/v1', '/asistentes', [
            'methods' => 'GET',
            'callback' => [$this, 'mep_get_asistentes_by_event_ids'],
            'permission_callback' => '__return_true',
        ]);
        
        register_rest_route('ticketflow/v1', '/sync-attendees/(?P<event_id>\d+)', [
            'methods' => 'GET',
            'callback' => [$this, 'ticketflow_sync_and_get_attendees'],
            'permission_callback' => '__return_true',
        ]);
        
        // QR scanning routes
        register_rest_route('ticketflow/v1', '/escanear/(?P<event_id>\d+)/(?P<qr_code>[a-zA-Z0-9\-]+)', [
            'methods' => 'GET',
            'callback' => [$this, 'get_scan_status_by_qr'],
            'permission_callback' => '__return_true',
        ]);
        
        register_rest_route('ticketflow/v1', '/mark-as-scanned/(?P<id>\d+)', [
            'methods' => ['POST','GET'],
            'callback' => [$this, 'mark_as_scanned'],
            'permission_callback' => '__return_true',
        ]);
        
        // Sync route
        register_rest_route('ticketflow/v1', '/mep_sincronizar_eventos_y_asistentes', [
            'methods'  => 'POST',
            'callback' => [$this, 'mep_sincronizar_eventos_y_asistentes'],
            'permission_callback' => '__return_true',
        ]);
        
        // User route
        register_rest_route('ticketflow/v1', '/me', [
            'methods'  => 'GET',
            'callback' => [$this, 'get_current_user_info'],
            'permission_callback' => 'is_user_logged_in',
        ]);
    }
    
    /**
     * Get current user info
     */
    public function get_current_user_info() {
        $user = wp_get_current_user();
        error_log('Usuario actual: ' . $user->user_login);

        if (!is_user_logged_in()) {
            return new WP_REST_Response(['error' => 'No autenticado...'], 401);
        }

        return [
            'id'       => $user->ID,
            'nombre'   => $user->display_name,
            'username' => $user->user_login,
            'email'    => $user->user_email,
            'roles'    => $user->roles,
        ];
    }
    
    /**
     * Load jQuery UI
     */
    public function load_jquery_ui() {
        wp_enqueue_script('jquery-ui-sortable');
    }
    
    /**
     * =============================================
     * EVENT AND ATTENDEE MANAGEMENT FUNCTIONS
     * =============================================
     */
    
    /**
     * Sync events and attendees
     */
    public function mep_sincronizar_eventos_y_asistentes() {
        global $wpdb;
        
        // Get events
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
        
        $eventos_insertados = [];
        
        // Insert or update events
        foreach ($events as $event) {
            $event_id = intval($event['event_id']);
            $event_title = sanitize_text_field($event['title'] ?? '');
            $event_start = !empty($event['start_datetime']) ? sanitize_text_field($event['start_datetime']) : null;
            $event_end = !empty($event['end_datetime']) ? sanitize_text_field($event['end_datetime']) : null;
            
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
            ", $event_id, $event_title, $event_start, $event_end, 0, null, 'evento'));

            $eventos_insertados[] = ['event_id' => $event_id];
        }
        
        $event_ids = array_map('intval', array_column($events, 'event_id'));
        if (empty($event_ids)) {
            return new WP_REST_Response([
                'success' => false,
                'message' => 'No se encontraron eventos para sincronizar.'
            ], 404);
        }
        
        // Sync attendees
        $total_asistentes = $this->sync_attendees_to_scans_table($event_ids);

        return new WP_REST_Response([
            'success' => true,
            'message' => 'Sincronización completa.',
            'eventos_insertados' => $eventos_insertados,
            'total_asistentes' => $total_asistentes
        ], 200);
    }
    
    /**
     * Get active events
     */
    public function mep_get_eventos_activos(WP_REST_Request $request) {
        global $wpdb;
        $tabla = $wpdb->prefix . 'ticketflow_scans';
        
        $query = "SELECT DISTINCT
                event_id,
                event_title,
                event_start_date,
                event_end_date,
                event_location
            FROM $tabla
            WHERE tipo = 'evento'
            AND event_end_date >= NOW()
            ORDER BY event_start_date ASC";
            
        $resultados = $wpdb->get_results($query);

        if (!$resultados) {
            return new WP_REST_Response([], 200);
        }

        return new WP_REST_Response($resultados, 200);
    }
    
    /**
     * Get events from database
     */
    public function get_events_from_db(WP_REST_Request $request) {
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
    
    /**
     * Sync attendees to scans table
     */
    public function sync_attendees_to_scans_table($event_ids) {
        global $wpdb;
        $event_ids = (array) $event_ids;
        $total_inserted = 0;

        foreach ($event_ids as $event_id) {
            $event_id = intval($event_id);
            if ($event_id <= 0) continue;

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
            } else {
                error_log("Error insertando asistentes para evento $event_id: " . $wpdb->last_error);
            }
        }

        return $total_inserted;
    }
    
    /**
     * Get attendees for events
     */
    public function get_attendees_for_events($event_ids) {
        global $wpdb;

        $event_ids = array_filter(array_map('intval', (array)$event_ids));
        if (empty($event_ids)) {
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
            return new WP_Error('db_query_error', 'Error al consultar asistentes', ['status' => 500]);
        }

        return $result;
    }
    
    /**
     * Get attendees by event IDs
     */
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
    
    /**
     * Get attendees by event ID
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
     * Sync and get attendees for an event
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

        // Sincronizar asistentes
        $inserted = $this->sync_attendees_to_scans_table([$event_id]);

        // Obtener asistentes
        $attendees = $this->get_attendees_for_events([$event_id]);

        return rest_ensure_response([
            'success' => true,
            'event_id' => $event_id,
            'inserted' => $inserted,
            'total' => count($attendees),
            'attendees' => $attendees,
        ]);
    }
    
    /**
     * =============================================
     * QR SCANNING FUNCTIONS
     * =============================================
     */
    
    /**
     * Get scan status by QR code
     */
    public function get_scan_status_by_qr($event_id, $qr_code) {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';

        // Primero: ¿El QR existe para este evento?
        $asistente = $wpdb->get_row($wpdb->prepare("
            SELECT id, qr_code, scan_status, scan_time, event_id, event_title
            FROM $table
            WHERE qr_code = %s AND event_id = %d AND tipo = 'asistente'
            LIMIT 1
        ", $qr_code, $event_id), ARRAY_A);

        if ($asistente) {
            // Evaluamos si está pendiente o ya escaneado
            if ($asistente['scan_status'] === 'pending') {
                return [
                    'success' => true,
                    'status' => 'PENDING',
                    'asistente' => $asistente,
                    'mensaje' => 'Asistente válido y pendiente de validación.'
                ];
            } else {
                return [
                    'success' => true,
                    'status' => 'ALREADY_SCANNED',
                    'asistente' => $asistente,
                    'mensaje' => 'Este asistente ya fue validado.'
                ];
            }
        }

        // Segundo: ¿Existe el QR pero en otro evento?
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

        // Tercero: No existe
        return [
             'success' => false,
            'status' => 'NOT_FOUND',
            'mensaje' => 'Este código QR no está registrado.'
        ];
    }
    
    /**
     * Mark ticket as scanned
     */
    public function mark_as_scanned($request) {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';
        $id = intval($request['id']);

        // Verificamos que exista el registro
        $asistente = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM $table WHERE id = %d LIMIT 1
        ", $id), ARRAY_A);

        if (!$asistente) {
            return new WP_REST_Response([
                'success'   => false,
                'status' => 'NOT_FOUND',
                'mensaje' => 'No se encontró el asistente con ese ID.'
            ], 404);
        }

        // Si ya fue escaneado, no volvemos a marcarlo
        if ($asistente['scan_status'] !== 'pending') {
            return new WP_REST_Response([
                'success'   => false,
                'status' => 'ALREADY_SCANNED',
                'mensaje' => 'Este asistente ya fue validado anteriormente.',
                'asistente' => $asistente
            ], 200);
        }

        // Marcar como escaneado
        $update = $wpdb->update(
            $table,
            [
                'scan_status' => 'scanned',
                'scan_time'   => current_time('mysql')
            ],
            ['id' => $id],
            ['%s', '%s'],
            ['%d']
        );

        if ($update === false) {
            return new WP_REST_Response([
                'success'   => false,
                'status' => 'ERROR',
                'mensaje' => 'Error al actualizar el estado en la base de datos.'
            ], 500);
        }

        // Devolvemos el asistente actualizado
        $asistente_actualizado = $wpdb->get_row($wpdb->prepare("
            SELECT * FROM $table WHERE id = %d LIMIT 1
        ", $id), ARRAY_A);

        return new WP_REST_Response([
            'success'   => true,
            'status' => 'UPDATED',
            'mensaje' => 'Asistente marcado como escaneado.',
            'asistente' => $asistente_actualizado
        ], 200);
    }
    
    /**
     * =============================================
     * ADMIN UTILITY FUNCTIONS
     * =============================================
     */
    
    /**
     * Execute sync with button
     */
    public function ejecutar_sincronizacion_con_boton() {
        if (isset($_POST['ejecutar_sincronizacion'])) {
            $resultado = $this->mep_sincronizar_eventos_y_asistentes();

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

     /**
     * =============================================
     * SHORTCODES
     * =============================================
     */
  
    /**
     * Shortcode para mostrar la aplicación TicketFlow
     */

    public function ticketflow_app_shortcode($atts) {
        // Atributos del shortcode con valores por defecto
        $atts = shortcode_atts([
            'width' => '100%',
            'height' => '600px',
            'background' => '#343631'
        ], $atts, 'ticketflow_app');

        // Encolar los scripts necesarios
        wp_enqueue_script(
            'my-react-app',
            WPRK_URL . 'dist/bundle.js',
            ['wp-element', 'jquery', 'jquery-ui-sortable'],
            null,
            true
        );

        wp_localize_script('my-react-app', 'appLocalizer', [
            'apiUrl' => esc_url(rest_url('wprk/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);

        // Devolver el contenedor para la app React con estilos inline
        return sprintf(
            '<div id="ticketflow-app-container" style="width: %s; height: %s; background-color: %s; padding: 20px; border-radius: 8px;">
                <div id="wprk-admin-app"></div>
            </div>',
            esc_attr($atts['width']),
            esc_attr($atts['height']),
            esc_attr($atts['background'])
        );
    }


    /**
     * =============================================
     * CORS and SSL Fixes
     * =============================================
     */
    public function replace_font_urls_in_css($css) {
    $local_url = content_url('/themes/basel/fonts/');
    return str_replace(
        'https://ticketflow.cl/wp-content/themes/basel/fonts/',
        $local_url,
        $css
        );
    }

    public function enqueue_font_fixes() {
        // Solo si estamos usando el tema Basel
        if ('basel' === get_template()) {
            add_filter('basel_dynamic_css', [$this, 'replace_font_urls_in_css']);
            
            // Registrar las fuentes localmente
            wp_enqueue_style('basel-fonts-local', plugins_url('fonts/basel-fonts.css', __FILE__), [], '1.0');
        }
    }

    public function fix_cors_and_ssl_issues() {
    // Headers para CORS
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
    
    // Forzar HTTPS en recursos
    if (is_ssl()) {
        add_filter('wp_calculate_image_srcset', function($sources) {
            foreach ($sources as &$source) {
                $source['url'] = set_url_scheme($source['url'], 'https');
            }
            return $sources;
        });
        }
    }

    public function replace_font_urls($html) {
        return str_replace(
            ['https://ticketflow.cl/wp-content/themes/basel/fonts/', 'http://ticketflow.cl/wp-content/themes/basel/fonts/'],
            [content_url('/themes/basel/fonts/'), content_url('/themes/basel/fonts/')],
            $html
        );
    }
}

new WPRK_Plugin();