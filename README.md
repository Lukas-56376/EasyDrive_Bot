# EasyDrive Berlin – Fahrschul Discord Bot

Vollständiger Discord-Bot für die EasyDrive Berlin Fahrschule (Roblox).

## Features

1. **Willkommen** – Automatisches Embed + Ping + DM beim Joinen
2. **Embed-Management** – Regelwerk, FAQ, Theorie-Info, Lernmaterial, Praxis-Info über Buttons im Embeds-Channel (senden & bearbeiten)
3. **Verifizierung** – Modal mit Code „EasyDrive“ → Verifiziert-Rolle, Unverifiziert weg
4. **Anmeldung** – Formular (Roblox Name, Begründung, Klasse PKW/Motorrad/LKW) → Logs mit Fahrschulleitung-Ping  
   - Annehmen: Schüler + Theorie, Erwartet Bearbeitung weg + DM  
   - Ablehnen: Erwartet Bearbeitung weg + DM
5. **Theorie-System** – 10 Minuten nach Theorie-Rolle DM-Einladung  
   - Fragen je nach Klasse (aus Lernmaterial)  
   - Antworten in Prüfungen-kontrollieren  
   - Annehmen → Praxis, Theorie weg + DM
6. **Fahrstunden** – Anträge nur mit Praxis-Rolle, Fahrlehrer übernimmt, Stunden bestätigen  
   - Bei 30 Stunden → Erwartet Prüfung + DM
7. **Support Warteraum** – Bot joint automatisch und spielt `music.mp3` in Loop, bis der Channel leer ist

## Installation

```bash
cd fahrschul-bot
npm install
cp .env.example .env
# Token in .env eintragen
```

## Bot starten

```bash
node index.js
# oder
npm start
```

## Bot-Einladung (wichtige Intents & Permissions)

Im Developer Portal aktivieren:
- **Privileged Gateway Intents**: Server Members Intent, Message Content Intent
- Permissions: Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History, Connect, Speak, Use Voice Activity

Invite-URL Beispiel:
```
https://discord.com/api/oauth2/authorize?client_id=DEINE_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

## Dateien

- `config.js` – Alle Role- & Channel-IDs
- `Willkommen.json`, `Regelwerk.json`, `faq.json`, `theorie.json`, `Lernmaterial.json`, `Praxis-Info.json` – Embeds
- `music.mp3` – Loop-Musik für Support Warteraum
- `data/` – Persistente Daten (Stunden, Anfragen, Embed-Message-IDs)

## Hinweise

- Embeds werden beim ersten Klick im Embeds-Channel gesendet und danach nur noch bearbeitet.
- Theorie-Fragen sind in `utils/theoryQuestions.js` und können angepasst werden.
- Der Bot speichert Daten lokal in JSON-Dateien unter `data/`.
# EasyDrive_Bot
