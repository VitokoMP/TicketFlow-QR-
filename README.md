
# TicketFlow QR

Un plugin para WordPress que permite la validación de entradas mediante códigos QR, sincronización de eventos y asistentes, y una interfaz moderna construida con React.

---

## 🚀 Características principales

- Escaneo de entradas mediante QR
- Panel de administración en React
- Roles personalizados: Productor de Eventos, Escaneador
- Gestión y sincronización de eventos y asistentes
- Registro de escaneos en base de datos personalizada
- API REST integrada para consumo móvil y frontend React
- Estilos modernos y estructura modular

---

## 🛠 Requisitos

- WordPress 5.0 o superior
- PHP 7.4+
- Node.js y npm (solo para desarrollo React)
- Plugin debe estar activo

---

## 📦 Instalación y uso

1. Cloná el repositorio o copiá la carpeta `ticketflow-qr` al directorio `wp-content/plugins/`.
2. Activá el plugin desde el panel de WordPress.
3. Ejecutá en consola (solo para desarrollo del frontend):

```bash
npm install
npm start
```

4. Para crear el build de producción:

```bash
npm run build
```

5. El panel de React está disponible en el menú lateral de WordPress bajo **"TicketFlow"**.

---

## 🔐 Roles personalizados

- `ticketflow_productor`:
  - Puede exportar QR y cerrar eventos
- `escaneador`:
  - Puede acceder solo al panel del escáner

---

## 📡 Rutas REST disponibles

- `POST /ticketflow/v1/mep_sincronizar_eventos_y_asistentes`
- `GET  /ticketflow/v1/eventos-activos`
- `GET  /ticketflow/v1/events`
- `GET  /ticketflow/v1/asistentes`
- `GET  /ticketflow/v1/sync-attendees/{event_id}`
- `GET  /ticketflow/v1/escanear/{event_id}/{qr_code}`
- `POST /ticketflow/v1/mark-as-scanned/{id}`

---

## 🧪 Tecnologías utilizadas

- **React 18**
- **Webpack 5**
- **Axios** para HTTP
- **pdf-lib** para generación de PDFs
- **file-saver** para descargas
- **php-serialize** y **php-unserialize** para compatibilidad
- **REST API de WordPress**
- **jQuery UI Sortable** para ordenamiento dinámico

---

## 📃 Licencia

Este proyecto se distribuye bajo la licencia **Apache 2.0**.  
Autor: AlekhArt.codes  
GitHub: [@VitokoMp](https://github.com/VitokoMp)

---

**Optimizado por AlekhArt.codes — Tecnología abierta para eventos eficientes.**
