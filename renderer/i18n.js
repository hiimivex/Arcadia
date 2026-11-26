// Arcadia — traduction de l'interface (français → anglais), sans toucher au code des écrans :
// chaque texte affiché est traduit à la volée (correspondance exacte, modèles « {0} », puis fragments longs).
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const D = isNode ? require('./i18n-data.js') : g.ARCADIA_I18N_DATA;
  const EX = new Map(Object.entries(D.ex));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PAT = D.pat.map(([fr, en]) => ({ re: new RegExp('^' + fr.split(/\{\d+\}/).map(esc).join('([\\s\\S]*?)') + '$'), order: (fr.match(/\{\d+\}/g) || []).map(x => +x.slice(1, -1)), en }));
  const SUB = D.sub.map(k => [k, D.ex[k]]);
  const cache = new Map();
  let lang = 'fr';

  function core(c) {
    const n = c.replace(/\s+/g, ' ');
    const e = EX.get(n);
    if (e !== undefined) return e;
    for (const p of PAT) {
      const m = p.re.exec(n);
      if (!m) continue;
      const val = {};
      p.order.forEach((idx, k) => { const v = m[k + 1]; val[idx] = EX.get(v.trim()) ?? v; });
      return p.en.replace(/\{(\d+)\}/g, (_, i) => val[i] ?? '');
    }
    let out = n, hit = false;
    for (const [k, v] of SUB) if (out.length >= k.length && out.includes(k)) { out = out.split(k).join(v); hit = true; }
    return hit ? out : c;
  }
  function t(s) {
    if (lang !== 'en' || typeof s !== 'string' || !s || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
    let r = cache.get(s);
    if (r !== undefined) return r;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const c = core(m[2]);
    r = c === m[2] ? s : m[1] + c + m[3];
    if (cache.size > 20000) cache.clear();
    cache.set(s, r);
    return r;
  }

  const api = { t, get lang() { return lang; }, setLang(l) { lang = l === 'en' ? 'en' : 'fr'; cache.clear(); }, locale: () => (lang === 'en' ? 'en-GB' : 'fr-FR') };

  if (isNode) { module.exports = api; return; }

  // ——— Navigateur : traduction automatique du DOM ———
  try { api.setLang(localStorage.getItem('arcadiaLang') || 'fr'); } catch (_) {}
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  const done = new WeakMap();
  function trText(node) {
    const p = node.parentNode;
    if (!p || SKIP.has(p.nodeName) || (p.closest && p.closest('[data-notr]'))) return;
    const v = node.nodeValue;
    if (done.get(node) === v) return;
    const r = t(v);
    if (r !== v) node.nodeValue = r;
    done.set(node, r);
  }
  function trAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const r = t(v); if (r !== v) el.setAttribute(a, r); }
    }
    if (el.nodeName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { const r = t(el.value); if (r !== el.value) el.value = r; }
  }
  function walk(root) {
    if (root.nodeType === 3) return trText(root);
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    if (root.closest && root.closest('[data-notr]')) return;
    trAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) trText(n); else trAttrs(n); }
  }
  let obs = null;
  function start() {
    if (lang !== 'en' || obs) return;
    walk(document.documentElement);
    document.title = t(document.title);
    obs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') trText(m.target);
        else if (m.type === 'attributes') trAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  const oc = g.confirm, oa = g.alert;
  g.confirm = m => oc.call(g, t(m));
  g.alert = m => oa.call(g, t(m));
  api.start = start;
  api.apply = l => { try { localStorage.setItem('arcadiaLang', l); } catch (_) {} };
  g.I18N = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(this);
