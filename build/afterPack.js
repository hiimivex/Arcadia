// Pose l'icône et les infos de version sur Arcadia.exe sans passer par Wine/rcedit.
const fs = require('fs');
const path = require('path');
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const v = context.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0);
    vi.setProductVersion(v[0], v[1], v[2], 0);
    const l = vi.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
    vi.setStringValues(l, {
      FileDescription: 'Arcadia', ProductName: 'Arcadia', CompanyName: 'Ivex',
      LegalCopyright: 'GPL-3.0', OriginalFilename: 'Arcadia.exe', InternalName: 'Arcadia'
    });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • icône et version posées sur', path.basename(exePath));
};
