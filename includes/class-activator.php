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
        scan_status VARCHAR(50) DEFAULT 'pending',
        scan_time DATETIME DEFAULT NULL,
        synced TINYINT(1) DEFAULT 0,
        tipo VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ticket_event_tipo (ticket_id, event_id, tipo),
        KEY idx_event_qr (event_id, qr_code),
        KEY idx_ticket_event (ticket_id, event_id),
        KEY idx_scan_metrics (event_id, scan_status, scan_time)
    ) $charset_collate";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
}


    private static function setup_roles() {
        require_once TICKETFLOW_PATH . 'includes/class-roles.php';
        TicketFlow_Roles::init_roles();
        TicketFlow_Roles::update_user_capabilities();
    }
    
}