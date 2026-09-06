# Lavalink SSL Setup – EasyDrive Bot

Der Bot ist auf Lavalink v4 + Shoukaku 4 umgestellt.

## Node

- Host: `lavalinkv4.serenetia.com`
- Port: `443`
- Secure: `true`
- Passwort: `https://seretia.link/discord`

## .env

```env
DISCORD_TOKEN=DEIN_DISCORD_TOKEN
LAVALINK_HOST=lavalinkv4.serenetia.com:443
LAVALINK_PASSWORD=https://seretia.link/discord
LAVALINK_NAME=Serenetia-SSL
LAVALINK_MUSIC_URL=https://DEINE-DOMAIN.example/music.mp3
```

`LAVALINK_MUSIC_URL` muss eine öffentlich erreichbare HTTPS-URL sein. Lavalink kann nicht direkt auf die lokale `music.mp3` im Bot-Container zugreifen.

Die Datei `music.mp3` bleibt im Projekt, wird für die Lavalink-Wiedergabe aber nicht direkt gelesen.


## Wichtig bei HTTP 429

`429 Too Many Requests` kommt vom öffentlichen Node bzw. seinem Schutzsystem. Der Bot darf in diesem Fall nicht aggressiv neu verbinden.

Der Bot initialisiert Lavalink deshalb erst **nach** dem Discord-Login, damit beim WebSocket-Handshake die echte Discord-Bot-ID für den `User-Id`-Header vorhanden ist. Bei einem 429 werden nur wenige, weit auseinanderliegende Reconnect-Versuche zugelassen.

Lavalink v4 erwartet beim WebSocket unter `/v4/websocket` die Header `Authorization`, `User-Id` und `Client-Name`.
