#!/usr/bin/env node
// Erzeugt katalog.json aus der Ordnerstruktur des Repositorys.
// Aufruf: node scripts/build-katalog.mjs [Wurzelordner]
//
// Regeln:
// - Jeder Ordner ist eine Kategorie (Fach, Bereich, Unterbereich – beliebig tief).
// - Ein Ordner MIT index.html ist ein Material (Projektordner); darunter wird nicht weiter gesucht.
// - In Ordnern OHNE index.html ist jede einzelne .html-Datei ein Material.
// - Ordner, die mit "." oder "_" beginnen, sowie assets/, scripts/, node_modules/ werden ignoriert
//   (z. B. "_entwuerfe" für Unfertiges).
// - Optionale Datei ordner.json in einem Ordner: {"titel", "beschreibung", "reihenfolge", "farbe"}.
// - Angaben zum Material stehen als <meta>-Tags im <head> der HTML-Datei (siehe README.md).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] || '.');
const AUSGABE = path.join(ROOT, 'katalog.json');
const IGNORIEREN = new Set(['assets', 'scripts', 'node_modules']);
const BILDENDUNGEN = ['webp', 'png', 'jpg', 'jpeg', 'svg'];

const kategorien = [];
const materialien = [];
const warnungen = [];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function entities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function leseHead(datei) {
  const html = fs.readFileSync(datei, 'utf8');
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html])[0];
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attr = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attr[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
    }
    const name = (attr.name || attr.property || '').toLowerCase();
    if (name && 'content' in attr) meta[name] = entities(attr.content).trim();
  }
  const titel = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { meta, titel: titel ? entities(titel[1]).replace(/\s+/g, ' ').trim() : '' };
}

const liste = (s) => (s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);

function klassen(s) {
  const aus = [];
  for (const teil of liste(s)) {
    const r = teil.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (r) for (let k = +r[1]; k <= +r[2]; k++) aus.push(String(k));
    else aus.push(teil.replace(/^(kl\.?|klasse)\s*/i, ''));
  }
  return [...new Set(aus)];
}

function gitDatum(p) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', p], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out.slice(0, 10);
  } catch { /* kein git verfügbar */ }
  return fs.statSync(p).mtime.toISOString().slice(0, 10);
}

function hübscherName(ordner) {
  const s = ordner.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function vorschauSuchen(basis) {
  for (const e of BILDENDUNGEN) if (fs.existsSync(`${basis}.${e}`)) return rel(`${basis}.${e}`);
  return '';
}

function material(htmlDatei, kategoriePfad, istOrdner) {
  const { meta, titel } = leseHead(htmlDatei);
  const m = (k) => meta[`material:${k}`] || '';
  if (/^(nein|false|aus)$/i.test(m('katalog'))) return;

  const ordner = path.dirname(htmlDatei);
  const ziel = istOrdner ? ordner : htmlDatei;
  const url = rel(ziel).split('/').map(encodeURIComponent).join('/') + (istOrdner ? '/' : '');
  const vorschau = m('vorschau')
    ? rel(path.resolve(ordner, m('vorschau')))
    : vorschauSuchen(istOrdner ? path.join(ordner, 'vorschau') : htmlDatei.replace(/\.html?$/i, ''));

  const eintrag = {
    titel: m('titel') || titel || hübscherName(path.basename(ziel).replace(/\.html?$/i, '')),
    beschreibung: meta.description || '',
    url,
    pfad: kategoriePfad,
    typ: m('typ'),
    klassen: klassen(m('klasse')),
    geraete: liste(m('geraet')),
    stichworte: liste(m('stichworte')),
    vorschau: vorschau ? vorschau.split('/').map(encodeURIComponent).join('/') : '',
    reihenfolge: Number(m('reihenfolge')) || 100,
    datum: gitDatum(ziel),
  };
  if (!eintrag.beschreibung) warnungen.push(`${url}: keine <meta name="description">`);
  if (!eintrag.typ) warnungen.push(`${url}: kein material:typ`);
  materialien.push(eintrag);
}

function durchsuche(ordner, segmente) {
  const eintraege = fs.readdirSync(ordner, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const vorher = materialien.length;

  if (segmente.length) {
    const index = eintraege.find((e) => e.isFile() && e.name.toLowerCase() === 'index.html');
    if (index) {
      material(path.join(ordner, index.name), segmente.slice(0, -1), true);
      return;
    }
    for (const e of eintraege) {
      if (e.isFile() && /\.html?$/i.test(e.name)) material(path.join(ordner, e.name), segmente, false);
    }
  }
  for (const e of eintraege) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
    if (!segmente.length && IGNORIEREN.has(e.name)) continue;
    durchsuche(path.join(ordner, e.name), [...segmente, e.name]);
  }

  if (segmente.length && materialien.length > vorher) {
    let info = {};
    const json = path.join(ordner, 'ordner.json');
    if (fs.existsSync(json)) {
      try { info = JSON.parse(fs.readFileSync(json, 'utf8')); }
      catch (err) { warnungen.push(`${rel(json)}: ungültiges JSON (${err.message})`); }
    }
    kategorien.push({
      pfad: segmente,
      titel: info.titel || hübscherName(segmente.at(-1)),
      beschreibung: info.beschreibung || '',
      reihenfolge: Number(info.reihenfolge) || 100,
      ...(info.farbe ? { farbe: info.farbe } : {}),
    });
  }
}

durchsuche(ROOT, []);

const pfadKey = (p) => p.join('/');
kategorien.sort((a, b) => pfadKey(a.pfad).localeCompare(pfadKey(b.pfad), 'de'));
materialien.sort((a, b) => a.url.localeCompare(b.url, 'de'));

const json = JSON.stringify({ version: 1, kategorien, materialien }, null, 2) + '\n';
fs.writeFileSync(AUSGABE, json);

console.log(`katalog.json: ${materialien.length} Materialien in ${kategorien.length} Kategorien`);
for (const w of warnungen) console.log(`  Hinweis: ${w}`);
