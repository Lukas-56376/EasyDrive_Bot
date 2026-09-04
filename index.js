require('dotenv').config();
const path = require('path');
const fs = require('fs');

// FFmpeg für Voice
let ffmpegPath = null;

try {
  if (process.platform === 'linux' && require('fs').existsSync('/usr/bin/ffmpeg')) {
    // Railway / Linux
    ffmpegPath = '/usr/bin/ffmpeg';
  } else {
    // macOS / Windows lokal
    ffmpegPath = require('ffmpeg-static');
  }

  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;

    const delimiter = process.platform === 'win32' ? ';' : ':';
    process.env.PATH =
      path.dirname(ffmpegPath) + delimiter + (process.env.PATH || '');

    console.log(`[Voice] FFmpeg: ${ffmpegPath}`);
  }
} catch (error) {
  console.error('[Voice] FFmpeg konnte nicht geladen werden:', error);
}
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
  generateDependencyReport,
} = require('@discordjs/voice');

// DAVE (E2EE) – seit 2026 von Discord für Voice Pflicht
try {
  require('@snazzah/davey');
  console.log('[Voice] @snazzah/davey geladen (DAVE/E2EE)');
} catch (e) {
  console.error('[Voice] @snazzah/davey FEHLT! npm install @snazzah/davey');
}

const config = require('./config');
const storage = require('./utils/storage');
const { loadEmbedJSON, buildEmbedsFromJSON, createEmbedManagementPanel } = require('./utils/embeds');
const theoryQuestions = require('./utils/theoryQuestions');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN fehlt in .env!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.ThreadMember],
});

const voiceConnections = new Map();
const pendingTheoryTimeouts = new Map();
// Welches Embed der User gerade per Select gewählt hat (für Modal)
const pendingEmbedEdit = new Map(); // userId -> embedKey

const EMBED_MAP = {
  regelwerk: { file: config.EMBEDS.REGELWERK, channel: config.CHANNELS.REGELWERK, storageKey: 'regelwerk', label: 'Regelwerk' },
  faq: { file: config.EMBEDS.FAQ, channel: config.CHANNELS.FAQ, storageKey: 'faq', label: 'FAQ' },
  theorie: { file: config.EMBEDS.THEORIE, channel: config.CHANNELS.THEORIE_INFOS, storageKey: 'theorie', label: 'Theorie-Info' },
  lernmaterial: { file: config.EMBEDS.LERNMATERIAL, channel: config.CHANNELS.LERNMATERIAL, storageKey: 'lernmaterial', label: 'Lernmaterial' },
  praxis: { file: config.EMBEDS.PRAXIS_INFO, channel: config.CHANNELS.PRAXIS_INFO, storageKey: 'praxis', label: 'Praxis' },
};

