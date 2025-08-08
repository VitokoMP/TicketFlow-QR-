<?php
class TicketFlow_Roles {
    const ROLES_VERSION = '1.2.7'; // Versión actual de la estructura de roles

    public static function init() {
        add_action('init', [self::class, 'init_roles']);
        add_action('admin_init', [self::class, 'update_user_capabilities']);
        add_action('admin_menu', [self::class, 'clean_admin_menu'], 999);
        add_action('admin_init', [self::class, 'redirect_scanners']);
        
        // Registrar hook de activación
        register_activation_hook(__FILE__, [self::class, 'activate']);
    }

    public static function activate() {
        self::check_roles_version();
    }

    public static function check_roles_version() {
        $stored_version = get_option('ticketflow_roles_version', '0');
        
        if (version_compare($stored_version, self::ROLES_VERSION, '<')) {
            self::update_roles();
            update_option('ticketflow_roles_version', self::ROLES_VERSION);
        }
    }

    private static function update_roles() {
        remove_role('escaneador');
        remove_role('ticketflow_productor');
        self::init_roles();
        
        error_log('TicketFlow: Roles actualizados a versión ' . self::ROLES_VERSION);
    }

    public static function init_roles() {
        // Rol Escaneador con prefijos consistentes
        add_role('escaneador', 'Escaneador', [
            'read' => true,
            'ticketflow_scan_qr' => true,
            'ticketflow_view_dashboard' => true,
            'upload_files' => true
        ]);

        // Rol Productor con prefijos consistentes
        add_role('ticketflow_productor', 'Productor de Eventos', [
            'read' => true,
            'ticketflow_export_qr' => true,
            'ticketflow_close_event' => true,
            'ticketflow_view_dashboard' => true,
            'ticketflow_edit_events' => true,
            'upload_files' => true
        ]);

        // Asignar capacidades a Administrador
        $admin = get_role('administrator');
        if ($admin) {
            $admin_caps = [
                'ticketflow_scan_qr',
                'ticketflow_export_qr',
                'ticketflow_view_dashboard',
                'ticketflow_close_event',
                'ticketflow_edit_events'
            ];
            
            foreach ($admin_caps as $cap) {
                $admin->add_cap($cap);
            }
        }
    }

    public static function update_user_capabilities() {
        $escaneadores = get_users(['role' => 'escaneador']);
        foreach ($escaneadores as $usuario) {
            $usuario->add_cap('ticketflow_scan_qr');
            $usuario->add_cap('ticketflow_view_dashboard');
        }

        $productores = get_users(['role' => 'ticketflow_productor']);
        foreach ($productores as $usuario) {
            $usuario->add_cap('ticketflow_view_dashboard');
        }
    }

    public static function clean_admin_menu() {
        if (current_user_can('escaneador')) {
            global $menu;
            
            $allowed = [
                'ticketflow', // Menú principal del plugin
                'profile.php'  // Perfil de usuario
            ];
            
            foreach ($menu as $key => $item) {
                if (!in_array($item[2], $allowed)) {
                    remove_menu_page($item[2]);
                }
            }
        }
    }

    public static function redirect_scanners() {
        if (current_user_can('escaneador') && !defined('DOING_AJAX')) {
            $allowed_pages = ['ticketflow', 'profile.php'];
            $current_page = $_GET['page'] ?? '';
            
            if (!in_array($current_page, $allowed_pages)) {
                wp_redirect(admin_url('admin.php?page=ticketflow'));
                exit;
            }
        }
    }
}