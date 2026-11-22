// Lecture minimale d'images disque : ISO9660 (PSP, PS1, PS2, PS3) en 2048 ou 2352 octets/secteur.
const fs = require('fs');

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  const n = fs.readSync(fd, b, 0, len, pos);
  return b.subarray(0, n);
}

class IsoReader {
  constructor(fd) {
    this.fd = fd;
    // Formats possibles : ISO "propre" (2048), CD brut MODE2 (2352, données à +24), MODE1 (2352, +16)
    const layouts = [[2048, 0], [2352, 24], [2352, 16]];
    this.ok = false;
    for (const [size, off] of layouts) {
      const pvd = readAt(fd, 16 * size + off, 2048);
      if (pvd.length >= 190 && pvd[0] === 1 && pvd.toString('ascii', 1, 6) === 'CD001') {
        this.sectorSize = size; this.dataOff = off; this.ok = true;
        this.rootLba = pvd.readUInt32LE(156 + 2);
        this.rootSize = pvd.readUInt32LE(156 + 10);
        break;
      }
    }
  }
  readBytes(lba, size) {
    if (this.sectorSize === 2048) return readAt(this.fd, lba * 2048, size);
    const out = [];
    let left = size, sector = lba;
    while (left > 0) {
      const chunk = readAt(this.fd, sector * this.sectorSize + this.dataOff, Math.min(2048, left));
      if (!chunk.length) break;
      out.push(chunk); left -= chunk.length; sector++;
    }
    return Buffer.concat(out);
  }
  listDir(lba, size) {
    const buf = this.readBytes(lba, Math.min(size, 256 * 1024));
    const entries = [];
    let p = 0;
    while (p < buf.length) {
      const len = buf[p];
      if (!len) { p = (Math.floor(p / 2048) + 1) * 2048; continue; }
      const nameLen = buf[p + 32];
      let name = buf.toString('latin1', p + 33, p + 33 + nameLen).replace(/;1$/, '');
      if (nameLen === 1 && (buf[p + 33] === 0 || buf[p + 33] === 1)) name = buf[p + 33] === 0 ? '.' : '..';
      entries.push({ name, lba: buf.readUInt32LE(p + 2), size: buf.readUInt32LE(p + 10), dir: !!(buf[p + 25] & 2) });
      p += len;
    }
    return entries.filter(e => e.name !== '.' && e.name !== '..');
  }
  root() { return this.listDir(this.rootLba, this.rootSize); }
  find(pathStr) {
    let entries = this.root(), hit = null;
    for (const part of pathStr.split('/')) {
      hit = entries.find(e => e.name.toUpperCase() === part.toUpperCase());
      if (!hit) return null;
      if (hit.dir) entries = this.listDir(hit.lba, hit.size);
    }
    return hit;
  }
  readFile(pathStr, max = 4 * 1024 * 1024) {
    const e = this.find(pathStr);
    if (!e || e.dir || e.size > max) return null;
    return this.readBytes(e.lba, e.size);
  }
}

// PARAM.SFO (PSP, PS3, PS4) -> { TITLE, TITLE_ID, ... }
function parseSfo(buf) {
  if (!buf || buf.length < 20 || buf.readUInt32BE(0) !== 0x00505346) return null;
  const keyStart = buf.readUInt32LE(8), dataStart = buf.readUInt32LE(12), count = buf.readUInt32LE(16);
  const out = {};
  for (let i = 0; i < count && i < 256; i++) {
    const e = 20 + i * 16;
    const keyOff = buf.readUInt16LE(e), fmt = buf.readUInt16LE(e + 2), len = buf.readUInt32LE(e + 4), dataOff = buf.readUInt32LE(e + 12);
    const kEnd = buf.indexOf(0, keyStart + keyOff);
    const key = buf.toString('utf8', keyStart + keyOff, kEnd);
    const d = buf.subarray(dataStart + dataOff, dataStart + dataOff + len);
    out[key] = fmt === 0x0404 ? d.readUInt32LE(0) : d.toString('utf8').replace(/\0+$/, '');
  }
  return out;
}

module.exports = { IsoReader, parseSfo, readAt };
