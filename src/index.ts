import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  Role,
  SlashCommandBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createCalendarEvent } from './calendar';
import { envNumber, requiredEnv } from './env';
import { StateStore } from './state';
import { formatFinnishQuestionTime, parseFlexDateTime } from './time';
import type { FlexEvent, FlexResponseStatus } from './types';

const FLEXII_COMMAND = 'flexii';
const FLEX_ROLE_COMMAND = 'flex-role';
const FLEX_ROLE_GET_COMMAND = 'flex-role-get';
const FLEX_ROLE_REMOVE_COMMAND = 'flex-role-remove';
const FLEX_ROLE_CREATE_COMMAND = 'flex-role-create';
const OTHER_TIME_INPUT = 'other_time';

const store = new StateStore();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName(FLEXII_COMMAND)
    .setDescription('Luo flex ranked -kysely')
    .addStringOption(option =>
      option
        .setName('aika')
        .setDescription('Kellonaika, esimerkiksi 18:00')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('päivä')
        .setDescription('tänään, huomenna, pe, 3.6. tai 2026-06-03')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('viesti')
        .setDescription('Oma kysymysteksti')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('kesto')
        .setDescription('Kalenterivarauksen kesto minuutteina')
        .setMinValue(30)
        .setMaxValue(360)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName(FLEX_ROLE_COMMAND)
    .setDescription('Aseta flex-pingien rooli')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Rooli, jota pingataan flex-kyselyissä')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName(FLEX_ROLE_GET_COMMAND)
    .setDescription('Anna flex-pingien rooli itsellesi'),
  new SlashCommandBuilder()
    .setName(FLEX_ROLE_REMOVE_COMMAND)
    .setDescription('Poista flex-pingien rooli itseltäsi'),
  new SlashCommandBuilder()
    .setName(FLEX_ROLE_CREATE_COMMAND)
    .setDescription('Luo ja aseta flex-pingien rooli')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName('nimi')
        .setDescription('Roolin nimi')
        .setRequired(false)
    ),
].map(command => command.toJSON());

async function registerCommands() {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (guildId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(commands);
      await clearGlobalCommands();
      console.log(`Registered ${commands.length} commands in guild ${guild.name}`);
      return;
    } catch (error) {
      console.warn(`Could not fetch DISCORD_GUILD_ID=${guildId}; falling back to bot guild list.`);
    }
  }

  const guildIds = new Set<string>(client.guilds.cache.map(guild => guild.id));
  try {
    const fetchedGuilds = await client.guilds.fetch();
    for (const guild of fetchedGuilds.values()) {
      guildIds.add(guild.id);
    }
  } catch (error) {
    console.warn('Could not fetch bot guild list from Discord.', error);
  }

  if (guildIds.size > 0) {
    for (const id of guildIds) {
      const guild = await client.guilds.fetch(id);
      await guild.commands.set(commands);
      console.log(`Registered ${commands.length} commands in guild ${guild.name} (${guild.id})`);
    }
    await clearGlobalCommands();
    return;
  }

  await client.application?.commands.set(commands);
  console.log(`Registered ${commands.length} global commands because no guilds were visible`);
}

async function clearGlobalCommands() {
  const globalCommands = await client.application?.commands.fetch();
  if (!globalCommands || globalCommands.size === 0) return;

  await client.application?.commands.set([]);
  console.log(`Cleared ${globalCommands.size} stale global commands`);
}