// ==================== READY ====================
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Eingeloggt als ${c.user.tag}`);
  if (ffmpegPath) console.log(`[Voice] FFmpeg: ${ffmpegPath}`);
  else console.warn('[Voice] ffmpeg-static nicht gefunden – Musik funktioniert ggf. nicht!');
  try {
    console.log('[Voice] Dependency Report:\n' + generateDependencyReport());
  } catch (e) {
    console.warn('[Voice] dependency report fail:', e.message);
  }

  await setupEmbedChannel();
  await setupVerificationChannel();
  await setupAnmeldenChannel();
  await setupFahrstundenChannel(); // Panel in FAHRSTUNDEN_PLANEN
  await setupAbmeldungChannel();
  await restoreTheoryTimers();
  console.log('🚀 Bot ist bereit!');
});

// ==================== SETUP CHANNELS ====================
async function setupEmbedChannel() {
  const channel = await client.channels.fetch(config.CHANNELS.EMBEDS).catch(() => null);
  if (!channel) return console.warn('Embeds Channel nicht gefunden');

  const messages = await channel.messages.fetch({ limit: 15 });
  const botMsgs = messages.filter((m) => m.author.id === client.user.id);
  // Alte Panels löschen und neu senden
  for (const m of botMsgs.values()) {
    await m.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setTitle('🛠️ Embed Management')
    .setDescription(
      '**So aktualisierst du ein Embed:**\n\n' +
        '1. Wähle im Menü das Embed aus (Regelwerk, FAQ, …)\n' +
        '2. Es öffnet sich ein Formular – füge dort dein **komplettes JSON** ein\n' +
        '3. Absenden → die Nachricht im Ziel-Channel wird aktualisiert (oder neu gesendet)\n\n' +
        'Alternativ: **„Aus Dateien neu laden“** lädt die JSON-Dateien vom Server.'
    )
    .setColor(0x6495ed);

  await channel.send({ embeds: [embed], components: createEmbedManagementPanel() });
}

async function setupVerificationChannel() {
  const channel = await client.channels.fetch(config.CHANNELS.VERIFIZIERUNG).catch(() => null);
  if (!channel) return;
  const messages = await channel.messages.fetch({ limit: 10 });
  if (messages.some((m) => m.author.id === client.user.id && m.components.length > 0)) return;

  const embed = new EmbedBuilder()
    .setTitle('✅ Verifizierung')
    .setDescription(
      'Um dich zu verifizieren, klicke auf den Button und schreibe **EasyDrive** in das Formular.\n\n' +
        'Danach erhältst du **Verifiziert**, **Unverifiziert** wird entfernt.'
    )
    .setColor(0x57f287);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_start').setLabel('Jetzt verifizieren').setStyle(ButtonStyle.Success).setEmoji('✅')
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function setupAnmeldenChannel() {
  const channel = await client.channels.fetch(config.CHANNELS.ANMELDEN).catch(() => null);
  if (!channel) return;
  const messages = await channel.messages.fetch({ limit: 10 });
  if (messages.some((m) => m.author.id === client.user.id && m.components.length > 0)) return;

  const embed = new EmbedBuilder()
    .setTitle('📝 Anmeldung zur Fahrschule')
    .setDescription(
      'Möchtest du dich bei **EasyDrive Berlin** anmelden?\n\n' +
        '• Roblox Name\n• Begründung\n• Klasse (PKW / Motorrad / LKW)\n\n' +
        'Deine Anfrage wird von der Fahrschulleitung geprüft.'
    )
    .setColor(0x5865f2);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('anmelden_start').setLabel('Jetzt anmelden').setStyle(ButtonStyle.Primary).setEmoji('📝')
  );
  await channel.send({ embeds: [embed], components: [row] });
}

/** Panel liegt in FAHRSTUNDEN_PLANEN – Anfragen gehen an FAHRSTUNDEN_ANTRAEGE */
async function setupFahrstundenChannel() {
  const channel = await client.channels.fetch(config.CHANNELS.FAHRSTUNDEN_PLANEN).catch(() => null);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 10 });
  // Alte Bot-Panels entfernen
  for (const m of messages.filter((x) => x.author.id === client.user.id).values()) {
    await m.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setTitle('🚗 Fahrstunden planen')
    .setDescription(
      'Du hast die **Praxis**-Rolle und möchtest eine Fahrstunde?\n\n' +
        'Klicke auf den Button. Deine Anfrage erscheint in **Fahrstunden-Anträge**, ' +
        'dort kann ein Fahrlehrer sie übernehmen und die Stunden bestätigen.\n\n' +
        `Ziel: **${config.REQUIRED_HOURS} Stunden** → dann Rolle **Erwartet Prüfung**.`
    )
    .setColor(0xfee75c);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lesson_request').setLabel('Fahrstunde beantragen').setStyle(ButtonStyle.Primary).setEmoji('🚗')
  );
  await channel.send({ embeds: [embed], components: [row] });
}

async function setupAbmeldungChannel() {
  const channel = await client.channels.fetch(config.CHANNELS.AN_ABMELDUNG).catch(() => null);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 10 });
  for (const m of messages.filter((x) => x.author.id === client.user.id).values()) {
    await m.delete().catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setTitle('📴 Abmeldung')
    .setDescription(
      'Du bist für eine Weile nicht da und möchtest dich abmelden?\n\n' +
        'Klicke auf den Button und gib an:\n' +
        '• **Begründung**\n' +
        '• **Start-Datum** (z.B. 05.09.2026)\n' +
        '• **End-Datum** (z.B. 20.09.2026)\n\n' +
        'Die Fahrschulleitung prüft deine Abmeldung. Du bekommst eine DM mit der Entscheidung.'
    )
    .setColor(0xed4245);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('abmelden_start').setLabel('Abmelden').setStyle(ButtonStyle.Danger).setEmoji('📴')
  );
  await channel.send({ embeds: [embed], components: [row] });
}

// ==================== WELCOME ====================
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== config.GUILD_ID) return;
  try {
    const unverified = member.guild.roles.cache.get(config.ROLES.UNVERIFIZIERT);
    if (unverified) await member.roles.add(unverified).catch(() => {});

    const welcomeChannel = await client.channels.fetch(config.CHANNELS.WILLKOMMEN).catch(() => null);
    if (welcomeChannel) {
      const json = loadEmbedJSON(config.EMBEDS.WILLKOMMEN);
      const displayName = member.displayName || member.user.username;
      const embeds = buildEmbedsFromJSON(json, member.id, displayName);
      await welcomeChannel.send({ content: `<@${member.id}>`, embeds });
    }

    try {
      await member.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❤️ Willkommen bei EasyDrive Berlin!')
            .setDescription(
              `Hallo <@${member.id}>!\n\nWillkommen in unserer Fahrschule. Bitte lies die wichtigen Channels und verifiziere dich.\n\nViel Erfolg!`
            )
            .setColor(0x6408527),
        ],
      });
    } catch {}
  } catch (err) {
    console.error('Welcome error:', err);
  }
});

// ==================== SUPPORT FORUM TAG ====================
client.on(Events.ThreadCreate, async (thread) => {
  try {
    if (thread.parentId !== config.CHANNELS.SUPPORT) return;
    const parent = thread.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return;

    const tags = parent.availableTags || [];
    const tag = tags.find((t) => t.name.toLowerCase() === (config.SUPPORT_TAG_NAME || 'In Bearbeitung').toLowerCase());
    if (!tag) {
      console.warn('[Support] Tag nicht gefunden:', tags.map((t) => t.name));
      return;
    }
    const current = thread.appliedTags || [];
    if (!current.includes(tag.id)) {
      await thread.setAppliedTags([...current, tag.id]);
      console.log(`[Support] Tag "${tag.name}" gesetzt`);
    }
  } catch (err) {
    console.error('ThreadCreate error:', err);
  }
});

// ==================== INTERACTIONS ====================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelect(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = { content: '❌ Es ist ein Fehler aufgetreten.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

async function handleSelect(interaction) {
  if (interaction.customId === 'embed_select') {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
      !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG) &&
      !interaction.member.roles.cache.has(config.ROLES.FAHRLEHRER)
    ) {
      return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
    }

    const key = interaction.values[0];
    pendingEmbedEdit.set(interaction.user.id, key);

    const modal = new ModalBuilder()
      .setCustomId(`embed_json_${key}`)
      .setTitle(`JSON: ${EMBED_MAP[key]?.label || key}`);

    // Discord Modal max 4000 Zeichen pro TextInput – für große Embeds ggf. kürzen
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('embed_json')
          .setLabel('Komplettes Embed-JSON einfügen')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('{"embeds":[{"title":"...","description":"...","color":6602202}]}')
          .setMaxLength(4000)
      )
    );

    await interaction.showModal(modal);
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === 'embed_reload_files') {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
      !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG)
    ) {
      return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const results = [];
    for (const [key, cfg] of Object.entries(EMBED_MAP)) {
      try {
        const json = loadEmbedJSON(cfg.file);
        storage.setCustomEmbed(key, null); // override löschen
        await applyEmbedToChannel(key, json);
        results.push(`✅ ${cfg.label}`);
      } catch (e) {
        results.push(`❌ ${cfg.label}: ${e.message}`);
      }
    }
    return interaction.editReply({ content: results.join('\n') });
  }

  if (id === 'verify_start') {
    const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Verifizierung');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('verify_code')
          .setLabel('Schreibe "EasyDrive"')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('EasyDrive')
      )
    );
    return interaction.showModal(modal);
  }

  if (id === 'anmelden_start') {
    const modal = new ModalBuilder().setCustomId('anmelden_modal').setTitle('Anmeldung EasyDrive');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('roblox_name').setLabel('Roblox Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('begruendung').setLabel('Begründung / Warum?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('klasse').setLabel('Klasse (PKW / Motorrad / LKW)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('PKW, Motorrad oder LKW').setMaxLength(20)
      )
    );
    return interaction.showModal(modal);
  }

  if (id === 'abmelden_start') {
    const modal = new ModalBuilder().setCustomId('abmelden_modal').setTitle('Abmeldung');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('grund')
          .setLabel('Begründung')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('start_datum')
          .setLabel('Start-Datum (z.B. 05.09.2026)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('TT.MM.JJJJ')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('end_datum')
          .setLabel('End-Datum (z.B. 20.09.2026)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('TT.MM.JJJJ')
      )
    );
    return interaction.showModal(modal);
  }

  if (id.startsWith('app_accept_') || id.startsWith('app_reject_')) {
    return handleApplicationDecision(interaction);
  }
  if (id.startsWith('abs_accept_') || id.startsWith('abs_reject_')) {
    return handleAbsenceDecision(interaction);
  }
  if (id.startsWith('theory_start_')) return handleTheoryStart(interaction);
  if (id.startsWith('theory_decline_')) {
    return interaction.reply({ content: 'Okay, du kannst später starten.', ephemeral: true });
  }
  if (id.startsWith('theory_accept_') || id.startsWith('theory_reject_')) {
    return handleTheoryReview(interaction);
  }
  if (id === 'lesson_request') return handleLessonRequest(interaction);
  if (id.startsWith('lesson_take_')) return handleLessonTake(interaction);
  if (id.startsWith('lesson_hours_')) {
    const requestId = id.replace('lesson_hours_', '');
    const modal = new ModalBuilder().setCustomId(`lesson_hours_modal_${requestId}`).setTitle('Stunden bestätigen');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hours_amount')
          .setLabel('Anzahl der Stunden (z.B. 1 oder 2)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('1')
      )
    );
    return interaction.showModal(modal);
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  if (id.startsWith('embed_json_')) {
    const key = id.replace('embed_json_', '');
    return handleEmbedJsonSubmit(interaction, key);
  }

  if (id === 'verify_modal') {
    const code = interaction.fields.getTextInputValue('verify_code').trim();
    if (code.toLowerCase() !== 'easydrive') {
      return interaction.reply({ content: '❌ Falscher Code. Schreibe genau **EasyDrive**.', ephemeral: true });
    }
    await interaction.member.roles.add(config.ROLES.VERIFIZIERT).catch(() => {});
    await interaction.member.roles.remove(config.ROLES.UNVERIFIZIERT).catch(() => {});
    return interaction.reply({ content: '✅ Du bist jetzt **verifiziert**!', ephemeral: true });
  }

  if (id === 'anmelden_modal') return handleAnmeldenSubmit(interaction);
  if (id === 'abmelden_modal') return handleAbmeldenSubmit(interaction);
  if (id.startsWith('theory_answer_')) return handleTheoryAnswers(interaction);
  if (id.startsWith('lesson_hours_modal_')) return handleLessonHoursModal(interaction);
}

// ==================== EMBED JSON UPDATE ====================
async function handleEmbedJsonSubmit(interaction, key) {
  await interaction.deferReply({ ephemeral: true });
  const cfg = EMBED_MAP[key];
  if (!cfg) return interaction.editReply({ content: 'Unbekanntes Embed.' });

  let raw = interaction.fields.getTextInputValue('embed_json').trim();
  // Manchmal packen Leute ```json ... ``` drum
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return interaction.editReply({ content: `❌ Ungültiges JSON: ${e.message}` });
  }

  if (!json.embeds || !Array.isArray(json.embeds)) {
    return interaction.editReply({ content: '❌ JSON muss ein `"embeds": [ ... ]` Array enthalten.' });
  }

  storage.setCustomEmbed(key, json);
  try {
    await applyEmbedToChannel(key, json);
    await interaction.editReply({ content: `✅ **${cfg.label}** wurde aktualisiert.` });
  } catch (e) {
    await interaction.editReply({ content: `❌ Fehler beim Senden: ${e.message}` });
  }
}

async function applyEmbedToChannel(key, json) {
  const cfg = EMBED_MAP[key];
  const embeds = buildEmbedsFromJSON(json);
  const targetChannel = await client.channels.fetch(cfg.channel);
  const stored = storage.getEmbedMessages();

  if (stored[cfg.storageKey]) {
    try {
      const msg = await targetChannel.messages.fetch(stored[cfg.storageKey]);
      await msg.edit({ embeds, content: null, components: [] });
      return;
    } catch {
      // Message weg → neu senden
    }
  }
  const newMsg = await targetChannel.send({ embeds });
  storage.setEmbedMessage(cfg.storageKey, newMsg.id);
}

// ==================== ANMELDUNG ====================
async function handleAnmeldenSubmit(interaction) {
  const roblox = interaction.fields.getTextInputValue('roblox_name').trim();
  const reason = interaction.fields.getTextInputValue('begruendung').trim();
  let klasse = interaction.fields.getTextInputValue('klasse').trim().toLowerCase();

  if (['pkw', 'auto', 'b', 'klasse b'].includes(klasse)) klasse = 'PKW';
  else if (['motorrad', 'moto', 'a', 'klasse a', 'mottorad'].includes(klasse)) klasse = 'Motorrad';
  else if (['lkw', 'c', 'klasse c', 'truck'].includes(klasse)) klasse = 'LKW';
  else {
    return interaction.reply({ content: '❌ Ungültige Klasse. Erlaubt: **PKW**, **Motorrad** oder **LKW**.', ephemeral: true });
  }

  await interaction.member.roles.add(config.ROLES.ERWARTET_BEARBEITUNG).catch(() => {});

  const logsChannel = await client.channels.fetch(config.CHANNELS.LOGS);
  const embed = new EmbedBuilder()
    .setTitle('📋 Neue Anmelde-Anfrage')
    .setColor(0x5865f2)
    .addFields(
      { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
      { name: 'Roblox Name', value: roblox, inline: true },
      { name: 'Klasse', value: klasse, inline: true },
      { name: 'Begründung', value: reason }
    )
    .setTimestamp()
    .setFooter({ text: `User ID: ${interaction.user.id}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app_accept_${interaction.user.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app_reject_${interaction.user.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger)
  );

  const msg = await logsChannel.send({
    content: `<@&${config.ROLES.FAHRSCHULLEITUNG}>`,
    embeds: [embed],
    components: [row],
  });

  storage.setApplication(interaction.user.id, { roblox, reason, klasse, messageId: msg.id, status: 'pending' });
  await interaction.reply({ content: '✅ Anmelde-Anfrage gesendet!', ephemeral: true });
}

