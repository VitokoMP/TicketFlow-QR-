<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.3.1
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