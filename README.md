# Camino – Spanisch lernen zu zweit

Progressive Web App (PWA) für zwei Personen: Wortschatz und Grammatik (Spanien) von A1 bis B2.

## Ordner

| Pfad | Inhalt |
| --- | --- |
| `index.html`, `manifest.webmanifest`, `sw.js` | Startseite, App-Beschreibung für die Installation, Service Worker |
| `config.json` | **Die einzige Datei, die du anpasst:** eure Namen und die Firebase-Verbindung |
| `content/course.json` | Struktur aller 45 Lektionen |
| `content/lessons/L01.json` | Inhalt Lektion 1 (90 Wörter, Grammatik) |
| `content/master-wordlist.json` | Liste aller verwendeten Wörter (gegen Duplikate) |
| `js/` | Programmcode |
| `css/app.css` | Gestaltung |
| `icons/` | App-Symbole |

## Neue Lektion hinzufügen

1. Datei `L02.json` (von Claude) in `content/lessons/` hochladen.
2. In `content/course.json` bei Lektion 2 `"pack": null` ersetzen durch `"pack": "lessons/L02.json"`.
3. `content/master-wordlist.json` durch die neue Version von Claude ersetzen.

## Demo-Modus

Auf dem Bildschirm «¿Quién eres?» 7× schnell auf das Logo tippen.

## Lizenzen

`js/vendor/ts-fsrs.mjs`: ts-fsrs 5.4.2, MIT-Lizenz (siehe `js/vendor/ts-fsrs-LICENSE.txt`).
