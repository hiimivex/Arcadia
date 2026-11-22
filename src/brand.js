// Moteur externe « aux couleurs d'Arcadia » : copie de l'exécutable avec l'icône Arcadia,
// pour que la barre des tâches montre Arcadia et pas le logo de l'émulateur. L'original n'est jamais modifié.
const fs = require('fs');
const path = require('path');

function brandedExe(exe, name, iconFile, { description = 'Arcadia' } = {}) {
  if (process.platform !== 'win32' || !exe || !fs.existsSync(exe) || !fs.existsSync(iconFile)) return exe;
  const out = path.join(path.dirname(exe), name);
  const stamp = out + '.source';
  const src = fs.statSync(exe);
  const sig = `${src.size}:${Math.round(src.mtimeMs)}:${description}:v2`;
  try { if (fs.existsSync(out) && fs.readFileSync(stamp, 'utf8') === sig) return out; } catch { /* à refaire */ }
  try {
    const ResEdit = require('resedit');
    const bin = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(bin);
    const ico = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    if (groups.length) for (const g of groups) ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
    else ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map(i => i.data));
    // nom affiché par Windows (mélangeur de volume, gestionnaire des tâches) : « Arcadia »
    let vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
    if (!vi) { vi = ResEdit.Resource.VersionInfo.createEmpty(); vi.lang = 1033; }
    const langs = vi.getAllLanguagesForStringValues();
    for (const l of (langs.length ? langs : [{ lang: 1033, codepage: 1200 }])) vi.setStringValues(l, { FileDescription: description, ProductName: 'Arcadia', InternalName: 'Arcadia' });
    vi.outputToResourceEntries(res.entries);
    res.outputResource(bin);
    fs.writeFileSync(out + '.tmp', Buffer.from(bin.generate()));
    fs.renameSync(out + '.tmp', out);
    fs.writeFileSync(stamp, sig);
    return out;
  } catch { try { fs.unlinkSync(out + '.tmp'); } catch { /* rien */ } return exe; }
}

module.exports = { brandedExe };
