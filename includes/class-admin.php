<?php
class TicketFlow_Admin {
    public function __construct() {
        add_action('admin_menu', [$this, 'create_admin_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_menu', [$this, 'adjust_menu_for_scanners'], 999);
    }

    public function create_admin_menu() {
        // Menú principal para todos los usuarios con acceso
        add_menu_page(
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            'ticketflow_view_dashboard',
            'ticketflow',
            [$this, 'render_admin_app'],
            'dashicons-tickets-alt',
            20
        );

        // Menú completo para administradores y productores
        if (current_user_can('ticketflow_edit_events') || current_user_can('manage_options')) {
            add_submenu_page(
                'ticketflow',
                __('Dashboard', 'wp-react-ticketflow-qr'),
                __('Dashboard', 'wp-react-ticketflow-qr'),
                'ticketflow_view_dashboard',
                'ticketflow',
                [$this, 'render_admin_app']
            );

            add_submenu_page(
                'ticketflow',
                __('Gestión de Eventos', 'wp-react-ticketflow-qr'),
                __('Eventos', 'wp-react-ticketflow-qr'),
                'ticketflow_edit_events',
                'ticketflow-eventos',
                [$this, 'render_events_manager']
            );

            add_submenu_page(
                'ticketflow',
                __('Reportes', 'wp-react-ticketflow-qr'),
                __('Reportes', 'wp-react-ticketflow-qr'),
                'ticketflow_export_qr',
                'ticketflow-reportes',
                [$this, 'render_reports']
            );
        }

        // Menú específico para escaneadores
        if (current_user_can('ticketflow_scan_qr')) {
            add_submenu_page(
                'ticketflow',
                __('Escanear Tickets', 'wp-react-ticketflow-qr'),
                __('Escáner', 'wp-react-ticketflow-qr'),
                'ticketflow_scan_qr',
                'ticketflow-escanear',
                [$this, 'render_scanner']
            );
        }
    }

    public function adjust_menu_for_scanners() {
        if (current_user_can('escaneador')) {
            global $submenu;
            
            // Limpiar submenús no necesarios
            if (isset($submenu['ticketflow'])) {
                foreach ($submenu['ticketflow'] as $key => $item) {
                    if ($item[2] !== 'ticketflow-escanear') {
                        unset($submenu['ticketflow'][$key]);
                    }
                }
            }
        }
    }

    public function enqueue_scripts($hook) {
        $ticketflow_pages = [
            'toplevel_page_ticketflow',
            'ticketflow_page_ticketflow-eventos',
            'ticketflow_page_ticketflow-reportes',
            'ticketflow_page_ticketflow-escanear'
        ];
        
        if (!in_array($hook, $ticketflow_pages)) {
            return;
        }

        wp_enqueue_script(
            'ticketflow-admin-js',
            TICKETFLOW_URL . 'dist/bundle.js',
            ['wp-element', 'wp-api-fetch'],
            filemtime(TICKETFLOW_PATH . 'dist/bundle.js'),
            true
        );

        wp_localize_script('ticketflow-admin-js', 'ticketflowData', [
            'apiUrl' => esc_url_raw(rest_url('ticketflow/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
            'user' => [
                'role' => $this->get_user_role(),
                'can' => [
                    'scan' => current_user_can('ticketflow_scan_qr'),
                    'export' => current_user_can('ticketflow_export_qr'),
                    'manage' => current_user_can('ticketflow_edit_events')
                ]
            ],
            'currentPage' => $this->get_current_page($hook)
        ]);
    }

    private function get_user_role() {
        $user = wp_get_current_user();
        return $user->roles[0] ?? '';
    }

    private function get_current_page($hook) {
        $map = [
            'toplevel_page_ticketflow' => 'dashboard',
            'ticketflow_page_ticketflow-eventos' => 'events',
            'ticketflow_page_ticketflow-reportes' => 'reports',
            'ticketflow_page_ticketflow-escanear' => 'scanner'
        ];
        return $map[$hook] ?? 'dashboard';
    }

    public function render_admin_app() {
        echo '<div class="wrap ticketflow-app">';
        echo '<div id="ticketflow-root"></div>';
        echo '</div>';
    }

    public function render_scanner() {
        echo '<div class="wrap ticketflow-scanner">';
        if (current_user_can('ticketflow_scan_qr')) {
            echo '<div id="ticketflow-scanner-root"></div>';
        } else {
            wp_die(__('No tienes permisos para acceder a esta página', 'wp-react-ticketflow-qr'));
        }
        echo '</div>';
    }

    public function render_events_manager() {
        echo '<div class="wrap ticketflow-events">';
        if (current_user_can('ticketflow_edit_events')) {
            echo '<div id="ticketflow-events-root"></div>';
        } else {
            wp_die(__('No tienes permisos para acceder a esta página', 'wp-react-ticketflow-qr'));
        }
        echo '</div>';
    }

    public function render_reports() {
        echo '<div class="wrap ticketflow-reports">';
        if (current_user_can('ticketflow_export_qr')) {
            echo '<div id="ticketflow-reports-root"></div>';
        } else {
            wp_die(__('No tienes permisos para acceder a esta página', 'wp-react-ticketflow-qr'));
        }
        echo '</div>';
    }
}