<?php
class TicketFlow_Activator {
    public static function activate() {
        self::setup_database();
        self::setup_roles();
        flush_rewrite_rules();
    }
    public static function deactivate() {
            flush_rewrite_rules();
        }
    private static function setup_database() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'ticketflow_scans';
        $charset_collate = $wpdb->get_charset_collate();
        
        $sql = "CREATE TABLE $table_name (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            event_id BIGINT(20) UNSIGNED NOT NULL,
            event_start_date DATETIME NULL,
            event_end_date DATETIME NULL,
            event_title VARCHAR(255) NULL,
            event_location VARCHAR(255) NULL,
            ticket_id BIGINT(20) UNSIGNED NULL,
            qr_code VARCHAR(255) NULL,
            user_id BIGINT(20) UNSIGNED DEFAULT NULL,
            scan_status VARCHAR(50) DEFAULT 'pendiente',
            scan_time DATETIME DEFAULT NULL,
            synced TINYINT(1) DEFAULT 0,
            tipo VARCHAR(255) NULL,
            PRIMARY KEY (id),
            KEY idx_ticket_id (ticket_id),
            KEY idx_event_id (event_id),
            KEY idx_user_id (user_id),
            KEY idx_scan_status (scan_status),
            UNIQUE KEY unique_ticket_event (ticket_id, event_id)
        ) $charset_collate;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    private static function setup_roles() {
        require_once TICKETFLOW_PATH . 'includes/class-roles.php';
        TicketFlow_Roles::init_roles();
        TicketFlow_Roles::update_user_capabilities();
    }
}