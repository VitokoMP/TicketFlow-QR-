<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.3.3
 * License: GPL2
 * Text-Domain: wp-react-ticketflow-qr 
 */

/**
 * Clase de prueba para verificar la inicialización
 *//*
class TicketFlow_Test {
    private static $instance = null;
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
            self::$instance->init();
        }
        return self::$instance;
    }
    
    private function __construct() {
        // Constructor privado para patrón Singleton
    }
    
    private function init() {
        add_action('admin_notices', [$this, 'show_init_notice']);
        error_log('TicketFlow Test: Plugin inicializado correctamente');
    }
    
    public function show_init_notice() {
        echo '<div class="notice notice-success is-dismissible">';
        echo '<p>TicketFlow Test: ¡El plugin se ha inicializado correctamente!</p>';
        echo '</div>';
    }
}

// Reemplaza temporalmente la inicialización original con esta prueba
add_action('plugins_loaded', function() {
    TicketFlow_Test::instance();
    // TicketFlow_Core::instance(); // Comentamos la línea original
});*/

defined('ABSPATH') || exit;

// Definir constantes
define('TICKETFLOW_PATH', trailingslashit(plugin_dir_path(__FILE__)));
define('TICKETFLOW_URL', trailingslashit(plugins_url('/', __FILE__)));

foreach ([
    'class-activator.php',
    'class-roles.php',
    'class-rest-api.php',
    'class-admin.php',
    'class-cpt.php',
    'class-core.php'
] as $file) {
    $path = TICKETFLOW_PATH . 'includes/' . $file;
    if (!file_exists($path)) {
        error_log("Falta archivo: $path");
    }
}

// Cargar dependencias
require_once TICKETFLOW_PATH . 'includes/class-activator.php';
require_once TICKETFLOW_PATH . 'includes/class-roles.php';
require_once TICKETFLOW_PATH . 'includes/class-rest-api.php';
require_once TICKETFLOW_PATH . 'includes/class-admin.php';
require_once TICKETFLOW_PATH . 'includes/class-cpt.php';
require_once TICKETFLOW_PATH . 'includes/class-core.php';

// Registrar hooks de activación
register_activation_hook(__FILE__, ['TicketFlow_Activator', 'activate']);
register_deactivation_hook(__FILE__, ['TicketFlow_Activator', 'deactivate']);

// Inicializar el plugin
add_action('plugins_loaded', function() {
    TicketFlow_Core::instance();
});

add_action('admin_enqueue_scripts', function($hook) {
    // Solo cargar en páginas del plugin
    $ticketflow_pages = [
        'toplevel_page_ticketflow',
        'ticketflow_page_ticketflow-eventos',
        'ticketflow_page_ticketflow-reportes',
        'ticketflow_page_ticketflow-escanear'
    ];
    
    if (!in_array($hook, $ticketflow_pages)) {
        return;
    }

    $asset_path = plugin_dir_path(__FILE__) . 'build/index.asset.php';
    
    if (!file_exists($asset_path)) {
        error_log('TicketFlow QR: Archivo de assets no encontrado');
        return;
    }

    $asset = include $asset_path;
    
    // Añadir heartbeat como dependencia
    $asset['dependencies'][] = 'heartbeat';

    wp_enqueue_script(
        'ticketflow-admin',
        plugins_url('build/bundle.js', __FILE__),
        $asset['dependencies'],
        $asset['version'],
        true
    );

    wp_localize_script('ticketflow-admin', 'ticketflowQR', [
        'ajax_url' => admin_url('admin-ajax.php'),
        'rest_url' => rest_url('ticketflow/v1/'),
        'nonce' => wp_create_nonce('wp_rest'),
        'user' => [
            'id' => get_current_user_id(),
            'roles' => wp_get_current_user()->roles
        ]
    ]);

    // Cargar estilos si existen
    $css_path = plugin_dir_path(__FILE__) . 'src/public/css/admin.css';
    if (file_exists($css_path)) {
        wp_enqueue_style(
            'ticketflow-admin-css',
            plugins_url('src/public/css/admin.css', __FILE__),
            [],
            filemtime($css_path)
        );
    }
});

// Acción AJAX (admin)
add_action( 'wp_ajax_ticketflow_action', function() {
    check_ajax_referer( 'ticketflow_nonce' );

    wp_send_json_success([
        'message' => 'AJAX funcionando ✅',
        'time' => current_time('mysql')
    ]);
});
