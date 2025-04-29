<?php
/**
 * Plugin Name: TicketFlow QR
 * Description: Plugin de validación de entradas con códigos QR para eventos en WordPress.
 * Author: AlekhArt.codes
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) exit;
if ( ! defined( 'JWT_AUTH_SECRET_KEY' ) ) {
    define( 'JWT_AUTH_SECRET_KEY', 'asereje' );
}
/**
 * Define Plugins Constants
 */
define ( 'WPRK_PATH', trailingslashit( plugin_dir_path( __FILE__ ) ) );
define ( 'WPRK_URL', trailingslashit( plugins_url( '/', __FILE__ ) ) );

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
});

/**
 * Clase para crear la página de administración del plugin, encolar los scripts necesarios y definir los puntos finales de la API REST.
 */
class TicketFlowQR {
    public function __construct() {
       // add_action('init', [$this, 'register_post_type']);
        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_scripts']);
        
          // Definir rutas de la API REST
        add_action('rest_api_init', [$this, 'register_rest_routes']);       
        register_activation_hook(__FILE__, [$this, 'create_tables']);
    }
    public function load_app() {
        echo '<div class="wrap"><div id="ticketflow-root"></div></div>';
    }

    public function admin_menu() {
        add_menu_page('Escanear QR', 'TicketFlow QR', 'manage_options', 'ticketflow-qr', [$this, 'load_app'], 'dashicons-tickets-alt', 56);
    }

