<?php
class TicketFlow_CPT {
    private static $instance;

    public static function instance() {
        if (!isset(self::$instance)) {
            self::$instance = new self();
            self::$instance->init();
        }
        return self::$instance;
    }

    private function __construct() {
        // Constructor is private to prevent direct instantiation
    }

    private function init() {
        add_action('init', [$this, 'register_event_post_type']);
    }

    public function register_event_post_type() {
        $labels = [
            'name' => __('Eventos', 'wp-react-ticketflow-qr'),
            'singular_name' => __('Evento', 'wp-react-ticketflow-qr'),
            // ... más etiquetas
        ];

        $args = [
            'labels' => $labels,
            'public' => true,
            'show_in_rest' => true, // Importante para Gutenberg
            'capability_type' => 'event',
            'capabilities' => [
                'edit_post' => 'edit_event',
                'read_post' => 'read_event',
                'delete_post' => 'delete_event',
                'edit_posts' => 'edit_events',
                'edit_others_posts' => 'edit_others_events',
                'publish_posts' => 'publish_events',
                'read_private_posts' => 'read_private_events',
            ],
            'map_meta_cap' => true, // Mapeo automático de capacidades
            'supports' => ['title', 'editor', 'thumbnail', 'custom-fields'],
            'rewrite' => ['slug' => 'eventos'],
            'menu_icon' => 'dashicons-tickets-alt'
        ];

        register_post_type('ticketflow_event', $args);
    }
}