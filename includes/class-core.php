<?php
class TicketFlow_Core {
    private static $instance;
    private $admin;
    private $rest_api;
    private $cpt;
    private $roles;

    public static function instance() {
        if (!isset(self::$instance) || !self::$instance instanceof self) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        $this->includes();
        $this->init_components();
        $this->register_hooks();
    }

    private function includes() {
        $required_files = [
            'class-admin.php',
            'class-rest-api.php',
            'class-cpt.php',
            'class-roles.php'
        ];

        foreach ($required_files as $file) {
            $file_path = TICKETFLOW_PATH . 'includes/' . $file;
            if (!file_exists($file_path)) {
                throw new RuntimeException(sprintf(
                    __('Archivo requerido no encontrado: %s', 'wp-react-ticketflow-qr'),
                    $file_path
                ));
            }
            require_once $file_path;
        }
    }

    private function init_components() {
        $this->roles = TicketFlow_Roles::instance();
        $this->admin = TicketFlow_Admin::instance();
        $this->cpt = TicketFlow_CPT::instance();
        $this->rest_api = TicketFlow_REST_API::instance();
    }

    private function register_hooks() {

        add_action('init', [$this, 'diagnostic_check']);
        add_action('admin_menu', [$this, 'add_sync_menu_page']);
        add_action('admin_init', [$this, 'handle_sync_request']);
        add_action('init', [$this, 'check_security_headers']);
        add_action('init', [$this, 'maybe_upgrade_scan_events_table'], 5);
    }

    public function add_sync_menu_page() {
        add_submenu_page(
            'ticketflow', // Parent slug
            __('Sincronizar Eventos', 'wp-react-ticketflow-qr'),
            __('Sincronizar', 'wp-react-ticketflow-qr'),
            'ticketflow_edit_events',
            'ticketflow-sync',
            [$this, 'render_sync_page']
        );
    }

    public function handle_sync_request() {
        if (!isset($_POST['ticketflow_sync_nonce'])) {
            return;
        }

        if (!wp_verify_nonce($_POST['ticketflow_sync_nonce'], 'ticketflow_sync_action')) {
            wp_die(__('Acción no permitida', 'wp-react-ticketflow-qr'));
        }

        if (!current_user_can('ticketflow_edit_events')) {
            wp_die(__('No tienes permisos para esta acción', 'wp-react-ticketflow-qr'));
        }

        $response = $this->rest_api->mep_sincronizar_eventos_y_asistentes();
        $this->sync_result = $this->process_sync_response($response);

        add_action('admin_notices', [$this, 'show_sync_notices']);
    }

    private function process_sync_response($response) {
        if ($response instanceof WP_REST_Response) {
            return $response->get_data();
        } elseif ($response instanceof WP_Error) {
            return [
                'error' => true,
                'message' => $response->get_error_message()
            ];
        }
        return (array) $response;
    }

    public function show_sync_notices() {
        if (empty($this->sync_result)) {
            return;
        }

        if (!empty($this->sync_result['error'])) {
            echo '<div class="notice notice-error"><p>' 
                . esc_html__('Error:', 'wp-react-ticketflow-qr') 
                . ' ' . esc_html($this->sync_result['message']) 
                . '</p></div>';
            return;
        }

        echo '<div class="notice notice-success"><p>' 
            . esc_html__('Éxito:', 'wp-react-ticketflow-qr') 
            . ' ' . esc_html($this->sync_result['message'] ?? __('Sincronización completada', 'wp-react-ticketflow-qr')) 
            . '</p></div>';

        if (!empty($this->sync_result['eventos_insertados'])) {
            echo '<div class="notice notice-info"><p>' 
                . esc_html__('Eventos procesados:', 'wp-react-ticketflow-qr') 
                . ' ' . count($this->sync_result['eventos_insertados']) 
                . '</p></div>';
        }

        if (!empty($this->sync_result['total_asistentes'])) {
            echo '<div class="notice notice-info"><p>' 
                . esc_html__('Asistentes sincronizados:', 'wp-react-ticketflow-qr') 
                . ' ' . intval($this->sync_result['total_asistentes']) 
                . '</p></div>';
        }
    }

    public function render_sync_page() {
        echo '<div class="wrap">';
        echo '<h1>' . esc_html__('Sincronizar Eventos', 'wp-react-ticketflow-qr') . '</h1>';
        
        echo '<form method="POST">';
        wp_nonce_field('ticketflow_sync_action', 'ticketflow_sync_nonce');
        submit_button(
            __('Sincronizar Eventos y Asistentes', 'wp-react-ticketflow-qr'),
            'primary',
            'submit_sync',
            false
        );
        echo '</form>';
        
        echo '</div>';
    }

    public function diagnostic_check() {
        if (!defined('WP_DEBUG') || !WP_DEBUG) {
            return;
        }

        $results = [
            'roles' => $this->check_roles(),
            'capabilities' => $this->check_capabilities(),
            'database' => $this->check_database(),
            'rest_api' => $this->check_rest_api()
        ];

        if (defined('WP_CLI') && WP_CLI) {
            WP_CLI::log(print_r($results, true));
        } else {
            error_log(print_r($results, true));
        }
    }

    private function check_roles() {
        return [
            'escaneador' => (bool) get_role('escaneador'),
            'ticketflow_productor' => (bool) get_role('ticketflow_productor')
        ];
    }

