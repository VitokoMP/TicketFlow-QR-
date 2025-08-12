const fs = require('fs');
const path = require('path');

const dependencies = [
    'wp-element',
    'wp-api-fetch',
    'wp-components',
    'heartbeat'
];

const buildDir = path.join(__dirname, 'build');
const assetFile = path.join(buildDir, 'index.asset.php');

if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
}

const content = `<?php return array(
    'dependencies' => ${JSON.stringify(dependencies)},
    'version' => '${Date.now()}'
);`;

fs.writeFileSync(assetFile, content);
console.log(`✅ index.asset.php generado en ${assetFile}`);