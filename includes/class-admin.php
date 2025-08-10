<?php
class TicketFlow_Admin {
    private static $instance;
    private $pages = [
        'main' => [
            'page_title' => 'TicketFlow',
            'menu_title' => 'TicketFlow',
            'capability' => 'ticketflow_view_dashboard',
            'slug' => 'ticketflow',
            'callback' => 'render_admin_app',
            'icon' => 'dashicons-tickets-alt',
            'position' => 20
        ],
        'scanner' => [
            'page_title' => 'Escanear Tickets',
            'menu_title' => 'Escáner',
            'capability' => 'ticketflow_scan_qr',
            'slug' => 'ticketflow-escanear',
            'callback' => 'render_scanner'
        ],
        'events' => [
            'page_title' => 'Gestión de Eventos',
            'menu_title' => 'Eventos',
            'capability' => 'ticketflow_edit_events',
            'slug' => 'ticketflow-eventos',
            'callback' => 'render_events_manager'
        ],
        'reports' => [
            'page_title' => 'Reportes',
            'menu_title' => 'Reportes',
            'capability' => 'ticketflow_export_qr',
            'slug' => 'ticketflow-reportes',
            'callback' => 'render_reports'
        ]
    ];

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
    }

    /**
     * Creates the admin menu structure
     */
    public function create_admin_menu() {
        // Main menu
        add_menu_page(
            $this->pages['main']['page_title'],
            $this->pages['main']['menu_title'],
            $this->pages['main']['capability'],
            $this->pages['main']['slug'],
            [$this, $this->pages['main']['callback']],
            $this->pages['main']['icon'],
            $this->pages['main']['position']
        );

        // Submenus based on capabilities
        if (current_user_can('ticketflow_edit_events') || current_user_can('manage_options')) {
            $this->add_admin_submenu('events');
            $this->add_admin_submenu('reports');
        }

        if (current_user_can('ticketflow_scan_qr')) {
            $this->add_admin_submenu('scanner');
        }
    }

    private function add_admin_submenu($page_key) {
        add_submenu_page(
            $this->pages['main']['slug'],
            $this->pages[$page_key]['page_title'],
            $this->pages[$page_key]['menu_title'],
            $this->pages[$page_key]['capability'],
            $this->pages[$page_key]['slug'],
            [$this, $this->pages[$page_key]['callback']]
        );
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

    /**
     * Enqueue scripts and styles
     */
    public function enqueue_scripts($hook) {
        $ticketflow_pages = array_map(function($page) {
            return $this->pages['main']['slug'] . '_page_' . $page['slug'];
        }, $this->pages);
        
        $ticketflow_pages[] = 'toplevel_page_' . $this->pages['main']['slug'];

        if (!in_array($hook, $ticketflow_pages)) {
            return;
        }

        $asset_file = include(TICKETFLOW_PATH . 'build/index.asset.php');

        wp_enqueue_script(
            'ticketflow-admin-js',
            TICKETFLOW_URL . 'build/index.js',
            $asset_file['dependencies'],
            $asset_file['version'],
            true
        );

        wp_enqueue_style(
            'ticketflow-admin-css',
            TICKETFLOW_URL . 'build/index.css',
            [],
            $asset_file['version']
        );

        wp_localize_script('ticketflow-admin-js', 'ticketflowAdminData', [
            'api' => [
                'root' => esc_url_raw(rest_url()),
                'base' => esc_url_raw(rest_url('ticketflow/v1')),
                'nonce' => wp_create_nonce('wp_rest')
            ],
            'user' => [
                'id' => get_current_user_id(),
                'roles' => wp_get_current_user()->roles,
                'capabilities' => [
                    'scan' => current_user_can('ticketflow_scan_qr'),
                    'export' => current_user_can('ticketflow_export_qr'),
                    'manage' => current_user_can('ticketflow_edit_events')
                ]
            ],
            'currentPage' => $this->get_current_page($hook),
            'i18n' => [
                'welcome' => __('Bienvenido al panel de TicketFlow', 'ticketflow')
            ]
        ]);
    }

    private function get_current_page($hook) {
        $page_map = [
            'toplevel_page_' . $this->pages['main']['slug'] => 'dashboard',
            $this->pages['main']['slug'] . '_page_' . $this->pages['scanner']['slug'] => 'scanner',
            $this->pages['main']['slug'] . '_page_' . $this->pages['events']['slug'] => 'events',
            $this->pages['main']['slug'] . '_page_' . $this->pages['reports']['slug'] => 'reports'
        ];
        
        return $page_map[$hook] ?? 'dashboard';
    }

    /**
     * Render methods for each page
     */
    public function render_admin_app() {
        $this->render_app_container('wprk-admin-app');
    }

    public function render_scanner() {
        if (!current_user_can('ticketflow_scan_qr')) {
            wp_die(__('No tienes permisos para acceder a esta página', 'ticketflow'));
        }
        $this->render_app_container('ticketflow-scanner-root');
    }

    public function render_events_manager() {
        if (!current_user_can('ticketflow_edit_events')) {
            wp_die(__('No tienes permisos para acceder a esta página', 'ticketflow'));
        }
        $this->render_app_container('ticketflow-events-root');
    }

    public function render_reports() {
        if (!current_user_can('ticketflow_export_qr')) {
            wp_die(__('No tienes permisos para acceder a esta página', 'ticketflow'));
        }
        $this->render_app_container('ticketflow-reports-root');
    }

    private function render_app_container($id) {
        echo '<div class="wrap ticketflow-app">';
        echo '<div id="' . esc_attr($id) . '"></div>';
        echo '</div>';
    }
}