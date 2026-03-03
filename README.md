# TicketFlow QR

A WordPress plugin that allows ticket validation using QR codes, event and attendee synchronization, and a modern interface built with React.

---

## 🚀 Key Features

- Ticket scanning via QR codes
- React-based administration panel
- Custom roles: Event Producer, Scanner
- Event and attendee management and synchronization
- Scan logging in a custom database table
- Integrated REST API for mobile consumption and React frontend
- Modern styles and modular structure

---

## 🛠 Requirements

- WordPress 5.0 or higher
- PHP 7.4+
- Node.js and npm (React development only)
- Plugin must be active

---

## 📦 Installation and Usage

1. Clone the repository or copy the `ticketflow-qr` folder into the `wp-content/plugins/` directory.
2. Activate the plugin from the WordPress admin panel.
3. Run in the console (frontend development only):

```bash
npm install
npm start
To create a production build:

npm run build
The React panel is available in the WordPress sidebar menu under "TicketFlow".

🔐 Custom Roles
ticketflow_productor
Can export QR codes
Can close events

escaneador
Can access only the scanner panel

📡 Available REST Routes
POST /ticketflow/v1/mep_sincronizar_eventos_y_asistentes
GET  /ticketflow/v1/eventos-activos
GET  /ticketflow/v1/events
GET  /ticketflow/v1/asistentes
GET  /ticketflow/v1/sync-attendees/{event_id}
GET  /ticketflow/v1/escanear/{event_id}/{qr_code}
POST /ticketflow/v1/mark-as-scanned/{id}

🧪 Technologies Used
React 18
Webpack 5
Axios for HTTP requests
pdf-lib for PDF generation
file-saver for downloads
php-serialize and php-unserialize for compatibility
WordPress REST API
jQuery UI Sortable for dynamic ordering

📃 License
This project is distributed under the Apache 2.0 license.

Author: AlekhArt.codes
GitHub: @VitokoMp

Optimized by AlekhArt.codes — Open technology for efficient events.
