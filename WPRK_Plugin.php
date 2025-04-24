<?php
/**
 * Plugin Name: TicketFlow QR
 * Author: AlekhArt.codes
 * Author URI: https://github.com/VitokoMp
 * Version: 1.0.0
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Text-Domain: ticketflow-qr
 */

if ( ! defined( 'ABSPATH' ) ) exit; // No direct access allowed.

/**
 * Define Plugins Constants
 */
define ( 'WPRK_PATH', trailingslashit( plugin_dir_path( __FILE__ ) ) );
define ( 'WPRK_URL', trailingslashit( plugins_url( '/', __FILE__ ) ) );

/**
 * Clase para crear la página de administración del plugin, encolar los scripts necesarios y definir los puntos finales de la API REST.
 */
class WPRK_Plugin {

    public function __construct() {
        // Crear menú y encolar scripts
        add_action('admin_menu', [$this, 'create_admin_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        
        // Definir rutas de la API REST
        add_action('rest_api_init', [$this, 'create_rest_routes']);
    }

    public function create_admin_menu() {
        add_menu_page(
            __('Cotizador PDF', 'wp-react-pdf-cotizacion'),
            __('Cotizador PDF', 'wp-react-pdf-cotizacion'),
            'manage_options',
            'wprk-settings',
            [$this, 'menu_page_template'],
            'dashicons-buddicons-replies'
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
            WPRK_URL . 'dist/bundle.js',
            ['wp-element'],
            null,
            true
        );

        wp_localize_script('my-react-app', 'appLocalizer', [
            'apiUrl' => esc_url(rest_url('wprk/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);
    }

}

add_action('admin_enqueue_scripts', function () {
    wp_enqueue_script(
        'lector-qr-react-app',
        plugin_dir_url(__FILE__) . 'build/index.js',
        ['wp-element'],
        filemtime(plugin_dir_path(__FILE__) . 'build/index.js'),
        true
    );
});

add_action('admin_menu', function () {
    add_menu_page('Lector de QR para Tickets', 'Escanear Tickets QR', 'manage_options', 'lector-qr-tickets', function () {
        echo '<div id="root"></div>';
    });
});

add_action('rest_api_init', function () {
    register_rest_route('lectorqr/v1', '/escanear-ticket', [
        'methods' => 'POST',
        'callback' => 'registrar_escaneo_ticket',
        'permission_callback' => function () {
            return current_user_can( 'manage_options' );
        },
    ]);
});

function registrar_escaneo_ticket($request) {
    global $wpdb;
    $data = $request->get_json_params();

    $ticket_id = isset($data['ticket_id']) ? intval($data['ticket_id']) : 0;
    $event_id = isset($data['event_id']) ? intval($data['event_id']) : 0;
    $status = isset($data['status']) ? sanitize_text_field($data['status']) : '';
    $user_id = get_current_user_id();
    $scan_time = current_time('mysql');

    if ( !$ticket_id || !$event_id || empty($status) ) {
        return new WP_REST_Response('Datos incompletos o inválidos.', 400);
    }

    $wpdb->insert(
        $wpdb->prefix . 'lector_qr_scans',
        [
            'ticket_id' => $ticket_id,
            'event_id' => $event_id,
            'user_id' => $user_id,
            'scan_status' => $status,
            'scan_time' => $scan_time,
            'synced' => 0,
        ]
    );

    $history_id = wp_insert_post([
        'post_type' => 'qr_scan_history',
        'post_status' => 'publish',
        'post_title' => 'Escaneo QR Ticket ' . $ticket_id,
        'post_author' => $user_id,
    ]);

    if (!is_wp_error($history_id)) {
        update_post_meta($history_id, 'qr_event_id', $event_id);
        update_post_meta($history_id, 'qr_attendee_id', $user_id);
        update_post_meta($history_id, 'qr_status', $status);
        update_post_meta($history_id, 'qr_time', $scan_time);
    }

    return [
        'success' => true,
        'ticket_id' => $ticket_id,
        'event_id' => $event_id,
        'status' => $status,
        'scan_time' => $scan_time
    ];
}

register_activation_hook(__FILE__, function () {
    global $wpdb;

    $table_name = $wpdb->prefix . 'lector_qr_scans';
    $charset_collate = $wpdb->get_charset_collate();

    $sql = "CREATE TABLE $table_name (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ticket_id BIGINT UNSIGNED NOT NULL,
        event_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        scan_status VARCHAR(20) NOT NULL,
        scan_time DATETIME NOT NULL,
        synced TINYINT(1) DEFAULT 0,
        PRIMARY KEY (id)
    ) $charset_collate;";

    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
    dbDelta($sql);
});

add_action('init', function () {
    register_post_type('qr_scan_history', [
        'label' => 'Historial de Escaneos QR',
        'public' => false,
        'show_ui' => true,
        'show_in_menu' => 'lector-qr-tickets',
        'supports' => ['title', 'editor', 'custom-fields'],
    ]);
});

add_action('rest_api_init', function () {
    register_rest_route('lectorqr/v1', '/exportar-json', [
        'methods' => 'GET',
        'callback' => 'lectorqr_exportar_evento_json',
        'permission_callback' => '__return_true'
    ]);
});

function lectorqr_exportar_evento_json($request) {
    global $wpdb;

    $codigo_evento = sanitize_text_field($request->get_param('evento'));

    if (empty($codigo_evento)) {
        return new WP_Error('missing_param', 'Falta el parámetro "evento".', ['status' => 400]);
    }

    $tabla = $wpdb->prefix . 'lector_qr_scans';

    $resultados = $wpdb->get_results(
        $wpdb->prepare("SELECT * FROM $tabla WHERE event_code = %s", $codigo_evento),
        ARRAY_A
    );

    if (!$resultados) {
        return new WP_Error('no_data', 'No hay datos para este evento.', ['status' => 404]);
    }

    $json = json_encode($resultados, JSON_PRETTY_PRINT);

    $upload_dir = wp_upload_dir();
    $file_path = $upload_dir['basedir'] . "/qr_scans_{$codigo_evento}.json";

    file_put_contents($file_path, $json);

    return [
        'success' => true,
        'evento' => $codigo_evento,
        'mensaje' => 'Archivo JSON creado exitosamente.',
        'url' => $upload_dir['baseurl'] . "/qr_scans_{$codigo_evento}.json"
    ];
}

function actualizar_estado_tickets() {
    global $wpdb;

    // Obtenemos todos los tickets que no han sido sincronizados (estado 'synced' = 0)
    $tickets_no_synced = $wpdb->get_results(
        "SELECT * FROM {$wpdb->prefix}lector_qr_scans WHERE synced = 0"
    );

    // Verificamos cada ticket y actualizamos el estado
    foreach ($tickets_no_synced as $ticket) {
        $ticket_id = $ticket->ticket_id;
        $event_id = $ticket->event_id;

        // Lógica para actualizar el estado del ticket
        $estado_actualizado = obtener_estado_actual_ticket($ticket_id, $event_id);

        if ($estado_actualizado) {
            // Actualizamos la base de datos con el nuevo estado
            $wpdb->update(
                $wpdb->prefix . 'lector_qr_scans',
                [
                    'scan_status' => $estado_actualizado['status'],  // Ejemplo: check-in, check-out, quemado
                    'synced' => 1  // Marcamos como sincronizado
                ],
                ['ticket_id' => $ticket_id, 'event_id' => $event_id],
                ['%s', '%d'],
                ['%d', '%d']
            );
        }
    }

    // También podríamos devolver algo, si necesitas hacer log de lo que se actualizó
    return true;
}

// Función para obtener el estado actual del ticket (ejemplo)
function obtener_estado_actual_ticket($ticket_id, $event_id) {
    // Aquí es donde tendrías que consultar el estado actual de cada ticket
    // Esto puede ser una llamada a la API de la base de datos externa o alguna lógica de validación
    // En este ejemplo se devuelve un estado "quemado" o similar
    return [
        'status' => 'quemado'  // Este sería el estado que determinamos (puede ser dinámico)
    ];
}

// Programar la tarea para que se ejecute cada 15 segundos
function programar_actualizacion_tickets() {
    if (!wp_next_scheduled('actualizar_estado_tickets_evento')) {
        wp_schedule_event(time(), 'every_15_seconds', 'actualizar_estado_tickets_evento');
    }
}
add_action('wp', 'programar_actualizacion_tickets');

// Definir el intervalo de 15 segundos
function agregar_intervalo_personalizado($intervals) {
    $intervals['every_15_seconds'] = array(
        'interval' => 15,
        'display'  => __('Cada 15 segundos')
    );
    return $intervals;
}
add_filter('cron_schedules', 'agregar_intervalo_personalizado');

// Ejecutar la función cuando se dispare el evento
add_action('actualizar_estado_tickets_evento', 'actualizar_estado_tickets');
