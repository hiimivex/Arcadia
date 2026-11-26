// Ouverture automatique d'un port sur la box (UPnP IGD), sans dépendance : découverte SSDP + requête SOAP.
// Sert au multijoueur en ligne entre amis : l'hôte ouvre son port, les amis s'y connectent directement.
const dgram = require('dgram');

const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

function discover(timeout = 2500) {
  return new Promise(resolve => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Set();
    const done = () => { try { sock.close(); } catch { /* */ } resolve([...found]); };
    sock.on('message', msg => { const m = /^location:\s*(.+)$/im.exec(msg.toString()); if (m) found.add(m[1].trim()); });
    sock.on('error', done);
    sock.bind(() => {
      for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'ssdp:all']) {
        const q = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(q, 1900, '239.255.255.250');
      }
    });
    setTimeout(done, timeout);
  });
}

// Adresse de contrôle (controlURL) du service WAN de la box
async function gateway(fetch) {
  for (const loc of await discover()) {
    try {
      const xml = await (await fetch(loc)).text();
      for (const type of SERVICES) {
        const i = xml.indexOf(`<serviceType>${type}</serviceType>`);
        if (i < 0) continue;
        const block = xml.slice(i, xml.indexOf('</service>', i));
        const ctl = /<controlURL>\s*([^<]+)\s*<\/controlURL>/i.exec(block);
        if (ctl) return { type, url: new URL(ctl[1], loc).href, host: new URL(loc).hostname };
      }
    } catch { /* appareil qui ne répond pas */ }
  }
  return null;
}

async function soap(fetch, gw, action, args) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gw.type}">${
    Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const r = await fetch(gw.url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.type}#${action}"` }, body });
  const text = await r.text();
  if (!r.ok) { const e = /<errorDescription>([^<]*)</i.exec(text); throw new Error(e ? e[1] : `HTTP ${r.status}`); }
  return text;
}

// Ouvre port/protocole vers ce PC ; renvoie { ok, close() }
async function openPort({ fetch, port, protocol = 'UDP', localIp, description = 'Arcadia', lease = 0 }) {
  try {
    const gw = await gateway(fetch);
    if (!gw) return { ok: false, error: 'box sans UPnP (ou UPnP désactivé)' };
    const args = { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol, NewInternalPort: port, NewInternalClient: localIp, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: lease };
    try { await soap(fetch, gw, 'AddPortMapping', args); }
    catch (e) { if (lease === 0) await soap(fetch, gw, 'AddPortMapping', { ...args, NewLeaseDuration: 7200 }); else throw e; } // certaines box refusent un bail illimité
    let ext = null; try { ext = /<NewExternalIPAddress>([^<]*)</i.exec(await soap(fetch, gw, 'GetExternalIPAddress', {}))?.[1] || null; } catch { /* */ }
    return { ok: true, externalIp: ext, close: () => soap(fetch, gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol }).catch(() => {}) };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { openPort, discover };
