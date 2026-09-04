// ==================== VOICE ====================

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const supportId = config.CHANNELS.SUPPORT_WARTERAUM;

  if (newState.member?.user?.bot) return;

  if (
    newState.channelId === supportId &&
    oldState.channelId !== supportId
  ) {
    console.log(
      `[Voice] ${newState.member?.user?.tag} joined Support Warteraum`
    );

    setTimeout(() => {
      const channel =
        newState.guild.channels.cache.get(supportId) ||
        newState.channel;

      joinAndPlayMusic(channel);
    }, 800);
  }

  if (
    oldState.channelId === supportId &&
    newState.channelId !== supportId
  ) {
    setTimeout(() => {
      const channel =
        oldState.guild.channels.cache.get(supportId);

      if (!channel) return;

      const humans = channel.members.filter(
        (m) => !m.user.bot
      ).size;

      console.log(
        `[Voice] left, humans remaining: ${humans}`
      );

      if (humans === 0) {
        leaveVoice(supportId);
      }
    }, 1500);
  }
});

async function joinAndPlayMusic(channel) {
  if (
    !channel ||
    channel.id !== config.CHANNELS.SUPPORT_WARTERAUM
  ) {
    return;
  }

  if (voiceConnections.has(channel.id)) {
    const existing = voiceConnections.get(channel.id);

    console.log(
      `[Voice] already connected, status=${existing.connection.state.status}, player=${existing.player.state.status}`
    );

    if (
      existing.connection.state.status ===
        VoiceConnectionStatus.Ready &&
      existing.player.state.status !==
        AudioPlayerStatus.Playing
    ) {
      playMusic(existing.player);
    }

    return;
  }

  const musicPath = path.join(__dirname, "music.mp3");

  if (!fs.existsSync(musicPath)) {
    console.error(
      "[Voice] music.mp3 FEHLT:",
      musicPath
    );
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
      adapterCreator:
        channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    connection.on(
      "stateChange",
      (oldState, newState) => {
        console.log(
          `[Voice] connection: ${oldState.status} → ${newState.status}`
        );
      }
    );

    connection.on("error", (error) => {
      console.error(
        "[Voice] connection error:",
        error
      );
    });

    const player = createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Play,
      },
    });

    connection.subscribe(player);

    voiceConnections.set(channel.id, {
      connection,
      player,
    });

    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        25000
      );

      console.log(
        "[Voice] Connection READY"
      );
    } catch (error) {
      console.error(
        "[Voice] Timeout waiting for Ready:",
        error.message
      );

      voiceConnections.delete(channel.id);

      try {
        connection.destroy();
      } catch {}

      return;
    }

    player.on(
      "stateChange",
      (oldState, newState) => {
        console.log(
          `[Voice] player: ${oldState.status} → ${newState.status}`
        );
      }
    );

    player.on(
      AudioPlayerStatus.Idle,
      () => {
        console.log(
          "[Voice] Musik beendet → Loop"
        );

        setTimeout(() => {
          if (
            voiceConnections.has(channel.id)
          ) {
            playMusic(player);
          }
        }, 500);
      }
    );

    player.on("error", (error) => {
      console.error(
        "[Voice] player error:",
        error
      );
    });

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        console.log(
          "[Voice] Disconnected – Reconnect..."
        );

        try {
          await Promise.race([
            entersState(
              connection,
              VoiceConnectionStatus.Signalling,
              5000
            ),
            entersState(
              connection,
              VoiceConnectionStatus.Connecting,
              5000
            ),
          ]);
        } catch {
          const currentChannel =
            channel.guild.channels.cache.get(
              channel.id
            );

          const humans = currentChannel
            ? currentChannel.members.filter(
                (member) => !member.user.bot
              ).size
            : 0;

          leaveVoice(channel.id);

          if (humans > 0) {
            setTimeout(() => {
              joinAndPlayMusic(
                currentChannel
              );
            }, 2000);
          }
        }
      }
    );

    playMusic(player);
  } catch (error) {
    console.error(
      "[Voice] joinAndPlayMusic error:",
      error
    );
  }
}

function playMusic(player) {
  const musicPath = path.join(
    __dirname,
    "music.mp3"
  );

  if (!fs.existsSync(musicPath)) {
    console.error(
      "[Voice] music.mp3 nicht gefunden:",
      musicPath
    );
    return;
  }

  try {
    const resource = createAudioResource(
      musicPath,
      {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
        silencePaddingFrames: 5,
      }
    );

    if (resource.volume) {
      resource.volume.setVolume(0.45);
    }

    resource.playStream.on(
      "error",
      (error) => {
        console.error(
          "[Voice] Audio stream error:",
          error
        );
      }
    );

    player.play(resource);

    console.log(
      "[Voice] play() aufgerufen – Status:",
      player.state.status
    );
  } catch (error) {
    console.error(
      "[Voice] playMusic error:",
      error
    );
  }
}

function leaveVoice(channelId) {
  const entry =
    voiceConnections.get(channelId);

  if (!entry) return;

  try {
    entry.player.stop(true);
    entry.connection.destroy();
  } catch {}

  voiceConnections.delete(channelId);

  console.log(
    "[Voice] Left Support Warteraum"
  );
}