async function respondEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
  allowedMentions?: { parse?: []; roles?: string[] }
) {
  const payload = {
    content,
    allowedMentions,
    flags: MessageFlags.Ephemeral as const,
  };

  if (interaction.deferred) {
    await interaction.editReply({ content, allowedMentions });
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function handleFlexii(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({
      content: 'Tämä komento toimii vain palvelimen tekstikanavalla.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const botMember = interaction.guild?.members.me || await interaction.guild?.members.fetchMe();
  const channelPermissions = botMember?.permissionsIn(interaction.channelId);
  const missingPermissions = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  ].filter(([permission]) => !channelPermissions?.has(permission as bigint));

  if (missingPermissions.length > 0) {
    await interaction.editReply(`En pysty lähettämään flex-kyselyä tälle kanavalle. Lisää Jukka Jalonen -botille oikeudet: ${missingPermissions.map(([, name]) => name).join(', ')}.`);
    return;
  }

  const timeInput = interaction.options.getString('aika', true);
  const dayInput = interaction.options.getString('päivä', false);
  const durationMinutes = interaction.options.getInteger('kesto', false) ?? envNumber('DEFAULT_EVENT_DURATION_MINUTES', 180);

  let startsAt: Date;
  try {
    startsAt = parseFlexDateTime(dayInput, timeInput);
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : 'Ajan tulkinta epäonnistui.');
    return;
  }

  const eventId = crypto.randomUUID();
  const question = interaction.options.getString('viesti', false)
    || `Flexii ${formatFinnishQuestionTime(startsAt)}?`;

  const event: FlexEvent = {
    id: eventId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: '',
    creatorId: interaction.user.id,
    question,
    startsAt: startsAt.toISOString(),
    durationMinutes,
    responses: {},
    createdAt: new Date().toISOString(),
  };

  try {
    event.calendarEventId = await createCalendarEvent(event);
  } catch (error) {
    console.error('Calendar event creation failed:', error);
  }

  const roleId = store.getGuildConfig(interaction.guildId)?.flexRoleId || process.env.FLEX_ROLE_ID?.trim();
  const content = roleId ? `<@&${roleId}>` : '';
  const message = await (interaction.channel as TextChannel).send({
    content,
    embeds: [buildFlexEmbed(event)],
    components: buildFlexButtons(event.id),
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  });

  event.messageId = message.id;
  await store.setEvent(event);

  const calendarText = event.calendarEventId ? ' Kalenterimerkintä luotu.' : '';
  await interaction.editReply(`Flex-kysely luotu.${calendarText}`);
}

async function handleSetFlexRole(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Tämä komento toimii vain palvelimella.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role = interaction.options.getRole('role', true) as Role;
  await store.setGuildConfig({
    guildId: interaction.guildId,
    flexRoleId: role.id,
    updatedAt: new Date().toISOString(),
  });

  await interaction.editReply({
    content: `Flex-pingien rooli asetettu: <@&${role.id}>`,
    allowedMentions: { parse: [] },
  });
}

async function handleGetFlexRole(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: 'Tämä komento toimii vain palvelimella.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role = await resolveConfiguredFlexRole(interaction);
  if (!role) return;

  const canManage = await ensureBotCanManageRole(interaction, role);
  if (!canManage) return;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(role.id)) {
    await interaction.editReply({
      content: `Sinulla on jo flex-rooli: <@&${role.id}>`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await member.roles.add(role, 'User requested flex ping role');

  await interaction.editReply({
    content: `Lisäsin sinulle flex-roolin: <@&${role.id}>`,
    allowedMentions: { parse: [] },
  });
}

async function handleRemoveFlexRole(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: 'Tämä komento toimii vain palvelimella.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const role = await resolveConfiguredFlexRole(interaction);
  if (!role) return;

  const canManage = await ensureBotCanManageRole(interaction, role);
  if (!canManage) return;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.roles.cache.has(role.id)) {
    await interaction.editReply({
      content: `Sinulla ei ole flex-roolia: <@&${role.id}>`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await member.roles.remove(role, 'User removed flex ping role');

  await interaction.editReply({
    content: `Poistin sinulta flex-roolin: <@&${role.id}>`,
    allowedMentions: { parse: [] },
  });
}

async function handleCreateFlexRole(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Tämä komento toimii vain palvelimella.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString('nimi', false)?.trim() || process.env.FLEX_ROLE_NAME || 'Flexi';
  let role = interaction.guild.roles.cache.find(existing => existing.name.toLowerCase() === name.toLowerCase());

  if (!role) {
    role = await interaction.guild.roles.create({
      name,
      mentionable: true,
      reason: 'Jukka Jalonen flex ping role',
    });
  }

  await store.setGuildConfig({
    guildId: interaction.guild.id,
    flexRoleId: role.id,
    updatedAt: new Date().toISOString(),
  });

  await interaction.editReply(`Flex-rooli valmis ja asetettu: <@&${role.id}>`);
}

async function resolveConfiguredFlexRole(interaction: ChatInputCommandInteraction): Promise<Role | null> {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild) return null;

  const configuredRoleId = store.getGuildConfig(guildId)?.flexRoleId || process.env.FLEX_ROLE_ID?.trim();
  if (!configuredRoleId) {
    await respondEphemeral(interaction, 'Flex-pingien roolia ei ole vielä asetettu. Käytä `/flex-role` tai `/flex-role-create`.');
    return null;
  }

  const role = guild.roles.cache.get(configuredRoleId)
    || await guild.roles.fetch(configuredRoleId).catch(() => null);
  if (!role) {
    await respondEphemeral(interaction, `Asetettua flex-roolia ei löydy enää palvelimelta (${configuredRoleId}). Aseta rooli uudelleen komennolla \`/flex-role\`.`);
    return null;
  }

  return role;
}

async function ensureBotCanManageRole(interaction: ChatInputCommandInteraction, role: Role): Promise<boolean> {
  const botMember = interaction.guild?.members.me || await interaction.guild?.members.fetchMe();
  if (!botMember) {
    await respondEphemeral(interaction, 'En löytänyt omaa bot-käyttäjää palvelimelta.');
    return false;
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await respondEphemeral(interaction, 'En voi lisätä tai poistaa flex-roolia, koska botilta puuttuu Manage Roles -oikeus.');
    return false;
  }

  if (!roleIsManageableBy(botMember, role)) {
    await respondEphemeral(
      interaction,
      `En voi hallita roolia <@&${role.id}>. Siirrä Jukka Jalonen -botin rooli Discordin roolilistassa tämän roolin yläpuolelle.`,
      { parse: [] }
    );
    return false;
  }

  return true;
}

function roleIsManageableBy(member: GuildMember, role: Role): boolean {
  return !role.managed && member.roles.highest.comparePositionTo(role) > 0;
}

async function handleButton(customId: string, interaction: any) {
  const [, action, eventId] = customId.split(':');
  const event = store.getEvent(eventId);

  if (!event) {
    await interaction.reply({
      content: 'Tätä kyselyä ei löydy enää botin muistista.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'other') {
    const modal = new ModalBuilder()
      .setCustomId(`flex-modal:${eventId}`)
      .setTitle('Ehdota muuta aikaa')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(OTHER_TIME_INPUT)
            .setLabel('Mikä aika sopisi?')
            .setPlaceholder('Esim. 19:30 tai huomenna 18')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    return;
  }

  await recordResponse(event, interaction, action as FlexResponseStatus);
  await interaction.deferUpdate();
  await refreshFlexMessage(event);
}

async function handleModal(customId: string, interaction: any) {
  const [, eventId] = customId.split(':');
  const event = store.getEvent(eventId);

  if (!event) {
    await interaction.reply({
      content: 'Tätä kyselyä ei löydy enää botin muistista.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const otherTime = interaction.fields.getTextInputValue(OTHER_TIME_INPUT).trim();
  await recordResponse(event, interaction, 'other', otherTime);
  await interaction.deferUpdate();
  await refreshFlexMessage(event);
}

async function recordResponse(
  event: FlexEvent,
  interaction: { user: { id: string; username: string; globalName: string | null }; member?: any },
  status: FlexResponseStatus,
  otherTime?: string
) {
  const displayName = interaction.member?.displayName
    || interaction.user.globalName
    || interaction.user.username;

  event.responses[interaction.user.id] = {
    userId: interaction.user.id,
    displayName,
    status,
    otherTime,
    updatedAt: new Date().toISOString(),
  };

  await store.setEvent(event);
}

async function refreshFlexMessage(event: FlexEvent) {
  const channel = await client.channels.fetch(event.channelId);
  if (!channel?.isTextBased()) return;

  const message = await (channel as TextChannel).messages.fetch(event.messageId);
  await message.edit({
    embeds: [buildFlexEmbed(event)],
    components: buildFlexButtons(event.id),
  });
}

function buildFlexEmbed(event: FlexEvent): EmbedBuilder {
  const responses = Object.values(event.responses);
  const yes = responses.filter(response => response.status === 'yes');
  const no = responses.filter(response => response.status === 'no');
  const other = responses.filter(response => response.status === 'other');
  const startsAtUnix = Math.floor(new Date(event.startsAt).getTime() / 1000);

  return new EmbedBuilder()
    .setTitle(event.question)
    .setDescription(`Aika: <t:${startsAtUnix}:f>`)
    .addFields(
      {
        name: `Mukana (${yes.length})`,
        value: formatNames(yes.map(response => response.displayName)),
        inline: true,
      },
      {
        name: `Ei pääse (${no.length})`,
        value: formatNames(no.map(response => response.displayName)),
        inline: true,
      },
      {
        name: `Muu aika (${other.length})`,
        value: formatOtherTimes(other),
        inline: false,
      }
    )
    .setFooter({
      text: event.calendarEventId ? 'Google Calendar: luotu' : 'Google Calendar: ei käytössä',
    })
    .setColor(0x1f8b4c);
}

function buildFlexButtons(eventId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`flex:yes:${eventId}`)
        .setLabel('Mukana')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`flex:no:${eventId}`)
        .setLabel('Ei pääse')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`flex:other:${eventId}`)
        .setLabel('Muu aika')
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function formatNames(names: string[]): string {
  if (names.length === 0) return '-';
  return names.map(name => `• ${name}`).join('\n').slice(0, 1024);
}

function formatOtherTimes(responses: Array<{ displayName: string; otherTime?: string }>): string {
  if (responses.length === 0) return '-';
  return responses
    .map(response => `• ${response.displayName}: ${response.otherTime || 'muu aika'}`)
    .join('\n')
    .slice(0, 1024);
}

client.once(Events.ClientReady, async readyClient => {
  await store.load();
  await registerCommands();
  console.log(`Jukka Jalonen is ready as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case FLEXII_COMMAND:
          await handleFlexii(interaction);
          return;
        case FLEX_ROLE_COMMAND:
          await handleSetFlexRole(interaction);
          return;
        case FLEX_ROLE_GET_COMMAND:
          await handleGetFlexRole(interaction);
          return;
        case FLEX_ROLE_REMOVE_COMMAND:
          await handleRemoveFlexRole(interaction);
          return;
        case FLEX_ROLE_CREATE_COMMAND:
          await handleCreateFlexRole(interaction);
          return;
      }
    }

    if (interaction.isButton() && interaction.customId.startsWith('flex:')) {
      await handleButton(interaction.customId, interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('flex-modal:')) {
      await handleModal(interaction.customId, interaction);
    }
  } catch (error) {
    console.error('Interaction failed:', error);

    if (!interaction.isRepliable()) return;
    const payload = {
      content: 'Jukka kompastui komennon käsittelyssä. Katso botin lokit.',
      flags: MessageFlags.Ephemeral as const,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
});

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  client.destroy();
  process.exit(0);
});

client.login(requiredEnv('DISCORD_TOKEN'));
