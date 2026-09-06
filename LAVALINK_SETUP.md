# Lavalink Setup – EasyDrive Bot

Der Bot ist auf Lavalink v4 + Shoukaku 4 umgestellt.

## Primärer Node (No-SSL)

- Host: `lavalinkv4.serenetia.com`
- Port: `80`
- Secure: `false`
- Passwort: `https://seretia.link/discord`

## Fallback-Node

Zusätzlich ist `lavalink.jirayu.net:443` (Passwort `youshallnotpass`) als zweiter Node konfiguriert. Shoukaku verbindet zu beiden Nodes und nutzt automatisch den, der tatsächlich erreichbar ist. Überschreibbar über `LAVALINK_FALLBACK_HOST` / `LAVALINK_FALLBACK_PASSWORD` / `LAVALINK_FALLBACK_NAME`.

## .env

```env
DISCORD_TOKEN=DEIN_DISCORD_TOKEN
LAVALINK_HOST=lavalinkv4.serenetia.com:80
LAVALINK_PASSWORD=https://seretia.link/discord
LAVALINK_NAME=Serenetia-NoSSL
LAVALINK_SECURE=false
LAVALINK_MUSIC_URL=https://DEINE-DOMAIN.example/music.mp3
```

`LAVALINK_MUSIC_URL` muss eine öffentlich erreichbare HTTPS-URL sein. Lavalink kann nicht direkt auf die lokale `music.mp3` im Bot-Container zugreifen.

Die Datei `music.mp3` bleibt im Projekt, wird für die Lavalink-Wiedergabe aber nicht direkt gelesen.


## Wichtig bei HTTP 429

`429 Too Many Requests` kommt vom öffentlichen Node bzw. seinem Schutzsystem. Der Bot darf in diesem Fall nicht aggressiv neu verbinden.

`initLavalink()` läuft **vor** `client.login()`, damit Shoukakus interner `clientReady`-Listener rechtzeitig registriert wird (er würde sonst nie auslösen, da `clientReady` nur einmal im Bot-Leben feuert). Bei einem 429 werden nur wenige, kurz auseinanderliegende Reconnect-Versuche zugelassen (`reconnectTries`/`reconnectInterval`).

Lavalink v4 erwartet beim WebSocket unter `/v4/websocket` die Header `Authorization`, `User-Id` und `Client-Name`.

