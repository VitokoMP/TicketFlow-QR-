<?php
class TicketFlow_Roles {
    const ROLES_VERSION = '1.3.0';

    private static $instance;

    public static function instance() {
        if (!isset(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Only role-related initialization here
        add_action('init', [$this, 'check_roles_version']);
        add_action('admin_init', [$this, 'update_user_capabilities']);
    }

    public function check_roles_version() {
        $stored_version = get_option('ticketflow_roles_version', '0');
        
        if (version_compare($stored_version, self::ROLES_VERSION, '<')) {
            $this->update_roles();
            update_option('ticketflow_roles_version', self::ROLES_VERSION);
        }
    }

    private function update_roles() {
        remove_role('escaneador');
        remove_role('ticketflow_productor');
        $this->init_roles();
        
        error_log('TicketFlow: Roles actualizados a versión ' . self::ROLES_VERSION);
    }

    public function init_roles() {
        // Rol Escaneador
        add_role('escaneador', 'Escaneador', [
            'read' => true,
            'ticketflow_scan_qr' => true,
            'ticketflow_view_dashboard' => true,
            'upload_files' => true
        ]);

        // Rol Productor
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

    public function update_user_capabilities() {
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
}