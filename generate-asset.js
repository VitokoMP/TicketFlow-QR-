const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, 'build');
const assetFile = path.join(buildDir, 'index.asset.php');

const dependencies = [
  'wp-element',      // React
  'wp-components',   // Componentes WP
  'wp-i18n',         // Traducción __()
  'wp-heartbeat',    // Heartbeat API
  'wp-api-fetch'     // AJAX simplificado
];

const version = Date.now();

const content = `<?php return array(
    'dependencies' => ${JSON.stringify(dependencies)},
    'version' => '${version}',
);`;

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir);
}

fs.writeFileSync(assetFile, content);
console.log(`✅ index.asset.php generado en ${assetFile}`);
