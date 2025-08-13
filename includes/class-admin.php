<?php
class TicketFlow_Admin {
    private static $instance;

    public static function instance() {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('admin_menu', [$this, 'create_admin_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        add_action('admin_menu', [$this, 'adjust_menu_for_scanners'], 999);
        add_action('admin_init', [$this, 'redirect_scanners']);
        add_action('admin_menu', [$this, 'remove_main_submenu'], 999);

    }

    /**
     * Creates the admin menu structure
     */
    public function create_admin_menu() {
        // Main menu for all authorized users
        add_menu_page(
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            __('TicketFlow', 'wp-react-ticketflow-qr'),
            'ticketflow_view_dashboard',
            'ticketflow',
            [$this, 'render_admin_app'],
            'dashicons-tickets-alt',
            20
        );

        // Full menu for admins and producers. Para uso futuro: menú de administración completo
       /* if (current_user_can('ticketflow_edit_events') || current_user_can('manage_options')) {
            add_submenu_page(
                'ticketflow',
                __('Dashboard', 'wp-react-ticketflow-qr'),
                __('Dashboard', 'wp-react-ticketflow-qr'),
                'ticketflow_view_dashboard',
                'ticketflow',
                [$this, 'render_admin_app']
            );

            /*add_submenu_page(
                'ticketflow',
                __('Gestión de Eventos', 'wp-react-ticketflow-qr'),
                __('Eventos', 'wp-react-ticketflow-qr'),
                'ticketflow_edit_events',
                'ticketflow-eventos',
                [$this, 'render_events_manager']
            );*/

            /*add_submenu_page(
                'ticketflow',
                __('Reportes', 'wp-react-ticketflow-qr'),
                __('Reportes', 'wp-react-ticketflow-qr'),
                'ticketflow_export_qr',
                'ticketflow-reportes',
                [$this, 'render_reports']
            );*/
        //}

        // Scanner-specific menu
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

    /**
     * Adjusts menu for scanner users
     */
    public function adjust_menu_for_scanners() {
        if (!current_user_can('escaneador')) {
            return;
        }

        global $submenu, $menu;
        
        // Clean up TicketFlow submenu
        if (isset($submenu['ticketflow'])) {
            foreach ($submenu['ticketflow'] as $key => $item) {
                if ($item[2] !== 'ticketflow-escanear') {
                    unset($submenu['ticketflow'][$key]);
                }
            }
        }

        // Clean up other admin menus
        $allowed = ['ticketflow', 'profile.php'];
        foreach ($menu as $key => $item) {
            if (!in_array($item[2], $allowed)) {
                remove_menu_page($item[2]);
            }
        }
    }

    /**
     * Redirects scanner users to scanner page
     */
    public function redirect_scanners() {
        if (!current_user_can('escaneador') || defined('DOING_AJAX')) {
            return;
        }

        $allowed_pages = ['ticketflow', 'profile.php'];
        $current_page = $_GET['page'] ?? '';
        
        if (!in_array($current_page, $allowed_pages)) {
            wp_redirect(admin_url('admin.php?page=ticketflow'));
            exit;
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
                'id' => get_current_user_id(),
                'role' => $this->get_user_role(),
                'can' => [
                    'scan' => current_user_can('ticketflow_scan_qr'),
                    'export' => current_user_can('ticketflow_export_qr'),
                    'manage' => current_user_can('ticketflow_edit_events')
                ]
            ],
            'currentPage' => $this->get_current_page($hook),
            'wpRestConfig' => [
                'root' => esc_url_raw(rest_url()),
                'nonce' => wp_create_nonce('wp_rest'),
                'versionString' => 'wp/v2/'
            ]
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
        echo '<div class="wrap ticketflow-app-admin">';
        echo '<div id="wprk-admin-app-qr"></div>';
        echo '</div>';
    }

    public function render_scanner() {
        echo '<div class="wrap ticketflow-app">';
        if (current_user_can('ticketflow_scan_qr')) {
            echo '<div id="wprk-admin-app"></div>';
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

    public function remove_main_submenu() {
    global $submenu;

    if (isset($submenu['ticketflow'])) {
        foreach ($submenu['ticketflow'] as $key => $item) {
            if ($item[2] === 'ticketflow') { // slug de la página principal
                unset($submenu['ticketflow'][$key]);
            }
        }
        // Reindexar
        $submenu['ticketflow'] = array_values($submenu['ticketflow']);
    }
}

}