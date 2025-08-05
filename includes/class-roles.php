<?php
class TicketFlow_Roles {
    public static function init() {
        add_action('init', [self::class, 'init_roles']);
        add_action('admin_init', [self::class, 'update_user_capabilities']);
        add_action('admin_menu', [self::class, 'clean_admin_menu'], 999);
        add_action('admin_init', [self::class, 'redirect_scanners']);
    }

    public static function init_roles() {
        // Rol Escaneador
        add_role('escaneador', 'Escaneador', [
            'read' => true,
            'escanear_qr' => true,
            'ver_dashboard' => true,
            'manage_wprk_plugin' => true 
        ]);

        // Rol Productor
        add_role('ticketflow_productor', 'Productor de Eventos', [
            'read' => true,
            'exportar_qr' => true,
            'cerrar_evento' => true,
            'ver_dashboard' => true,
            'edit_events' => true
        ]);
        // Rol Administrador de TicketFlow
        $admin = get_role('administrator');
        if ($admin) {
            $admin->add_cap('escanear_qr');
            $admin->add_cap('exportar_qr');
            $admin->add_cap('ver_dashboard');
        }
    }

    public static function update_user_capabilities() {
        // Mover aquí tu función ticketflow_actualizar_permisos_usuarios
        $escaneadores = get_users(['role' => 'escaneador']);
        foreach ($escaneadores as $usuario) {
            $usuario->add_cap('escanear_qr');
            $usuario->add_cap('ver_dashboard');
        }

        $productores = get_users(['role' => 'ticketflow_productor']);
        foreach ($productores as $usuario) {
            $usuario->add_cap('ver_dashboard');
        }
    }

    public static function clean_admin_menu() {
        // Mover aquí tu función ticketflow_limpiar_menu
        if (current_user_can('escaneador')) {
            remove_menu_page('index.php');
            remove_menu_page('edit.php');
        }
    }

    public static function redirect_scanners() {
        // Mover aquí tu función ticketflow_redirigir_escaneadores
        if (current_user_can('escaneador') && !defined('DOING_AJAX')) {
            $allowed_pages = ['wprk-settings', 'profile.php'];
            $current_page = $_GET['page'] ?? '';
            
            if (!in_array($current_page, $allowed_pages)) {
                wp_redirect(admin_url('admin.php?page=wprk-settings'));
                exit;
            }
        }
    }
}