async function handleApplicationDecision(interaction) {
  const isAccept = interaction.customId.startsWith('app_accept_');
  const userId = interaction.customId.replace(isAccept ? 'app_accept_' : 'app_reject_', '');

  if (
    !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG) &&
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return interaction.reply({ content: '❌ Nur die Fahrschulleitung.', ephemeral: true });
  }

  const app = storage.getApplications()[userId];
  if (!app || app.status !== 'pending') {
    return interaction.reply({ content: '❌ Anfrage nicht mehr offen.', ephemeral: true });
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (isAccept) {
    if (member) {
      await member.roles.add([config.ROLES.SCHUELER, config.ROLES.THEORIE]).catch(() => {});
      await member.roles.remove(config.ROLES.ERWARTET_BEARBEITUNG).catch(() => {});
    }
    app.status = 'accepted';
    storage.setApplication(userId, app);

    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Anmeldung angenommen!')
            .setDescription(
              `Klasse: **${app.klasse}**\nRollen **Schüler** + **Theorie** erhalten.\n\nIn ca. 10 Minuten kommt die Theorie-Einladung.`
            )
            .setColor(0x57f287),
        ],
      });
    } catch {}

    scheduleTheoryInvite(userId, app.klasse);
    await interaction.update({
      content: `✅ Anfrage von <@${userId}> **angenommen** von ${interaction.user}.`,
      embeds: interaction.message.embeds,
      components: [],
    });
  } else {
    if (member) await member.roles.remove(config.ROLES.ERWARTET_BEARBEITUNG).catch(() => {});
    app.status = 'rejected';
    storage.setApplication(userId, app);
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Anmeldung abgelehnt')
            .setDescription('Deine Anmeldung wurde abgelehnt. Bei Fragen → Support.')
            .setColor(0xed4245),
        ],
      });
    } catch {}
    await interaction.update({
      content: `❌ Anfrage von <@${userId}> **abgelehnt** von ${interaction.user}.`,
      embeds: interaction.message.embeds,
      components: [],
    });
  }
}

