// Génère la liste EXACTE des fichiers de l'application : le désinstalleur ne supprime que ceux-là,
// jamais le reste (Jeux, Émulateurs, Sauvegardes…).
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', 'dist', 'win-unpacked');
const lines = ['; Généré par gen-uninst.js — ne pas modifier', '!macro RemoveAppFiles DIR'];
for (const e of fs.readdirSync(src, { withFileTypes: true })) {
  if (e.isDirectory()) lines.push(`  RMDir /r "\${DIR}\\${e.name}"`);
  else lines.push(`  Delete "\${DIR}\\${e.name}"`);
}
lines.push('  Delete "${DIR}\\Désinstaller Arcadia.exe"');
lines.push('  RMDir "${DIR}" ; seulement s\'il est vide');
lines.push('!macroend');
fs.writeFileSync(path.join(__dirname, 'uninst_files.nsh'), '\ufeff' + lines.join('\r\n') + '\r\n');
console.log(lines.length - 3, 'entrées');
