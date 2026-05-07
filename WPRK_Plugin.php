<?php
/**
 * Plugin Name: TicketFlow QR
 * Author URI: https://github.com/VitokoMp
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.5.2
 * License: GPL2
 * Text-Domain: wp-react-ticketflow-qr 
 */

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