    public function enqueue_admin_scripts($hook) {
        if ($hook !== 'toplevel_page_ticketflow-qr') return;
        wp_enqueue_script('ticketflow-app', TICKETFLOW_URL . 'src/index.js', ['wp-element'], filemtime(TICKETFLOW_PATH . 'src/index.js'), true);
        wp_localize_script('ticketflow-app', 'TicketFlow', [
            'apiUrl' => esc_url(rest_url('ticketflow/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);
    }    

    public function create_tables() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$wpdb->prefix}ticketflow_scans (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            ticket_id BIGINT NOT NULL,
            event_id BIGINT NOT NULL,
            user_id BIGINT NOT NULL,
            scan_status VARCHAR(20) NOT NULL,
            scan_time DATETIME NOT NULL,
            synced TINYINT(1) DEFAULT 0
        ) $charset;";

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
        dbDelta($sql);
    }

    public function sync_data($request) {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';
        $data = $request->get_json_params();
    
        if (!isset($data['data']) || !is_array($data['data'])) {
            return new WP_Error('datos_invalidos', 'Faltan datos de sincronización.', ['status' => 400]);
        }
    
        foreach ($data['data'] as $scan) {
            $ticket_id = intval($scan['ticket_id']);
            $event_id = intval($scan['event_id']);
            $status = sanitize_text_field($scan['scan_status']);
            $time = sanitize_text_field($scan['scan_time']);
    
            // Insertar en la tabla personalizada
            $wpdb->insert($table, [
                'ticket_id' => $ticket_id,
                'event_id' => $event_id,
                'user_id' => get_current_user_id(),
                'scan_status' => $status,
                'scan_time' => $time,
                'synced' => 1
            ]);
    
            // Registrar o actualizar historial si ya existe
            $existing = get_posts([
                'post_type' => 'qr_scan_history',
                'meta_query' => [
                    ['key' => 'qr_event_id', 'value' => $event_id],
                    ['key' => 'qr_ticket_id', 'value' => $ticket_id]
                ],
                'numberposts' => 1
            ]);
    
            if ($existing) {
                $post_id = $existing[0]->ID;
                update_post_meta($post_id, 'qr_status', $status);
                update_post_meta($post_id, 'qr_time', $time);
            } else {
                $post_id = wp_insert_post([
                    'post_type' => 'qr_scan_history',
                    'post_status' => 'publish',
                    'post_title' => "Escaneo QR #$ticket_id"
                ]);
                update_post_meta($post_id, 'qr_event_id', $event_id);
                update_post_meta($post_id, 'qr_ticket_id', $ticket_id);
                update_post_meta($post_id, 'qr_status', $status);
                update_post_meta($post_id, 'qr_time', $time);
            }
        }
    
        return ['success' => true];
    }
    

   public function register_rest_routes() {
    register_rest_route('ticketflow/v1', '/escanear', [
        'methods' => 'POST',
        'callback' => [$this, 'handle_qr_scan'],
        'permission_callback' => function () {
            return current_user_can('escanear_qr') || current_user_can('exportar_qr');
        }
    ]);

    /* public function populate_ticket_scans_table() {
    global $wpdb;

    // Paso 1: Obtener el evento activo
    $event_id = $this->get_active_event_id();

    if (!$event_id) {
        return new WP_REST_Response(['error' => 'No hay evento activo'], 404);
    }

    // Paso 2: Obtener los tickets del evento activo
    $tickets = $this->get_tickets_for_event($event_id);

    if (empty($tickets)) {
        return new WP_REST_Response(['error' => 'No hay tickets asociados a este evento'], 404);
    }

    // Paso 3: Poblar la tabla wp_ticket_scans
    $table_name = $wpdb->prefix . 'ticket_scans'; // Nombre de la tabla personalizada de escaneos

    foreach ($tickets as $ticket) {
        // Verificar si el ticket ya está registrado en la tabla de escaneos
        $existing_ticket = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM $table_name WHERE ticket_id = %d", $ticket->ticket_id)
        );

        if (!$existing_ticket) {
            // Insertar un nuevo registro si no existe
            $wpdb->insert(
                $table_name,
                [
                    'ticket_id' => $ticket->ticket_id,
                    'qr_code' => $ticket->qr_code,
                    'event_id' => $event_id,
                    'status' => 'pendiente', // Suponemos que los tickets inician con "pendiente"
                    'created_at' => current_time('mysql') // Fecha y hora actual
                ],
                ['%d', '%s', '%d', '%s', '%s']
            );
        }
    }

    return new WP_REST_Response(['message' => 'Datos de los tickets poblados correctamente'], 200);
}

private function get_active_event_id() {
    // Obtener el ID del evento activo desde wp_posts
    global $wpdb;
    $table_name = $wpdb->prefix . 'posts'; // wp_posts para los eventos

    $event = $wpdb->get_row(
        $wpdb->prepare(
            "SELECT ID FROM $table_name WHERE post_type = 'event' AND post_status = 'publish' ORDER BY post_date DESC LIMIT 1"
        )
    );

    return $event ? $event->ID : null;
}

private function get_tickets_for_event($event_id) {
    // Obtener los tickets del evento desde wp_mep_qr
    global $wpdb;
    $table_name = $wpdb->prefix . 'mep_qr'; // wp_mep_qr para los tickets

    return $wpdb->get_results(
        $wpdb->prepare("SELECT * FROM $table_name WHERE event_id = %d", $event_id)
    );
}
 */

    register_rest_route('ticketflow/v1', '/exportar', [
        'methods' => 'GET',
        'callback' => [$this, 'export_json'],
        'permission_callback' => function () {
            return current_user_can('exportar_qr');
        }
    ]);

    register_rest_route('ticketflow/v1', '/importar', [
        'methods' => 'POST',
        'callback' => [$this, 'import_json'],
        'permission_callback' => function () {
            return current_user_can('exportar_qr');
        }
    ]);

    register_rest_route('ticketflow/v1', '/sincronizar', [
        'methods' => 'POST',
        'callback' => [$this, 'sync_data'],
        'permission_callback' => function () {
            return current_user_can('escanear_qr') || current_user_can('exportar_qr');
        }
    ]);
}

public function handle_qr_scan($request) {
    global $wpdb;
    $data = $request->get_json_params();

    $table = "{$wpdb->prefix}ticketflow_scans";

    // Verificar si el ticket ya fue escaneado
    $existing = $wpdb->get_row(
        $wpdb->prepare("SELECT * FROM $table WHERE ticket_id = %d", $data['ticket_id'])
    );

    $values = [
        'ticket_id'   => $data['ticket_id'],
        'event_id'    => $data['event_id'],
        'user_id'     => get_current_user_id(),
        'scan_status' => sanitize_text_field($data['status']),
        'scan_time'   => current_time('mysql'),
        'synced'      => 0,
    ];

    if ($existing) {
        // Si ya existe un escaneo previo, lo actualizamos
        $wpdb->update($table, $values, ['ticket_id' => $data['ticket_id']]);
    } else {
        // Si es un escaneo nuevo, lo insertamos
        $wpdb->insert($table, $values);
    }

    // Obtener los escaneos del evento
    $scans = $wpdb->get_results(
        $wpdb->prepare("SELECT scan_status FROM $table WHERE event_id = %d", $data['event_id'])
    );

    // Calcular el número de escaneos y el último estado
    $scan_count = count($scans);
    $last_status = end($scans)->scan_status;

    // Actualizar los metadatos del evento
    update_post_meta($data['event_id'], '_qr_scan_count', $scan_count);
    update_post_meta($data['event_id'], '_qr_last_status', $last_status);

    return new WP_REST_Response(['message' => 'Escaneo actualizado y metadatos del evento actualizados'], 200);
}



    public function export_json($request) {
        global $wpdb;
        $evento = sanitize_text_field($request->get_param('evento'));
        $table = $wpdb->prefix . 'ticketflow_scans';

        $datos = $wpdb->get_results($wpdb->prepare("SELECT * FROM $table WHERE event_id = %d", $evento), ARRAY_A);
        if (!$datos) {
            return new WP_Error('sin_datos', 'No hay escaneos para este evento.', ['status' => 404]);
        }

        $upload_dir = wp_upload_dir();
        $file = $upload_dir['basedir'] . "/escaneos_{$evento}.json";
        file_put_contents($file, json_encode($datos, JSON_PRETTY_PRINT));

        return ['url' => $upload_dir['baseurl'] . "/escaneos_{$evento}.json"];
    }

    public function import_json($request) {
        global $wpdb;
        $table = $wpdb->prefix . 'ticketflow_scans';
        $data = $request->get_json_params();

        foreach ($data as $entry) {
            $wpdb->insert($table, [
                'ticket_id'   => intval($entry['ticket_id']),
                'event_id'    => intval($entry['event_id']),
                'user_id'     => intval($entry['user_id']),
                'scan_status' => sanitize_text_field($entry['scan_status']),
                'scan_time'   => sanitize_text_field($entry['scan_time']),
                'synced'      => 1
            ]);
        }

        return ['imported' => count($data)];
    }

  
}

new TicketFlowQR();
