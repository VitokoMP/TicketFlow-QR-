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
}