// Mini lecteur / écrivain ZIP (deflate), sans dépendance : pour les copies de sauvegardes (petits fichiers).
const fs = require('fs');
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

// entries: [{ name, data: Buffer, mtime?: Date }]
function writeZip(file, entries) {
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = e.data;
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = comp.length < raw.length;
    const body = useDeflate ? comp : raw;
    const { time, date } = dosTime(e.mtime || new Date());
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, body);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  fs.writeFileSync(file + '.part', Buffer.concat([...parts, cd, end]));
  fs.renameSync(file + '.part', file);
}

// -> [{ name, data() }]
function readZip(file) {
  const buf = fs.readFileSync(file);
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP illisible');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP abîmé');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const body = buf.subarray(dataStart, dataStart + csize);
    out.push({ name, data: () => (method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body)) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// Noms des fichiers d'un .zip sans le charger en mémoire (lit seulement le répertoire central) ; null si illisible
function zipNames(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, tail = Math.min(size, 65557);
    const end = Buffer.alloc(tail); fs.readSync(fd, end, 0, tail, size - tail);
    let e = tail - 22; while (e >= 0 && end.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) return null;
    const count = end.readUInt16LE(e + 10), cdSize = end.readUInt32LE(e + 12), cdOff = end.readUInt32LE(e + 16);
    if (cdOff === 0xffffffff || cdSize > 64 * 1024 * 1024) return null; // zip64 : pas un firmware
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = []; let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
    }
    return names;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ } }
}

module.exports = { writeZip, readZip, zipNames, crc32 };
