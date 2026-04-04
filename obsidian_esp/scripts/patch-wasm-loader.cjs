const fs = require('fs');
const path = require('path');

const targetPath = path.resolve(
  __dirname,
  '..',
  'obsidian_plugin',
  'pkg',
  'obsidian_esp.js',
);

const content = fs.readFileSync(targetPath, 'utf8');
const updated = content.replace(
  /module_or_path = new URL\('obsidian_esp_bg\.wasm', import\.meta\.url\);/,
  "module_or_path = 'obsidian_esp_bg.wasm';",
);

if (content === updated) {
  console.error('Generated wasm loader patch was not applied.');
  process.exit(1);
}

fs.writeFileSync(targetPath, updated);
