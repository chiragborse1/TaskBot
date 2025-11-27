const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const tasks = new Map();

const CONFIG = {
  taskCategoryId: process.env.TASK_CATEGORY_ID,
  completedCategoryId: process.env.COMPLETED_CATEGORY_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  tryoutRoleId: process.env.TRYOUT_ROLE_ID || null,
};

function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (CONFIG.adminRoleId && member.roles.cache.has(CONFIG.adminRoleId)) return true;
  return false;
}

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  client.user.setStatus('online');

  client.user.setActivity('Deleting Deadlines', {
    type: 3,
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const guild = message.guild;
  if (!guild) return;

  const taskData = tasks.get(message.channel.id);
  if (!taskData) return;

  const hasImage = message.attachments.some((att) => {
    if (att.contentType && att.contentType.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp)$/i.test(att.name || '');
  });

  if (!hasImage) return;

  try {
    const member = await guild.members.fetch(message.author.id);
    const role = guild.roles.cache.get(taskData.roleId);
    if (!role) return;

    if (member.roles.cache.has(role.id)) return;

    await member.roles.add(role);

    taskData.approvedCount += 1;

    await message.react('✅');

    if (taskData.approvedCount >= taskData.userLimit) {
      await message.channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false,
      });

      await message.channel.send(
        `🚫 User limit reached (**${taskData.userLimit}**). Channel has been locked.`
      );
    }
  } catch (err) {
    console.error('Error auto-approving screenshot:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'newtask') {
    const member = interaction.member;
    const guild = interaction.guild;

    if (!isAdmin(member)) {
      return interaction.reply({
        content: '❌ You do not have permission to use this command.',
        flags: 64,
      });
    }

    const taskName = interaction.options.getString('name', true);
    const userLimit = interaction.options.getInteger('userlimit', true);
    const amount = interaction.options.getString('amount', true);
    const link = interaction.options.getString('link') || 'N/A';
    const description = interaction.options.getString('description', true);

    if (userLimit <= 0) {
      return interaction.reply({
        content: '❌ `userlimit` must be a positive number.',
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });
    try {
      const taskChannels = guild.channels.cache.filter(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          /^task-\d+$/.test(ch.name)
      );

      let nextIndex = 1;

      if (taskChannels.size > 0) {
        const numbers = [];

        taskChannels.forEach((ch) => {
          const match = ch.name.match(/^task-(\d+)$/);
          if (match) {
            const n = parseInt(match[1], 10);
            if (!isNaN(n)) numbers.push(n);
          }
        });

        if (numbers.length > 0) {
          nextIndex = Math.max(...numbers) + 1;
        }
      }

      const channelName = `task-${nextIndex}`;

      const taskRole = await guild.roles.create({
        name: channelName,
        reason: `Role for ${channelName}`,
      });

      const taskChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: CONFIG.taskCategoryId,
        reason: `Task channel for ${taskName}`,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
        ],
      });

      tasks.set(taskChannel.id, {
        taskName,
        userLimit,
        amount,
        link,
        description,
        approvedCount: 0,
        roleId: taskRole.id,
      });

      const tryoutMention = CONFIG.tryoutRoleId
        ? `<@&${CONFIG.tryoutRoleId}>`
        : '';

      const taskMessage = await taskChannel.send({
        content: 
`${tryoutMention}

📌 **New Task Created**

\`\`\`
━━━━━━━━━━━━━━━━━━━━
  TASK INFORMATION
━━━━━━━━━━━━━━━━━━━━

Task Name   : ${taskName}
Channel     : ${taskChannel.name}
User Limit  : ${userLimit}
Amount      : ${amount}
Description : ${description}

━━━━━━━━━━━━━━━━━━━━
\`\`\`

🔗 **Task Link:** ${link}

📸 Upload your screenshot in this channel.
The bot will auto-approve ✅ and lock the channel when the limit is reached.
`
      });

      await taskMessage.pin();

      await interaction.editReply({
        content: `✅ Task **${taskName}** created in ${taskChannel}.`,
      });
    } catch (err) {
      console.error('Error in /newtask:', err);
      await interaction.editReply(
        '❌ Something went wrong creating the task. Check bot permissions.'
      );
    }
  }

  function getTargetChannel(interaction, optionName) {
    return interaction.options.getChannel(optionName) || interaction.channel;
  }

  if (commandName === 'close') {
    const member = interaction.member;
    const guild = interaction.guild;

    if (!isAdmin(member)) {
      return interaction.reply({
        content: '❌ No permission.',
        flags: 64,
      });
    }

    const channel = getTargetChannel(interaction, 'channel');

    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false,
    });

    await interaction.reply(`🔒 ${channel} closed.`);
  }

  if (commandName === 'open') {
    const member = interaction.member;
    const guild = interaction.guild;

    if (!isAdmin(member)) {
      return interaction.reply({
        content: '❌ No permission.',
        flags: 64,
      });
    }

    const channel = getTargetChannel(interaction, 'channel');

    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: true,
    });

    await interaction.reply(`🔓 ${channel} reopened.`);
  }

  if (commandName === 'end') {
    const member = interaction.member;
    const guild = interaction.guild;

    if (!isAdmin(member)) {
      return interaction.reply({
        content: '❌ No permission.',
        flags: 64,
      });
    }

    const channel = getTargetChannel(interaction, 'channel');

    await channel.setParent(CONFIG.completedCategoryId);

    await channel.permissionOverrites?.edit?.(guild.roles.everyone, {
      SendMessages: false,
    });

    await interaction.reply(
      `✅ ${channel} moved to COMPLETED and locked.`
    );
  }
});
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TaskBot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
  });

client.login(process.env.BOT_TOKEN);