    private function check_capabilities() {
        return [
            'administrator' => [
                'ticketflow_scan_qr' => current_user_can('ticketflow_scan_qr'),
                'ticketflow_export_qr' => current_user_can('ticketflow_export_qr')
            ]
        ];
    }

    private function check_database() {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';
        return [
            'exists' => $wpdb->get_var("SHOW TABLES LIKE '$table'") === $table,
            'columns' => $wpdb->get_results("DESCRIBE $table")
        ];
    }

    private function check_rest_api() {
        $routes = [
            '/ticketflow/v1/eventos',
            '/ticketflow/v1/escanear'
        ];
        
        $results = [];
        foreach ($routes as $route) {
            $request = new WP_REST_Request('GET', $route);
            $response = rest_do_request($request);
            $results[$route] = $response->get_status();
        }
        
        return $results;
    }
    public function check_security_headers() {
        // Verificar si estamos en HTTPS
        if (is_ssl()) {
            @ini_set('session.cookie_secure', 1);
        }
        
        @ini_set('session.cookie_httponly', 1);
        @ini_set('session.cookie_samesite', 'Strict');
        
        // Headers de seguridad adicionales
        if (!headers_sent()) {
            header('X-Content-Type-Options: nosniff');
            header('X-Frame-Options: SAMEORIGIN');
            header('X-XSS-Protection: 1; mode=block');
        }
    }
    public function maybe_upgrade_scan_events_table() {
    global $wpdb;

    $table_name = $wpdb->prefix . 'ticketflow_scan_events';
    $schema_version = '1';

    $stored_version = get_option('ticketflow_scan_events_db_version', '');

    $table_exists = $wpdb->get_var(
        $wpdb->prepare(
            'SHOW TABLES LIKE %s',
            $wpdb->esc_like($table_name)
        )
    ) === $table_name;

    // No ejecutar nuevamente una migración ya verificada.
    if ($table_exists && $stored_version === $schema_version) {
        return;
    }

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset_collate = $wpdb->get_charset_collate();

    $sql = "CREATE TABLE $table_name (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        scan_uuid CHAR(36) NOT NULL,
        attendee_id BIGINT(20) UNSIGNED NOT NULL,
        event_id BIGINT(20) UNSIGNED NOT NULL,
        device_id VARCHAR(100) DEFAULT NULL,
        scanned_at DATETIME(3) DEFAULT NULL,
        server_received_at DATETIME(3) NOT NULL,
        outcome VARCHAR(32) NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY uq_scan_uuid (scan_uuid),
        KEY idx_attendee_outcome (attendee_id, outcome),
        KEY idx_event_received (event_id, server_received_at, id)
    ) ENGINE=InnoDB $charset_collate;";

    dbDelta($sql);

    // Verificar que la tabla exista.
    $table_exists = $wpdb->get_var(
        $wpdb->prepare(
            'SHOW TABLES LIKE %s',
            $wpdb->esc_like($table_name)
        )
    ) === $table_name;

    if (!$table_exists) {
        error_log(
            '[TicketFlow] Error: no se pudo crear ticketflow_scan_events.'
        );
        return;
    }

    // Verificar columnas.
    $columns = $wpdb->get_col(
        "SHOW COLUMNS FROM $table_name",
        0
    );

    $required_columns = [
        'id',
        'scan_uuid',
        'attendee_id',
        'event_id',
        'device_id',
        'scanned_at',
        'server_received_at',
        'outcome'
    ];

    if (!empty(array_diff($required_columns, $columns))) {
        error_log(
            '[TicketFlow] Error: faltan columnas en ticketflow_scan_events.'
        );
        return;
    }

    // Verificar índices.
    $indexes = $wpdb->get_col(
        "SHOW INDEX FROM $table_name",
        2
    );

    $required_indexes = [
        'PRIMARY',
        'uq_scan_uuid',
        'idx_attendee_outcome',
        'idx_event_received'
    ];

    if (!empty(array_diff($required_indexes, $indexes))) {
        error_log(
            '[TicketFlow] Error: faltan índices en ticketflow_scan_events.'
        );
        return;
    }

    // Verificar precisión temporal y motor transaccional.
    $scanned_at = $wpdb->get_row(
        "SHOW COLUMNS FROM $table_name LIKE 'scanned_at'",
        ARRAY_A
    );

    $received_at = $wpdb->get_row(
        "SHOW COLUMNS FROM $table_name LIKE 'server_received_at'",
        ARRAY_A
    );

    $table_status = $wpdb->get_row(
        $wpdb->prepare(
            'SHOW TABLE STATUS WHERE Name = %s',
            $table_name
        ),
        ARRAY_A
    );

    if (
        strtolower($scanned_at['Type'] ?? '') !== 'datetime(3)' ||
        strtolower($received_at['Type'] ?? '') !== 'datetime(3)' ||
        strtoupper($table_status['Engine'] ?? '') !== 'INNODB'
    ) {
        error_log(
            '[TicketFlow] Error: esquema temporal o motor de tabla incorrecto.'
        );
        return;
    }

    // Registrar versión únicamente después de verificar el esquema.
    update_option(
        'ticketflow_scan_events_db_version',
        $schema_version,
        false
    );
}
}