// ==================== ABMELDUNG ====================
async function handleAbmeldenSubmit(interaction) {
  const grund = interaction.fields.getTextInputValue('grund').trim();
  const start = interaction.fields.getTextInputValue('start_datum').trim();
  const end = interaction.fields.getTextInputValue('end_datum').trim();

  const absId = `${interaction.user.id}_${Date.now()}`;
  const logsChannel = await client.channels.fetch(config.CHANNELS.LOGS);

  const embed = new EmbedBuilder()
    .setTitle('📴 Neue Abmelde-Anfrage')
    .setColor(0xed4245)
    .addFields(
      { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
      { name: 'Von', value: start, inline: true },
      { name: 'Bis', value: end, inline: true },
      { name: 'Begründung', value: grund }
    )
    .setTimestamp()
    .setFooter({ text: `User ID: ${interaction.user.id}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`abs_accept_${absId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`abs_reject_${absId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger)
  );

  const msg = await logsChannel.send({
    content: `<@&${config.ROLES.FAHRSCHULLEITUNG}>`,
    embeds: [embed],
    components: [row],
  });

  storage.setAbsence(absId, {
    userId: interaction.user.id,
    reason: grund,
    start,
    end,
    status: 'pending',
    messageId: msg.id,
  });

  await interaction.reply({
    content: '✅ Deine Abmelde-Anfrage wurde gesendet. Du erhältst eine DM mit der Entscheidung.',
    ephemeral: true,
  });
}

async function handleAbsenceDecision(interaction) {
  const isAccept = interaction.customId.startsWith('abs_accept_');
  const absId = interaction.customId.replace(isAccept ? 'abs_accept_' : 'abs_reject_', '');

  if (
    !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG) &&
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return interaction.reply({ content: '❌ Nur die Fahrschulleitung.', ephemeral: true });
  }

  const abs = storage.getAbsences()[absId];
  if (!abs || abs.status !== 'pending') {
    return interaction.reply({ content: '❌ Anfrage nicht mehr offen.', ephemeral: true });
  }

  abs.status = isAccept ? 'accepted' : 'rejected';
  storage.setAbsence(absId, abs);

  try {
    const user = await client.users.fetch(abs.userId);
    if (isAccept) {
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Abmeldung angenommen')
            .setDescription(
              `Deine Abmeldung wurde akzeptiert.\n\n**Von:** ${abs.start}\n**Bis:** ${abs.end}\n**Grund:** ${abs.reason}`
            )
            .setColor(0x57f287),
        ],
      });
    } else {
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Abmeldung abgelehnt')
            .setDescription(
              `Deine Abmeldung wurde abgelehnt.\n\n**Von:** ${abs.start}\n**Bis:** ${abs.end}\n\nBei Fragen melde dich im Support.`
            )
            .setColor(0xed4245),
        ],
      });
    }
  } catch {}

  await interaction.update({
    content: isAccept
      ? `✅ Abmeldung von <@${abs.userId}> **angenommen** von ${interaction.user}.`
      : `❌ Abmeldung von <@${abs.userId}> **abgelehnt** von ${interaction.user}.`,
    embeds: interaction.message.embeds,
    components: [],
  });
}

// ==================== THEORY ====================
function scheduleTheoryInvite(userId, klasse, delayMs = null) {
  if (pendingTheoryTimeouts.has(userId)) {
    clearTimeout(pendingTheoryTimeouts.get(userId));
    pendingTheoryTimeouts.delete(userId);
  }

  const timers = storage.getTheoryTimers();
  const scheduledAt = timers[userId] || Date.now();
  if (!timers[userId]) storage.setTheoryTimer(userId, Date.now());

  const elapsed = Date.now() - scheduledAt;
  const remaining = Math.max(0, (delayMs ?? config.THEORY_DELAY_MS) - elapsed);

  console.log(`[Theorie] ${userId} in ${Math.round(remaining / 1000)}s`);

  const timeout = setTimeout(async () => {
    pendingTheoryTimeouts.delete(userId);
    try {
      const user = await client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle('📚 Theorie-Prüfung starten?')
        .setDescription(
          `Hallo! Du hast die Rolle **Theorie** seit 10 Minuten.\n\n` +
            `Möchtest du jetzt starten?\nKlasse: **${klasse || 'unbekannt'}**`
        )
        .setColor(0x5865f2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`theory_start_${userId}`).setLabel('Ja, starten').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`theory_decline_${userId}`).setLabel('Später').setStyle(ButtonStyle.Secondary)
      );
      await user.send({ embeds: [embed], components: [row] });
      console.log(`[Theorie] DM an ${userId} gesendet`);
    } catch (err) {
      console.error(`[Theorie] DM fail ${userId}:`, err.message);
    }
  }, remaining);

  pendingTheoryTimeouts.set(userId, timeout);
}

async function restoreTheoryTimers() {
  try {
    const guild = await client.guilds.fetch(config.GUILD_ID);
    await guild.members.fetch();
    const theorieRole = guild.roles.cache.get(config.ROLES.THEORIE);
    if (!theorieRole) return;

    const timers = storage.getTheoryTimers();
    const apps = storage.getApplications();

    for (const member of theorieRole.members.values()) {
      if (member.user.bot) continue;
      const klasse = apps[member.id]?.klasse || 'PKW';
      if (!timers[member.id]) {
        scheduleTheoryInvite(member.id, klasse);
      } else {
        const elapsed = Date.now() - timers[member.id];
        scheduleTheoryInvite(member.id, klasse, elapsed >= config.THEORY_DELAY_MS ? 0 : undefined);
      }
    }
    console.log('[Theorie] Timer restored');
  } catch (err) {
    console.error('[Theorie] restore error:', err);
  }
}

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id !== config.GUILD_ID) return;
  if (!oldMember.roles.cache.has(config.ROLES.THEORIE) && newMember.roles.cache.has(config.ROLES.THEORIE)) {
    const app = storage.getApplications()[newMember.id];
    scheduleTheoryInvite(newMember.id, app?.klasse || 'PKW');
  }
});

async function handleTheoryStart(interaction) {
  const userId = interaction.customId.replace('theory_start_', '');
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'Nicht deine Anfrage.', ephemeral: true });
  }
  const app = storage.getApplications()[userId];
  const klasse = app?.klasse || 'PKW';
  const questions = theoryQuestions[klasse] || theoryQuestions.PKW;
  storage.setTheorySession(userId, { klasse, started: Date.now(), answers: {} });

  const modal = new ModalBuilder().setCustomId(`theory_answer_${userId}`).setTitle(`Theorie ${klasse}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('q_class')
        .setLabel('Deine Klasse (PKW / Motorrad / LKW)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(klasse)
    )
  );
  for (let i = 0; i < Math.min(4, questions.length); i++) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q_${i}`)
          .setLabel(questions[i].q.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Deine Antwort...')
      )
    );
  }
  await interaction.showModal(modal);
}

async function handleTheoryAnswers(interaction) {
  const userId = interaction.customId.replace('theory_answer_', '');
  if (interaction.user.id !== userId) {
    return interaction.reply({ content: 'Nicht deine Session.', ephemeral: true });
  }
  const session = storage.getTheorySessions()[userId];
  const klasseInput = interaction.fields.getTextInputValue('q_class').trim();
  const klasse = session?.klasse || klasseInput;
  const questions = theoryQuestions[klasse] || theoryQuestions.PKW;

  const answers = [{ q: 'Deine Klasse', a: klasseInput }];
  for (let i = 0; i < Math.min(4, questions.length); i++) {
    answers.push({
      q: questions[i].q,
      a: interaction.fields.getTextInputValue(`q_${i}`).trim(),
      expected: questions[i].a,
    });
  }

  const reviewChannel = await client.channels.fetch(config.CHANNELS.PRUEFUNGEN_KONTROLLIEREN);
  const embed = new EmbedBuilder()
    .setTitle('📝 Theorie-Prüfung')
    .setColor(0xfee75c)
    .setDescription(`Klasse: **${klasse}**\nUser: <@${userId}>`)
    .setTimestamp();
  for (const item of answers) {
    embed.addFields({
      name: item.q,
      value: `**Antwort:** ${item.a}${item.expected ? `\n*Erwartet: ${item.expected}*` : ''}`,
    });
  }

  const reviewId = `${userId}_${Date.now()}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`theory_accept_${reviewId}`).setLabel('Annehmen → Praxis').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`theory_reject_${reviewId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger)
  );
  const msg = await reviewChannel.send({ embeds: [embed], components: [row] });
  storage.setTheoryReview(reviewId, { userId, klasse, answers, messageId: msg.id });
  await interaction.reply({ content: '✅ Antworten gesendet. Du bekommst eine DM nach der Prüfung.', ephemeral: true });
}

async function handleTheoryReview(interaction) {
  const isAccept = interaction.customId.startsWith('theory_accept_');
  const reviewId = interaction.customId.replace(isAccept ? 'theory_accept_' : 'theory_reject_', '');

  if (
    !interaction.member.roles.cache.has(config.ROLES.FAHRLEHRER) &&
    !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG) &&
    !interaction.member.roles.cache.has(config.ROLES.PRUEFER) &&
    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
  }

  const review = storage.getTheoryReviews()[reviewId];
  if (!review) return interaction.reply({ content: '❌ Review nicht gefunden.', ephemeral: true });

  const member = await interaction.guild.members.fetch(review.userId).catch(() => null);

  if (isAccept) {
    if (member) {
      await member.roles.add(config.ROLES.PRAXIS).catch(() => {});
      await member.roles.remove(config.ROLES.THEORIE).catch(() => {});
    }
    try {
      const user = await client.users.fetch(review.userId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Theorie bestanden!')
            .setDescription(`Rolle **Praxis** erhalten.\nZiel: **${config.REQUIRED_HOURS} Stunden**.`)
            .setColor(0x57f287),
        ],
      });
    } catch {}
    await interaction.update({
      content: `✅ Theorie von <@${review.userId}> **angenommen** → Praxis (${interaction.user})`,
      components: [],
    });
  } else {
    try {
      const user = await client.users.fetch(review.userId);
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Theorie nicht bestanden')
            .setDescription('Nochmal Lernmaterial lesen und später erneut versuchen.')
            .setColor(0xed4245),
        ],
      });
    } catch {}
    await interaction.update({
      content: `❌ Theorie von <@${review.userId}> **abgelehnt** (${interaction.user})`,
      components: [],
    });
  }
  storage.removeTheoryReview(reviewId);
  storage.removeTheorySession(review.userId);
}

// ==================== FAHRSTUNDEN ====================
async function handleLessonRequest(interaction) {
  const member = interaction.member;
  if (!member.roles.cache.has(config.ROLES.PRAXIS)) {
    return interaction.reply({ content: '❌ Du brauchst die **Praxis**-Rolle.', ephemeral: true });
  }

  const currentHours = storage.getHours()[member.id] || 0;
  if (currentHours >= config.REQUIRED_HOURS) {
    return interaction.reply({
      content: `✅ Du hast bereits ${currentHours}/${config.REQUIRED_HOURS} Stunden.`,
      ephemeral: true,
    });
  }

  const requestId = `${member.id}_${Date.now()}`;
  const embed = new EmbedBuilder()
    .setTitle('🚗 Neue Fahrstunden-Anfrage')
    .setColor(0xfee75c)
    .setDescription(
      `<@${member.id}> möchte eine Fahrstunde.\n\nAktuell: **${currentHours}/${config.REQUIRED_HOURS}**`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lesson_take_${requestId}`).setLabel('Übernehmen').setStyle(ButtonStyle.Primary).setEmoji('✋')
  );

  // Anfrage geht in FAHRSTUNDEN_ANTRAEGE
  const antraege = await client.channels.fetch(config.CHANNELS.FAHRSTUNDEN_ANTRAEGE);
  const msg = await antraege.send({
    content: `<@&${config.ROLES.FAHRLEHRER}>`,
    embeds: [embed],
    components: [row],
  });

  storage.setLessonRequest(requestId, {
    studentId: member.id,
    teacherId: null,
    hours: 0,
    status: 'open',
    messageId: msg.id,
    currentHours,
  });

  await interaction.reply({
    content: '✅ Anfrage gesendet! Schau in **Fahrstunden-Anträge** – ein Fahrlehrer übernimmt sie.',
    ephemeral: true,
  });
}

