# Interaktive Materialien für Chemie und Informatik

Startseite mit Suche und Navigation für alle HTML-Materialien in diesem Repository.
Die Seite baut sich selbst aus der Ordnerstruktur – neue Materialien erscheinen nach dem Hochladen automatisch.

## Einmalige Einrichtung

1. Alle Dateien aus diesem Paket ins Repository-Wurzelverzeichnis legen (eine vorhandene `index.html` wird ersetzt).
2. **Settings → Pages → Build and deployment → Source: „GitHub Actions“** einstellen.
3. Pushen. Unter **Actions** läuft „Seite veröffentlichen“; nach ca. 1 Minute ist die Seite online.

## Aufbau

```
index.html                 Startseite
assets/                    Gestaltung, Suche, Schrift (nicht anfassen nötig)
scripts/build-katalog.mjs  erzeugt katalog.json aus den Ordnern
.github/workflows/seite.yml  führt das Skript bei jedem Push aus und veröffentlicht
_vorlage/                  Vorlage für ein neues Material (wird nicht angezeigt)

chemie/                    Fach
  ordner.json              Anzeigename, Beschreibung, Reihenfolge, Farbe
  vorfuehrsimulationen/    Bereich (beliebig tief verschachtelbar)
    ordner.json
    daniell-element/       Material als Ordner …
      index.html
      vorschau.png         optionales Vorschaubild (16:9)
    ionenpuzzle.html       … oder als einzelne Datei
informatik/
  …
```

**Regeln**
- Jeder Ordner ist eine Kategorie. Leere Ordner werden ausgeblendet.
- Ein Ordner **mit `index.html`** ist ein Material; was darin liegt (Bilder, JS, weitere Seiten), gehört dazu.
- In Ordnern **ohne `index.html`** ist jede `.html`-Datei ein eigenes Material.
- Ordner mit `_` am Anfang (z. B. `_entwuerfe`) werden ignoriert.
- Ohne `ordner.json` wird der Ordnername angezeigt (`vorfuehrsimulationen` → „Vorfuehrsimulationen“). Für Umlaute und schöne Namen daher `ordner.json` anlegen:

```json
{ "titel": "Vorführsimulationen", "beschreibung": "Anschauungsmodelle für den Beamer.", "reihenfolge": 1 }
```

`farbe` ist nur auf Fach-Ebene sinnvoll. Farbenblind-sichere Werte: `#D55E00` (Orange-Rot), `#0072B2` (Blau),
`#009E73` (Blaugrün), `#CC79A7` (Rosa), `#E69F00` (Orange), `#56B4E9` (Himmelblau).

## Angaben zu einem Material

Im `<head>` der HTML-Datei, siehe `_vorlage/index.html`:

| Tag | Beispiel | Wirkung |
|---|---|---|
| `<title>` | Daniell-Element | Titel der Karte |
| `description` | Ein bis zwei Sätze | Text der Karte |
| `material:typ` | Vorführung | Filter „Art“ |
| `material:klasse` | `8-10` oder `J1, J2` | Filter „Klassenstufe“ |
| `material:geraet` | Tablet, PC | Anzeige |
| `material:stichworte` | Redox, Halbzelle | zusätzliche Suchbegriffe |
| `material:reihenfolge` | 1 | Position im Bereich |
| `material:katalog` | nein | ausblenden |

Fehlen Angaben, erscheint das Material trotzdem; das Skript gibt in der Action einen Hinweis aus.

## Lokal ansehen

```
node scripts/build-katalog.mjs
python3 -m http.server
```
Dann http://localhost:8000 öffnen. Direkt per Doppelklick geöffnet zeigt die Seite Beispieldaten.

## Nutzung

Alle Materialien dürfen frei verwendet, weitergegeben und verändert werden, solange es nicht kommerziell ist.
Eine Namensnennung ist nicht nötig. Die Schrift in `assets/fonts/` steht unter der SIL Open Font License (`OFL.txt` muss dabei bleiben).
