// ==================== VOICE ====================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const supportId = config.CHANNELS.SUPPORT_WARTERAUM;

  // Eigene Voice-State-Änderungen des Bots ignorieren
  if (newState.member?.user?.bot) return;

  // Jemand joined Support Warteraum
  if (newState.channelId === supportId && oldState.channelId !== supportId) {
    console.log(`[Voice] ${newState.member?.user?.tag} joined Support Warteraum`);

    setTimeout(
      () =>
        joinAndPlayMusic(
          newState.guild.channels.cache.get(supportId) || newState.channel
        ),
      800
    );
  }

  // Jemand left
  if (oldState.channelId === supportId && newState.channelId !== supportId) {
    setTimeout(() => {
      const channel = oldState.guild.channels.cache.get(supportId);
      if (!channel) return;

      const humans = channel.members.filter((m) => !m.user.bot).size;

      console.log(`[Voice] left, humans remaining: ${humans}`);

      if (humans === 0) {
        leaveVoice(supportId);
      }
    }, 1500);
  }
});

async function joinAndPlayMusic(channel) {
  if (!channel || channel.id !== config.CHANNELS.SUPPORT_WARTERAUM) return;

  // Schon drin?
  if (voiceConnections.has(channel.id)) {
    const existing = voiceConnections.get(channel.id);
    const status = existing.connection.state.status;

    console.log(
      `[Voice] already connected, status=${status}, player=${existing.player.state.status}`
    );

    if (
      status === VoiceConnectionStatus.Ready &&
      existing.player.state.status !== AudioPlayerStatus.Playing
    ) {
      playMusic(existing.player);
    }

    return;
  }

  const musicPath = path.join(__dirname, 'music.mp3');

  if (!fs.existsSync(musicPath)) {
    console.error('[Voice] music.mp3 FEHLT:', musicPath);
    return;
  }

  console.log(
    `[Voice] music.mp3 gefunden (${(
      fs.statSync(musicPath).size / 1024
    ).toFixed(0)} KB)`
  );

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    connection.on('stateChange', (oldS, newS) => {
      console.log(
        `[Voice] connection: ${oldS.status} → ${newS.status}`
      );
    });

    connection.on('error', (err) => {
      console.error('[Voice] connection error:', err);
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    // Sofort registrieren
    voiceConnections.set(channel.id, {
      connection,
      player,
    });

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        25_000
      );

      console.log('[Voice] Connection READY');
    } catch (err) {
      console.error(
        '[Voice] Timeout waiting for Ready:',
        err.message
      );

      voiceConnections.delete(channel.id);

      try {
        connection.destroy();
      } catch {}

      return;
    }

    player.on('stateChange', (oldS, newS) => {
      console.log(
        `[Voice] player: ${oldS.status} → ${newS.status}`
      );
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log('[Voice] Idle → loop');

      setTimeout(() => {
        playMusic(player);
      }, 300);
    });

    player.on('error', (err) => {
      console.error('[Voice] player error:', err);

      setTimeout(() => {
        playMusic(player);
      }, 2000);
    });

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        console.log(
          '[Voice] Disconnected – versuche Reconnect…'
        );

        try {
          await Promise.race([
            entersState(
              connection,
              VoiceConnectionStatus.Signalling,
              5_000
            ),
            entersState(
              connection,
              VoiceConnectionStatus.Connecting,
              5_000
            ),
          ]);
        } catch {
          const ch =
            channel.guild.channels.cache.get(channel.id);

          const humans = ch
            ? ch.members.filter((m) => !m.user.bot).size
            : 0;

          if (humans === 0) {
            leaveVoice(channel.id);
          } else {
            leaveVoice(channel.id);

            setTimeout(() => {
              joinAndPlayMusic(ch);
            }, 2000);
          }
        }
      }
    );

    playMusic(player);
  } catch (err) {
    console.error(
      '[Voice] joinAndPlayMusic error:',
      err
    );
  }
}

function playMusic(player) {
  const musicPath = path.join(__dirname, 'music.mp3');

  if (!fs.existsSync(musicPath)) {
    console.warn(
      '[Voice] music.mp3 fehlt unter:',
      musicPath
    );
    return;
  }

  try {
    const resource = createAudioResource(musicPath, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
      silencePaddingFrames: 5,
    });

    if (resource.volume) {
      resource.volume.setVolume(0.45);
    }

    resource.playStream.on('error', (err) => {
      console.error(
        '[Voice] Audio stream error:',
        err
      );
    });

    player.play(resource);

    console.log(
      '[Voice] play() aufgerufen – Status:',
      player.state.status
    );
  } catch (err) {
    console.error(
      '[Voice] playMusic error:',
      err
    );
  }
}

function leaveVoice(channelId) {
  const entry = voiceConnections.get(channelId);

  if (!entry) return;

  try {
    entry.player.stop(true);
    entry.connection.destroy();
  } catch {}

  voiceConnections.delete(channelId);

  console.log(
    '[Voice] Left Support Warteraum'
  );
}