async function handleLessonTake(interaction) {
  const requestId = interaction.customId.replace('lesson_take_', '');
  const req = storage.getLessonRequests()[requestId];
  if (!req || req.status !== 'open') {
    return interaction.reply({ content: '❌ Anfrage nicht verfügbar.', ephemeral: true });
  }
  if (
    !interaction.member.roles.cache.has(config.ROLES.FAHRLEHRER) &&
    !interaction.member.roles.cache.has(config.ROLES.FAHRSCHULLEITUNG)
  ) {
    return interaction.reply({ content: '❌ Nur Fahrlehrer.', ephemeral: true });
  }

  req.teacherId = interaction.user.id;
  req.status = 'taken';
  storage.setLessonRequest(requestId, req);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lesson_hours_${requestId}`).setLabel('Stunden bestätigen').setStyle(ButtonStyle.Success).setEmoji('✅')
  );

  await interaction.update({
    content: `✅ Übernommen von <@${interaction.user.id}>`,
    embeds: [
      EmbedBuilder.from(interaction.message.embeds[0]).setDescription(
        interaction.message.embeds[0].description +
          `\n\n**Übernommen von:** <@${interaction.user.id}>`
      ),
    ],
    components: [row],
  });

  try {
    const student = await client.users.fetch(req.studentId);
    await student.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🚗 Fahrstunde übernommen')
          .setDescription(`Fahrlehrer <@${interaction.user.id}> hat deine Anfrage übernommen. Melde dich bei ihm.`)
          .setColor(0x57f287),
      ],
    });
  } catch {}
}

async function handleLessonHoursModal(interaction) {
  const requestId = interaction.customId.replace('lesson_hours_modal_', '');
  const req = storage.getLessonRequests()[requestId];
  if (!req) return interaction.reply({ content: '❌ Anfrage nicht gefunden.', ephemeral: true });
  if (interaction.user.id !== req.teacherId) {
    return interaction.reply({ content: '❌ Nur der übernehmende Fahrlehrer.', ephemeral: true });
  }

  const amount = parseFloat(interaction.fields.getTextInputValue('hours_amount').replace(',', '.'));
  if (isNaN(amount) || amount <= 0 || amount > 10) {
    return interaction.reply({ content: '❌ Ungültige Stunden (1–10).', ephemeral: true });
  }

  const newTotal = storage.addHours(req.studentId, amount);

  try {
    const channel = await client.channels.fetch(config.CHANNELS.FAHRSTUNDEN_ANTRAEGE);
    const msg = await channel.messages.fetch(req.messageId);
    await msg.edit({
      content: `✅ +${amount} → **${newTotal}/${config.REQUIRED_HOURS}**`,
      components: [],
    });
  } catch {}

  req.status = 'completed';
  req.hours = amount;
  storage.setLessonRequest(requestId, req);

  if (newTotal >= config.REQUIRED_HOURS) {
    const member = await interaction.guild.members.fetch(req.studentId).catch(() => null);
    if (member) await member.roles.add(config.ROLES.ERWARTET_PRUEFUNG).catch(() => {});
    try {
      const student = await client.users.fetch(req.studentId);
      await student.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎓 30 Stunden erreicht!')
            .setDescription(`**${newTotal} Stunden** – Rolle **Erwartet Prüfung**. Termin mit Fahrlehrer + Prüfer vereinbaren.`)
            .setColor(0x57f287),
        ],
      });
    } catch {}
  } else {
    try {
      const student = await client.users.fetch(req.studentId);
      await student.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Fahrstunde bestätigt')
            .setDescription(`+${amount} Stunde(n). Stand: **${newTotal}/${config.REQUIRED_HOURS}**`)
            .setColor(0x57f287),
        ],
      });
    } catch {}
  }

  await interaction.reply({
    content: `✅ ${amount}h für <@${req.studentId}> → **${newTotal}/${config.REQUIRED_HOURS}**`,
    ephemeral: true,
  });
}

// ==================== VOICE ====================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const supportId = config.CHANNELS.SUPPORT_WARTERAUM;

  // Eigene Voice-State-Änderungen des Bots ignorieren (verhindert doppelten Join)
  if (newState.member?.user?.bot) return;

  // Jemand joined Support Warteraum
  if (newState.channelId === supportId && oldState.channelId !== supportId) {
    console.log(`[Voice] ${newState.member?.user?.tag} joined Support Warteraum`);
    // Kurz warten, damit Discord den State stabil hat
    setTimeout(() => joinAndPlayMusic(newState.guild.channels.cache.get(supportId) || newState.channel), 800);
  }

  // Jemand left
  if (oldState.channelId === supportId && newState.channelId !== supportId) {
    setTimeout(() => {
      const channel = oldState.guild.channels.cache.get(supportId);
      if (!channel) return;
      const humans = channel.members.filter((m) => !m.user.bot).size;
      console.log(`[Voice] left, humans remaining: ${humans}`);
      if (humans === 0) leaveVoice(supportId);
    }, 1500);
  }
});

async function joinAndPlayMusic(channel) {
  if (!channel || channel.id !== config.CHANNELS.SUPPORT_WARTERAUM) return;

  // Schon drin?
  if (voiceConnections.has(channel.id)) {
    const existing = voiceConnections.get(channel.id);
    const status = existing.connection.state.status;
    console.log(`[Voice] already connected, status=${status}, player=${existing.player.state.status}`);
    if (status === VoiceConnectionStatus.Ready && existing.player.state.status !== AudioPlayerStatus.Playing) {
      playMusic(existing.player);
    }
    return;
  }

  const musicPath = path.join(__dirname, 'music.mp3');
  if (!fs.existsSync(musicPath)) {
    console.error('[Voice] music.mp3 FEHLT:', musicPath);
    return;
  }
  console.log(`[Voice] music.mp3 gefunden (${(fs.statSync(musicPath).size / 1024).toFixed(0)} KB)`);

  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    connection.on('stateChange', (oldS, newS) => {
      console.log(`[Voice] connection: ${oldS.status} → ${newS.status}`);
    });
    connection.on('error', (err) => console.error('[Voice] connection error:', err));

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    connection.subscribe(player);

    // Sofort registrieren, damit parallele Aufrufe keine zweite Verbindung starten
    voiceConnections.set(channel.id, { connection, player });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 25_000);
      console.log('[Voice] Connection READY');
    } catch (err) {
      console.error('[Voice] Timeout waiting for Ready:', err.message);
      voiceConnections.delete(channel.id);
      try { connection.destroy(); } catch {}
      return;
    }

    player.on('stateChange', (oldS, newS) => {
      console.log(`[Voice] player: ${oldS.status} → ${newS.status}`);
    });
    player.on(AudioPlayerStatus.Idle, () => {
      console.log('[Voice] Idle → loop');
      setTimeout(() => playMusic(player), 300);
    });
    player.on('error', (err) => {
      console.error('[Voice] player error:', err);
      setTimeout(() => playMusic(player), 2000);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log('[Voice] Disconnected – versuche Reconnect…');
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Nur verlassen wenn wirklich niemand mehr da ist
        const ch = channel.guild.channels.cache.get(channel.id);
        const humans = ch ? ch.members.filter((m) => !m.user.bot).size : 0;
        if (humans === 0) leaveVoice(channel.id);
        else {
          // Rejoin versuchen
          leaveVoice(channel.id);
          setTimeout(() => joinAndPlayMusic(ch), 2000);
        }
      }
    });

    playMusic(player);
  } catch (err) {
    console.error('[Voice] joinAndPlayMusic error:', err);
  }
}

function playMusic(player) {
  const musicPath = path.join(__dirname, 'music.mp3');
  if (!fs.existsSync(musicPath)) {
    console.warn('[Voice] music.mp3 fehlt unter:', musicPath);
    return;
  }
  try {
    // Direkter Dateipfad – @discordjs/voice startet FFmpeg selbst
    const resource = createAudioResource(musicPath, {
      inlineVolume: true,
    });
    if (resource.volume) resource.volume.setVolume(0.45);
    player.play(resource);
    console.log('[Voice] play() aufgerufen – Status:', player.state.status);
  } catch (err) {
    console.error('[Voice] playMusic error:', err);
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
  console.log('[Voice] Left Support Warteraum');
}

// ==================== ERRORS ====================
client.on('error', console.error);
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

client.login(process.env.DISCORD_TOKEN);