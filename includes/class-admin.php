<?php
class TicketFlow_Admin {
    public function __construct() {
        add_action('admin_menu', [$this, 'create_admin_menu']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_scripts']);
        
        // Mover aquí tu función wprk_limit_admin_menu_for_scanner
        add_action('admin_menu', [$this, 'limit_admin_menu_for_scanner'], 999);
    }

    public function create_admin_menu() {
        // Mover aquí tu función crear_menu_admin
        add_menu_page(
            'TicketFlow',
            'TicketFlow',
            'ver_dashboard',
            'ticketflow',
            [$this, 'render_dashboard'],
            'dashicons-tickets-alt',
            20
        );

        add_submenu_page(
            'ticketflow',
            'Escaneos',
            'Escaneos',
            'escanear_qr',
            'ticketflow-escanear',
            [$this, 'render_scanner']
        );

        add_submenu_page(
            'wprk-settings',
            'Diagnóstico',
            'Diagnóstico',
            'manage_options',
            'ticketflow-diagnostico',
            [$this, 'mostrar_pagina_diagnostico']
        );
    }

    public function enqueue_scripts($hook) {
        // Mover aquí tu función enqueue_scripts actual
        if ($hook !== 'toplevel_page_wprk-settings') {
            return;
        }

        wp_enqueue_script('jquery-ui-sortable');
        wp_enqueue_script(
            'my-react-app',
            TICKETFLOW_URL . 'dist/bundle.js',
            ['wp-element', 'jquery', 'jquery-ui-sortable'],
            null,
            true
        );

        wp_localize_script('my-react-app', 'appLocalizer', [
            'apiUrl' => esc_url(rest_url('ticketflow/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        ]);
    }

    public function limit_admin_menu_for_scanner() {
        // Implementación de wprk_limit_admin_menu_for_scanner
        if (current_user_can('escaneador')) {
            global $menu, $submenu;
            
            $allowed = [
                'wprk-settings' => [],
                'profile.php'   => [],
            ];
            
            foreach ($menu as $key => $item) {
                if (!array_key_exists($item[2], $allowed)) {
                    remove_menu_page($item[2]);
                }
            }
        }
    }

    // Añade aquí el resto de tus métodos (render_dashboard, render_scanner, etc.)
}