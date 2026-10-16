/* Startseite der Materialsammlung: Katalog laden, Navigation durch Ordner, unscharfe Suche.
   Keine externen Bibliotheken – läuft auch in Schulnetzen, die CDNs blockieren. */
(function () {
  'use strict';

  // Farbenblind-sichere Palette (Okabe-Ito) für Fächer ohne eigene Farbe in ordner.json
  const FARBEN = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9'];
  const STOPP = new Set(['der', 'die', 'das', 'und', 'oder', 'fuer', 'mit', 'von', 'zu', 'zum', 'zur',
    'im', 'in', 'am', 'an', 'ein', 'eine', 'einer', 'den', 'dem', 'des', 'auf', 'bei']);

  const $ = (s) => document.querySelector(s);

  function h(tag, attrs, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinder.flat()) if (kind != null && kind !== false) el.append(kind);
    return el;
  }

  // ---------- Text-Normalisierung und Ähnlichkeit ----------

  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  const tokens = (s) => norm(s).split(' ').filter(Boolean);
  const woerter = (s) => (s || '').match(/[\p{L}\p{N}]+/gu) || [];

  // Optimal String Alignment (Levenshtein + vertauschte Nachbarbuchstaben), bricht früh ab
  function abstand(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let vor = null;
    let alt = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const neu = [i];
      let zeilenMin = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(alt[j] + 1, neu[j - 1] + 1, alt[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, vor[j - 2] + 1);
        neu[j] = v;
        if (v < zeilenMin) zeilenMin = v;
      }
      if (zeilenMin > max) return max + 1;
      vor = alt;
      alt = neu;
    }
    return alt[b.length];
  }

  const maxAbstand = (q) => (q.length <= 3 ? 0 : q.length === 4 ? 1 : q.length <= 9 ? 2 : 3);

  const cache = new Map();
  function aehnlich(q, t) {
    const k = q + '|' + t;
    if (cache.has(k)) return cache.get(k);
    let s = 0;
    if (t === q) s = 1;
    else if (q.length >= 2 && t.startsWith(q)) s = 0.9;
    else if (q.length >= 4 && t.includes(q)) s = 0.75;
    else {
      const max = maxAbstand(q);
      if (max) {
        const d = abstand(q, t, max);
        if (d <= max) s = 0.7 - 0.15 * d;
        if (t.length > q.length + 1) {
          const dp = abstand(q, t.slice(0, q.length), max);
          if (dp <= max) s = Math.max(s, 0.6 - 0.15 * dp);
        }
      }
    }
    if (cache.size > 50000) cache.clear();
    cache.set(k, s);
    return s;
  }

  // ---------- Daten ----------

  let kategorien = new Map();
  let materialien = [];
  let faecher = [];
  let wortschatz = new Map();
  let demo = false;
  const BASISTITEL = document.title;

  const schoen = (s) => { const t = s.replace(/[-_]+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  const pad = (n) => String(n ?? 100).padStart(5, '0');

  function vorbereiten(daten) {
    kategorien = new Map();
    for (const k of daten.kategorien || []) kategorien.set(k.pfad.join('/'), { ...k });
    for (const m of daten.materialien || []) {
      for (let i = 1; i <= m.pfad.length; i++) {
        const key = m.pfad.slice(0, i).join('/');
        if (!kategorien.has(key)) kategorien.set(key, { pfad: m.pfad.slice(0, i), titel: schoen(m.pfad[i - 1]), beschreibung: '', reihenfolge: 100 });
      }
    }
    const nachRang = (a, b) => (a.reihenfolge ?? 100) - (b.reihenfolge ?? 100) || a.titel.localeCompare(b.titel, 'de');
    faecher = [...kategorien.values()].filter((k) => k.pfad.length === 1).sort(nachRang);
    faecher.forEach((f, i) => { f.farbe = f.farbe || FARBEN[i % FARBEN.length]; });

    // Sortierschlüssel: Kategorien nach Reihenfolge/Titel, direkte Materialien vor Unterordnern
    for (const k of [...kategorien.values()].sort((a, b) => a.pfad.length - b.pfad.length)) {
      const eltern = kategorien.get(k.pfad.slice(0, -1).join('/'));
      k.schluessel = (eltern ? eltern.schluessel : '') + '\u0001' + pad(k.reihenfolge) + k.titel.toLowerCase();
    }

    wortschatz = new Map();
    const merke = (text, gewicht) => {
      for (const w of woerter(text)) {
        const n = norm(w);
        if (n.length < 3 || /^\d+$/.test(n)) continue;
        const e = wortschatz.get(n);
        if (e) e.n += gewicht; else wortschatz.set(n, { wort: w, n: gewicht });
      }
    };

    materialien = (daten.materialien || []).map((m, i) => {
      const ort = m.pfad.map((_, j) => kategorien.get(m.pfad.slice(0, j + 1).join('/')).titel);
      const fach = kategorien.get(m.pfad[0] || '');
      const kat = kategorien.get(m.pfad.join('/'));
      const x = {
        ...m,
        id: i,
        key: m.pfad.join('/'),
        klassen: m.klassen || [],
        geraete: m.geraete || [],
        stichworte: m.stichworte || [],
        ort,
        farbe: fach ? fach.farbe : '#6b7480',
        sortierung: (kat ? kat.schluessel : '') + '\u0000' + pad(m.reihenfolge) + m.titel.toLowerCase(),
      };
      x.felder = [
        { w: 5, t: tokens(x.titel) },
        { w: 3, t: tokens(x.stichworte.join(' ')) },
        { w: 2.5, t: tokens(x.typ + ' ' + x.geraete.join(' ')) },
        { w: 2, t: tokens(ort.join(' ')) },
        { w: 2, t: x.klassen.length ? x.klassen.map(norm).concat(['klasse', 'stufe']) : [] },
        { w: 1.5, t: tokens(x.beschreibung) },
      ];
      merke(x.titel, 5); merke(x.stichworte.join(' '), 3); merke(x.typ, 2);
      merke(ort.join(' '), 2); merke(x.beschreibung, 1);
      return x;
    });
    materialien.sort((a, b) => (a.sortierung < b.sortierung ? -1 : 1));
  }

  // ---------- Suche ----------

  function suchbegriffe(text) {
    const t = tokens(text);
    const ohne = t.filter((x) => !STOPP.has(x));
    return ohne.length ? ohne : t;
  }

  function suchen(text, liste) {
    const qt = suchbegriffe(text);
    if (!qt.length) return { treffer: [], teilweise: false, begriffe: qt };
    const bewertet = [];
    for (const m of liste) {
      let summe = 0, gefunden = 0;
      for (const q of qt) {
        let best = 0;
        for (const f of m.felder) {
          for (const t of f.t) {
            const s = aehnlich(q, t) * f.w;
            if (s > best) best = s;
          }
        }
        if (best > 0) gefunden++;
        summe += best;
      }
      if (gefunden) bewertet.push({ m, summe, gefunden });
    }
    const alle = bewertet.filter((b) => b.gefunden === qt.length);
    const teilweise = !alle.length;
    const liste2 = teilweise ? bewertet : alle;
    liste2.sort((a, b) => b.gefunden - a.gefunden || b.summe - a.summe || a.m.titel.localeCompare(b.m.titel, 'de'));
    return { treffer: liste2.map((b) => b.m), teilweise: teilweise && bewertet.length > 0, begriffe: qt };
  }

  function korrektur(text) {
    let geaendert = false;
    const neu = woerter(text).map((w) => {
      const q = norm(w);
      if (q.length < 4 || STOPP.has(q) || wortschatz.has(q)) return w;
      for (const v of wortschatz.keys()) if (v.startsWith(q) || v.includes(q)) return w;
      const max = maxAbstand(q);
      let best = null, bd = Infinity, bn = 0;
      for (const [v, e] of wortschatz) {
        const d = abstand(q, v, max);
        if (d < bd || (d === bd && e.n > bn)) { best = e.wort; bd = d; bn = e.n; }
      }
      if (best && bd <= max) { geaendert = true; return best; }
      return w;
    });
    return geaendert ? neu.join(' ') : null;
  }

  function markiert(text, begriffe) {
    if (!begriffe || !begriffe.length) return text;
    const frag = document.createDocumentFragment();
    text.split(/([\p{L}\p{N}]+)/u).forEach((teil, i) => {
      if (!teil) return;
      const n = i % 2 ? norm(teil) : '';
      if (n && begriffe.some((q) => aehnlich(q, n) >= 0.4)) frag.append(h('mark', null, teil));
      else frag.append(teil);
    });
    return frag;
  }

  // ---------- Zustand und Adresse ----------

  const zustand = { bereich: [], suche: '', art: '', klasse: '' };

  function ausAdresse() {
    const p = new URLSearchParams(location.search);
    const b = (p.get('bereich') || '').split('/').filter(Boolean);
    zustand.bereich = kategorien.has(b.join('/')) ? b : [];
    zustand.suche = p.get('suche') || '';
    zustand.art = p.get('art') || '';
    zustand.klasse = p.get('klasse') || '';
  }

  function adresse(z) {
    const teile = [];
    if (z.bereich && z.bereich.length) teile.push('bereich=' + z.bereich.map(encodeURIComponent).join('/'));
    if (z.suche) teile.push('suche=' + encodeURIComponent(z.suche));
    if (z.art) teile.push('art=' + encodeURIComponent(z.art));
    if (z.klasse) teile.push('klasse=' + encodeURIComponent(z.klasse));
    return location.pathname + (teile.length ? '?' + teile.join('&') : '');
  }

  const bereichLink = (pfad) => adresse({ bereich: pfad, art: zustand.art, klasse: zustand.klasse });

  function gehe(z, ersetzen) {
    Object.assign(zustand, z);
    history[ersetzen ? 'replaceState' : 'pushState'](null, '', adresse(zustand));
    zeichne();
  }

  // ---------- Darstellung ----------

  function klassenText(k) {
    const zahlen = k.filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b);
    const rest = k.filter((x) => !/^\d+$/.test(x));
    const teile = [];
    for (let i = 0; i < zahlen.length; i++) {
      let j = i;
      while (j + 1 < zahlen.length && zahlen[j + 1] === zahlen[j] + 1) j++;
      teile.push(j > i ? zahlen[i] + '–' + zahlen[j] : String(zahlen[i]));
      i = j;
    }
    return teile.concat(rest).join(', ');
  }

  const datumText = (d) => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('de-DE'); };

  function karte(m, ortAb, begriffe) {
    const ort = m.ort.slice(ortAb);
    const daten = [];
    if (m.typ) daten.push(['Art', m.typ]);
    if (m.klassen.length) daten.push(['Klasse', klassenText(m.klassen)]);
    if (m.geraete.length) daten.push(['Geräte', m.geraete.join(', ')]);

    const knopf = h('button', { type: 'button', class: 'kopieren', 'aria-label': 'Link zu „' + m.titel + '“ kopieren' }, 'Link kopieren');
    knopf.addEventListener('click', async () => {
      const ziel = new URL(m.url, location.href).href;
      try { await navigator.clipboard.writeText(ziel); knopf.textContent = 'Kopiert'; }
      catch { window.prompt('Link zum Kopieren:', ziel); }
      setTimeout(() => { knopf.textContent = 'Link kopieren'; }, 2000);
    });

    return h('li', { class: 'karte', style: '--fach:' + m.farbe },
      m.vorschau ? h('img', { src: m.vorschau, alt: '', loading: 'lazy' }) : null,
      ort.length ? h('p', { class: 'ort' }, ort.join(' › ')) : null,
      h('h4', null, h('a', { href: m.url }, markiert(m.titel, begriffe))),
      m.beschreibung ? h('p', { class: 'text' }, markiert(m.beschreibung, begriffe)) : null,
      daten.length ? h('dl', null, daten.map(([k, v]) => h('div', null, h('dt', null, k + ':'), h('dd', null, v)))) : null,
      h('div', { class: 'fuss' }, h('span', null, m.datum ? 'Stand ' + datumText(m.datum) : ''), knopf)
    );
  }

  const raster = (liste, ortAb, begriffe) => h('ul', { class: 'raster' }, liste.map((m) => karte(m, ortAb, begriffe)));

  function filterAnwenden(liste) {
    return liste.filter((m) =>
      (!zustand.art || m.typ === zustand.art) &&
      (!zustand.klasse || m.klassen.includes(zustand.klasse)));
  }

  function filterLeiste(basis, anzahlText) {
    const arten = [...new Set(basis.map((m) => m.typ).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    const kl = [...new Set(basis.flatMap((m) => m.klassen))].sort((a, b) => {
      const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
      return na && nb ? a - b : na ? -1 : nb ? 1 : a.localeCompare(b, 'de');
    });
    if (zustand.art && !arten.includes(zustand.art)) arten.push(zustand.art);
    if (zustand.klasse && !kl.includes(zustand.klasse)) kl.push(zustand.klasse);

    const auswahl = (label, schluessel, werte, alleText, anzeige) => h('label', null, label,
      h('select', { onchange: (e) => gehe({ [schluessel]: e.target.value }, true) },
        h('option', { value: '' }, alleText),
        werte.map((w) => h('option', { value: w, selected: w === zustand[schluessel] }, anzeige ? anzeige(w) : w))));

    return h('div', { class: 'filter' },
      arten.length ? auswahl('Art', 'art', arten, 'alle Arten') : null,
      kl.length ? auswahl('Klassenstufe', 'klasse', kl, 'alle Klassen', (w) => (/^\d+$/.test(w) ? 'Klasse ' + w : w)) : null,
      h('p', { class: 'anzahl' }, anzahlText));
  }

  function leer(titel, text) {
    const filterAktiv = zustand.art || zustand.klasse;
    return h('div', { class: 'leer' }, h('h3', null, titel), h('p', null, text),
      filterAktiv ? h('button', { type: 'button', class: 'knopf', onclick: () => gehe({ art: '', klasse: '' }, true) }, 'Filter zurücksetzen') : null);
  }

  const anzahlWort = (n, ein, mehr) => n + ' ' + (n === 1 ? ein : mehr);

  function zeichneRegister() {
    const aktiv = zustand.suche.trim() ? null : (zustand.bereich[0] || '');
    const reiter = (titel, pfad, farbe, n, key) => h('a', {
      class: 'reiter', href: bereichLink(pfad), 'data-nav': '', style: farbe ? '--fach:' + farbe : null,
      'aria-current': aktiv === key ? 'page' : null,
    }, titel, h('span', null, '(' + n + ')'));
    $('#register').replaceChildren(
      reiter('Alles', [], null, materialien.length, ''),
      ...faecher.map((f) => reiter(f.titel, f.pfad, f.farbe, materialien.filter((m) => m.pfad[0] === f.pfad[0]).length, f.pfad[0])));
  }

  function zeichneBereich(ziel) {
    const key = zustand.bereich.join('/');
    const kat = kategorien.get(key);
    const tiefe = zustand.bereich.length;
    const imBereich = materialien.filter((m) => !key || m.key === key || m.key.startsWith(key + '/'));
    const gefiltert = filterAnwenden(imBereich);
    const fach = kategorien.get(zustand.bereich[0] || '');
    if (fach) ziel.style.setProperty('--fach', fach.farbe); else ziel.style.removeProperty('--fach');

    if (tiefe) {
      const krumen = [h('li', null, h('a', { href: bereichLink([]), 'data-nav': '' }, 'Alles'))];
      for (let i = 1; i <= tiefe; i++) {
        const k = kategorien.get(zustand.bereich.slice(0, i).join('/'));
        krumen.push(h('li', null, i === tiefe ? h('span', { 'aria-current': 'page' }, k.titel) : h('a', { href: bereichLink(k.pfad), 'data-nav': '' }, k.titel)));
      }
      ziel.append(h('nav', { class: 'pfad', 'aria-label': 'Brotkrumen' }, h('ol', null, krumen)));
    }
    ziel.append(h('div', { class: 'bereichskopf' },
      h('h2', null, kat ? kat.titel : 'Alle Materialien'),
      kat && kat.beschreibung ? h('p', null, kat.beschreibung) : null));
    ziel.append(filterLeiste(imBereich, anzahlWort(gefiltert.length, 'Material', 'Materialien')));

    const kinder = [...kategorien.values()]
      .filter((k) => k.pfad.length === tiefe + 1 && k.pfad.slice(0, tiefe).join('/') === key)
      .sort((a, b) => (a.schluessel < b.schluessel ? -1 : 1))
      .map((k) => ({ k, liste: gefiltert.filter((m) => m.pfad[tiefe] === k.pfad[tiefe]) }))
      .filter((g) => g.liste.length);

    if (tiefe && kinder.length > 1) {
      ziel.append(h('nav', { class: 'unterbereiche', 'aria-label': 'Unterbereiche' }, h('h3', null, 'Bereiche'),
        h('ul', null, kinder.map(({ k, liste }) => h('li', null,
          h('a', { href: bereichLink(k.pfad), 'data-nav': '' }, k.titel, ' ', h('span', null, '(' + liste.length + ')')))))));
    }

    if (!gefiltert.length) {
      ziel.append(leer('Keine Materialien gefunden', imBereich.length ? 'Kein Material in diesem Bereich passt zu den gewählten Filtern.' : 'In diesem Bereich gibt es noch keine Materialien.'));
      return;
    }

    if (!tiefe && !zustand.art && !zustand.klasse && materialien.length >= 8) {
      const neu = [...materialien].filter((m) => m.datum).sort((a, b) => (a.datum < b.datum ? 1 : -1)).slice(0, 3);
      if (neu.length) ziel.append(h('section', { class: 'gruppe' }, h('header', null, h('h3', null, 'Zuletzt aktualisiert')), raster(neu, 0)));
    }

    const direkt = gefiltert.filter((m) => m.pfad.length === tiefe);
    if (direkt.length) ziel.append(h('section', { class: 'gruppe' }, raster(direkt, tiefe)));

    for (const { k, liste } of kinder) {
      const farbe = tiefe === 0 ? k.farbe : null;
      ziel.append(h('section', { class: 'gruppe', style: farbe ? '--fach:' + farbe : null },
        h('header', null,
          h('h3', null, h('a', { href: bereichLink(k.pfad), 'data-nav': '' }, k.titel)),
          h('span', { class: 'klein' }, anzahlWort(liste.length, 'Material', 'Materialien')),
          k.beschreibung ? h('p', null, k.beschreibung) : null),
        raster(liste, tiefe + 1)));
    }
  }

  function zeichneSuche(ziel) {
    const text = zustand.suche.trim();
    const { treffer, teilweise, begriffe } = suchen(text, materialien);
    const gefiltert = filterAnwenden(treffer);
    ziel.style.removeProperty('--fach');

    ziel.append(h('div', { class: 'bereichskopf' }, h('h2', null, 'Suche nach „' + text + '“')));
    ziel.append(filterLeiste(treffer, anzahlWort(gefiltert.length, 'Treffer', 'Treffer')));

    if (!gefiltert.length) {
      ziel.append(leer('Nichts gefunden',
        treffer.length ? 'Zu den gewählten Filtern passt kein Treffer.' : 'Versuche einen allgemeineren Begriff oder stöbere über die Fächer oben.'));
      return;
    }
    if (teilweise) ziel.append(h('p', { class: 'meldung' }, 'Kein Material passt zu allen Suchbegriffen. Diese Treffer passen zu einem Teil davon:'));
    ziel.append(h('section', { class: 'gruppe' }, raster(gefiltert, 0, begriffe)));
  }

  function zeichneVorschlag() {
    const box = $('#vorschlag');
    const v = zustand.suche.trim() ? korrektur(zustand.suche) : null;
    if (!v) { box.hidden = true; box.replaceChildren(); return; }
    box.replaceChildren('Meintest du ',
      h('button', { type: 'button', onclick: () => { $('#suchfeld').value = v; gehe({ suche: v }, true); } }, v), '?');
    box.hidden = false;
  }

  function zeichne() {
    zeichneRegister();
    zeichneVorschlag();
    const feld = $('#suchfeld');
    if (document.activeElement !== feld) feld.value = zustand.suche;
    $('#leeren').hidden = !feld.value;

    const ziel = $('#inhalt');
    ziel.replaceChildren();
    if (demo) ziel.append(h('p', { class: 'meldung' }, 'Vorschau mit Beispieldaten: katalog.json wurde nicht gefunden. Auf GitHub erzeugt die Action die Datei automatisch, lokal mit „node scripts/build-katalog.mjs“.'));
    if (!materialien.length) {
      ziel.append(leer('Noch keine Materialien', 'Sobald HTML-Dateien in den Fach-Ordnern liegen, erscheinen sie hier.'));
      return;
    }
    if (zustand.suche.trim()) zeichneSuche(ziel); else zeichneBereich(ziel);

    const kat = kategorien.get(zustand.bereich.join('/'));
    const basis = BASISTITEL;
    document.title = zustand.suche.trim() ? 'Suche: ' + zustand.suche.trim() + ' · ' + basis : kat ? kat.titel + ' · ' + basis : basis;
  }

  // ---------- Ereignisse ----------

  function verbinden() {
    const feld = $('#suchfeld');
    let timer;
    feld.addEventListener('input', () => {
      $('#leeren').hidden = !feld.value;
      clearTimeout(timer);
      timer = setTimeout(() => gehe({ suche: feld.value }, true), 140);
    });
    feld.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { feld.value = ''; gehe({ suche: '' }, true); }
      if (e.key === 'Enter') { clearTimeout(timer); gehe({ suche: feld.value }, true); }
    });
    $('#leeren').addEventListener('click', () => { feld.value = ''; gehe({ suche: '' }, true); feld.focus(); });

    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        feld.focus();
        feld.select();
      }
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-nav]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      history.pushState(null, '', a.getAttribute('href'));
      ausAdresse();
      zeichne();
      const reg = $('#register');
      if (reg.getBoundingClientRect().top < 0) reg.scrollIntoView({ block: 'start' });
    });

    window.addEventListener('popstate', () => { ausAdresse(); zeichne(); });
  }

  async function start() {
    let daten;
    try {
      const r = await fetch('katalog.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      daten = await r.json();
    } catch {
      daten = BEISPIEL;
      demo = true;
    }
    vorbereiten(daten);
    ausAdresse();
    verbinden();
    zeichne();
  }

  // Beispieldaten für die Vorschau ohne katalog.json (z. B. beim Öffnen der Datei direkt vom Rechner)
  const BEISPIEL = {
    version: 1,
    kategorien: [
      { pfad: ['chemie'], titel: 'Chemie', beschreibung: 'Simulationen und Werkzeuge für den Chemieunterricht der Sekundarstufe I und II.', reihenfolge: 1, farbe: '#D55E00' },
      { pfad: ['chemie', 'vorfuehrsimulationen'], titel: 'Vorführsimulationen', beschreibung: 'Anschauungsmodelle für Beamer und Smartboard – zum Erklären, ohne Aufgaben.', reihenfolge: 1 },
      { pfad: ['chemie', 'interaktive-werkzeuge'], titel: 'Interaktive Werkzeuge', beschreibung: 'Zum selbstständigen Arbeiten am Tablet oder Computer.', reihenfolge: 2 },
      { pfad: ['informatik'], titel: 'Informatik', beschreibung: 'Programmierspiele und Lernpfade rund um Processing und Java.', reihenfolge: 2, farbe: '#0072B2' },
      { pfad: ['informatik', 'spiele'], titel: 'Interaktive Spiele', beschreibung: '', reihenfolge: 1 },
      { pfad: ['informatik', 'lernpfade'], titel: 'Lernpfade', beschreibung: 'Schritt für Schritt durch ein Thema.', reihenfolge: 2 },
    ],
    materialien: [
      { titel: 'Daniell-Element', beschreibung: 'Elektronen fließen durch den Draht, nicht durch die Lösung: Vorgänge auf Teilchenebene in beiden Halbzellen.', url: '#', pfad: ['chemie', 'vorfuehrsimulationen'], typ: 'Vorführung', klassen: ['J1', 'J2'], geraete: ['Beamer', 'PC'], stichworte: ['Elektrochemie', 'Redox', 'galvanische Zelle', 'Halbzelle'], vorschau: '', reihenfolge: 100, datum: '2026-10-12' },
      { titel: 'Aggregatzustände im Teilchenmodell', beschreibung: 'Schmelzen und Sieden im geschlossenen Gefäß mit deutlichen Temperaturplateaus.', url: '#', pfad: ['chemie', 'vorfuehrsimulationen'], typ: 'Vorführung', klassen: ['8', '9'], geraete: ['Beamer', 'PC'], stichworte: ['Schmelzen', 'Sieden', 'Teilchen', 'fest flüssig gasförmig'], vorschau: '', reihenfolge: 100, datum: '2026-10-08' },
      { titel: 'London-Wechselwirkungen', beschreibung: 'Temporäre und induzierte Dipole zwischen unpolaren Molekülen.', url: '#', pfad: ['chemie', 'vorfuehrsimulationen'], typ: 'Vorführung', klassen: ['J1'], geraete: ['Beamer'], stichworte: ['Van-der-Waals', 'Dipol', 'zwischenmolekulare Wechselwirkungen'], vorschau: '', reihenfolge: 100, datum: '2026-10-02' },
      { titel: 'Ionenpuzzle', beschreibung: 'Kationen und Anionen zusammensetzen und so Verhältnisformeln von Salzen finden.', url: '#', pfad: ['chemie', 'interaktive-werkzeuge'], typ: 'Schülertool', klassen: ['8', '9'], geraete: ['Tablet', 'PC'], stichworte: ['Salze', 'Ionenbindung', 'Verhältnisformel', 'Ionengitter'], vorschau: '', reihenfolge: 100, datum: '2026-10-15' },
      { titel: 'Hamster sammelt Körner', beschreibung: 'Erste Schritte mit Anweisungen, Schleifen und Verzweigungen in Processing.', url: '#', pfad: ['informatik', 'spiele'], typ: 'Spiel', klassen: ['9'], geraete: ['PC'], stichworte: ['Processing', 'Java', 'Schleifen', 'Programmieren'], vorschau: '', reihenfolge: 100, datum: '2026-10-04' },
      { titel: 'Einstieg in Processing', beschreibung: 'Vom ersten Rechteck bis zur eigenen Animation.', url: '#', pfad: ['informatik', 'lernpfade'], typ: 'Lernpfad', klassen: ['9'], geraete: ['PC'], stichworte: ['Processing', 'Koordinaten', 'Animation'], vorschau: '', reihenfolge: 100, datum: '2026-09-28' },
    ],
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
