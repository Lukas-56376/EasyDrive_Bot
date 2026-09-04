const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

function loadEmbedJSON(filename) {
  const file = path.join(__dirname, '..', filename);
  if (!fs.existsSync(file)) throw new Error(`Embed file not found: ${filename}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * @param {object} jsonData
 * @param {string|null} userId
 * @param {string|null} displayName
 */
function buildEmbedsFromJSON(jsonData, userId = null, displayName = null) {
  const embeds = [];
  for (const e of jsonData.embeds || []) {
    const embed = new EmbedBuilder();
    if (e.title) {
      let title = e.title;
      if (userId && title.includes('<@user-ping>')) {
        const name = displayName || 'User';
        title = title.replace(/<@user-ping>/g, name);
      }
      embed.setTitle(title);
    }
    if (e.description) {
      let desc = e.description;
      if (userId && desc.includes('<@user-ping>')) {
        desc = desc.replace(/<@user-ping>/g, `<@${userId}>`);
      }
      embed.setDescription(desc);
    }
    if (e.color) embed.setColor(e.color);
    if (e.image?.url) embed.setImage(e.image.url);
    if (e.thumbnail?.url && e.thumbnail.url.trim()) embed.setThumbnail(e.thumbnail.url);
    if (e.footer?.text) embed.setFooter({ text: e.footer.text, iconURL: e.footer.icon_url });
    if (e.fields) {
      for (const f of e.fields) {
        embed.addFields({ name: f.name, value: f.value, inline: f.inline || false });
      }
    }
    embeds.push(embed);
  }
  return embeds;
}

function createEmbedManagementPanel() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('embed_select')
    .setPlaceholder('Welches Embed aktualisieren?')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Regelwerk').setValue('regelwerk').setEmoji('📜'),
      new StringSelectMenuOptionBuilder().setLabel('FAQ').setValue('faq').setEmoji('❓'),
      new StringSelectMenuOptionBuilder().setLabel('Theorie-Info').setValue('theorie').setEmoji('📚'),
      new StringSelectMenuOptionBuilder().setLabel('Lernmaterial').setValue('lernmaterial').setEmoji('📖'),
      new StringSelectMenuOptionBuilder().setLabel('Praxis').setValue('praxis').setEmoji('🚘')
    );

  const row1 = new ActionRowBuilder().addComponents(select);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('embed_reload_files')
      .setLabel('Aus Dateien neu laden')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
  );

  return [row1, row2];
}

module.exports = {
  loadEmbedJSON,
  buildEmbedsFromJSON,
  createEmbedManagementPanel,
};
