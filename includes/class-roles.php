<?php
class TicketFlow_Roles {
    const ROLES_VERSION = '1.3.7';

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

    public static function init_roles() {
        // Rol Escaneador
                // Ejemplo en PHP al crear roles:
        add_role('escaneador', 'Escaneador', [
        'read' => true,
        'view_woocommerce_reports' => true,
        'read_private_products' => true,
        'read_product' => true,
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

    public static function update_user_capabilities() {
    // Todos los usuarios con rol 'escaneador' obtienen estas capacidades
    $role = get_role('escaneador');
    if ($role) {
        $role->add_cap('ticketflow_scan_qr');
        $role->add_cap('ticketflow_view_dashboard');
        $role->add_cap('edit_products'); // si quieres editar productos
        $role->add_cap('manage_woocommerce');
    }

    // Todos los usuarios con rol 'ticketflow_productor' obtienen esta capacidad
    $role = get_role('ticketflow_productor');
    if ($role) {
        $role->add_cap('ticketflow_view_dashboard');
        $role->add_cap('edit_products'); // si quieres editar productos
        $role->add_cap('manage_woocommerce');
    }
    }
}