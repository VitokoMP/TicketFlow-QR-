<?php
class TicketFlow_Core {
    private static $instance;
    private $admin;
    private $rest_api;

    public static function instance() {
        if (!isset(self::$instance)) {
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
        require_once TICKETFLOW_PATH . 'includes/class-admin.php';
        require_once TICKETFLOW_PATH . 'includes/class-rest-api.php';
        require_once TICKETFLOW_PATH . 'includes/class-cpt.php';
        require_once TICKETFLOW_PATH . 'includes/class-roles.php';
    }

    private function init_components() {
        TicketFlow_Roles::init();
        $this->admin = new TicketFlow_Admin();//Administración del plugin
        $this->rest_api = new TicketFlow_REST_API();
        TicketFlow_CPT::init();
    }

    private function register_hooks() {
        add_action('plugins_loaded', [$this, 'diagnostic_check']);
        add_action('admin_menu', [$this, 'add_sync_menu_page']);
    }
/*
    public function diagnostic_check() {
        if (!class_exists('TicketFlow_Admin')) {
            error_log('Error: La clase TicketFlow_Admin no se cargó correctamente');
        }
    }*/

    public function add_sync_menu_page() {
        add_menu_page(
            'Sincronizar Eventos',
            'Sincronizar Eventos',
            'ver_dashboard',
            'sincronizar_eventos',
            [$this, 'ejecutar_sincronizacion_con_boton'],
            'dashicons-update-alt',
            100
        );
    }

    public function ejecutar_sincronizacion_con_boton() {
        if (isset($_POST['ejecutar_sincronizacion'])) {
            $resultado = $this->rest_api->mep_sincronizar_eventos_y_asistentes();
            
            if (is_wp_error($resultado)) {
                echo '<div class="notice notice-error"><p>Error: ' . $resultado->get_error_message() . '</p></div>';
            } else {
                echo '<div class="notice notice-success"><p>Éxito: ' . $resultado['message'] . '</p></div>';
            }
        }

        echo '
            <form method="POST" id="form-sincronizacion">
                <input type="submit" name="ejecutar_sincronizacion" 
                       value="Sincronizar Eventos y Asistentes" 
                       class="button button-primary" 
                       id="btn-sincronizar">
            </form>
        ';
    }
    public function diagnostic_check() {
    $resultados = [];
    
    // 1. Verificar roles
    $resultados['roles'] = [
        'escaneador' => get_role('escaneador') ? 'OK' : 'Falta el rol escaneador',
        'productor' => get_role('ticketflow_productor') ? 'OK' : 'Falta el rol productor'
    ];
    
    // 2. Verificar capacidades
    $resultados['capacidades'] = [
        'escaneador' => [
            'escanear_qr' => current_user_can('escanear_qr') ? 'OK' : 'Falta capacidad',
            'ver_dashboard' => current_user_can('ver_dashboard') ? 'OK' : 'Falta capacidad'
        ],
        'productor' => [
            'exportar_qr' => current_user_can('exportar_qr') ? 'OK' : 'Falta capacidad',
            'ver_dashboard' => current_user_can('ver_dashboard') ? 'OK' : 'Falta capacidad'
        ]
    ];
    
    // 3. Verificar tablas de base de datos
    global $wpdb;
    $tabla = $wpdb->prefix . 'ticketflow_scans';
    $resultados['tabla_bd'] = $wpdb->get_var("SHOW TABLES LIKE '$tabla'") === $tabla ? 'OK' : 'Falta tabla';
    
    // 4. Verificar endpoints REST
    $resultados['rest_api'] = [
        'eventos' => rest_do_request(new WP_REST_Request('GET', '/ticketflow/v1/eventos'))->get_status(),
        'escanear' => rest_do_request(new WP_REST_Request('GET', '/ticketflow/v1/escanear/1/test'))->get_status()
    ];
    
    return $resultados;
}
}