#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const patches = {
  en: {
    'settings.overview.title': 'Overview',
    'settings.overview.subtitle': 'Command center: quick actions, needs attention, and recent settings.',
    'settings.permissions.description': 'Allowlists and blocked tools for Explore and Execute (not the Runtime approval mode)',
  },
  ru: {
    'settings.overview.title': 'Обзор',
    'settings.overview.subtitle': 'Командный центр: быстрые действия, что требует внимания и недавние настройки.',
    'settings.permissions.description': 'Списки разрешений и заблокированные инструменты для Обзора и Выполнения (не режим подтверждений в Runtime)',
  },
};

for (const [loc, keys] of Object.entries(patches)) {
  const file = path.join('packages/shared/src/i18n/locales', `${loc}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(data, keys);
  const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  console.log('patched', loc);
}
