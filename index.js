const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');

require('dotenv').config();

/* -------------------- DISCORD CLIENT -------------------- */

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

/* -------------------- IN-MEMORY TASK STORE -------------------- */

const tasks = new Map();

const CONFIG = {
  taskCategoryId: process.env.TASK_CATEGORY_ID,
  completedCategoryId: process.env.COMPLETED_CATEGORY_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  tryoutRoleId: process.env.TRYOUT_ROLE_ID || null,
};

/* -------------------- HELPERS -------------------- */

function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (CONFIG.adminRoleId && member.roles.cache.has(CONFIG.adminRoleId)) return true;
  return false;
}

/* -------------------- BOT READY -------------------- */

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  client.user.setStatus('online');
  client.user.setActivity('Deleting Deadlines', { type: 3 });
});

/* -------------------- AUTO APPROVE SCREENSHOTS -------------------- */

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const taskData = tasks.get(message.channel.id);
  if (!taskData) return;

  const hasImage = message.attachments.some((att) => {
    if (att.contentType?.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp)$/i.test(att.name || '');
  });

  if (!hasImage) return;

  try {
    const member = await message.guild.members.fetch(message.author.id);
    const role = message.guild.roles.cache.get(taskData.roleId);
    if (!role) return;

    if (member.roles.cache.has(role.id)) return;

    await member.roles.add(role);
    taskData.approvedCount += 1;

    await message.react('✅');

    if (taskData.approvedCount >= taskData.userLimit) {
      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { SendMessages: false }
      );

      await message.channel.send(
        `🚫 User limit reached (**${taskData.userLimit}**). Channel locked.`
      );
    }
  } catch (err) {
    console.error('❌ Auto-approve error:', err);
  }
});

/* -------------------- SLASH COMMANDS -------------------- */

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const guild = interaction.guild;
  const member = interaction.member;

  /* -------- NEW TASK -------- */

  if (commandName === 'newtask') {
    if (!isAdmin(member)) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }

    const taskName = interaction.options.getString('name', true);
    const userLimit = interaction.options.getInteger('userlimit', true);
    const amount = interaction.options.getString('amount', true);
    const link = interaction.options.getString('link') || 'N/A';
    const description = interaction.options.getString('description', true);

    if (userLimit <= 0) {
      return interaction.reply({
        content: '❌ userlimit must be positive.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const taskChannels = guild.channels.cache.filter(
        (ch) => ch.type === ChannelType.GuildText && /^task-\d+$/.test(ch.name)
      );

      let nextIndex = 1;
      if (taskChannels.size) {
        const nums = taskChannels.map((c) => Number(c.name.split('-')[1]));
        nextIndex = Math.max(...nums) + 1;
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

      const msg = await taskChannel.send({
        content: `${tryoutMention}

📌 **New Task Created**

\`\`\`
Task Name   : ${taskName}
Channel     : ${taskChannel.name}
User Limit  : ${userLimit}
Amount      : ${amount}
Description : ${description}
\`\`\`

🔗 Task Link: ${link}

📸 Upload screenshot here.
Auto-approved ✅ until limit is reached.`,
      });

      await msg.pin();

      await interaction.editReply(
        `✅ Task **${taskName}** created in ${taskChannel}.`
      );
    } catch (err) {
      console.error('❌ /newtask error:', err);
      await interaction.editReply('❌ Failed to create task.');
    }
  }

  /* -------- CLOSE -------- */

  if (commandName === 'close') {
    if (!isAdmin(member)) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      { SendMessages: false }
    );

    await interaction.reply(`🔒 ${channel} closed.`);
  }

  /* -------- OPEN -------- */

  if (commandName === 'open') {
    if (!isAdmin(member)) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      { SendMessages: true }
    );

    await interaction.reply(`🔓 ${channel} opened.`);
  }

  /* -------- END -------- */

  if (commandName === 'end') {
    if (!isAdmin(member)) {
      return interaction.reply({ content: '❌ No permission.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    await channel.setParent(CONFIG.completedCategoryId);

    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      { SendMessages: false }
    );

    await interaction.reply(`✅ ${channel} moved to COMPLETED.`);
  }
});

/* -------------------- HTTP SERVER (RENDER FIX) -------------------- */

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TaskBot is running.\n');
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
  });

/* -------------------- LOGIN -------------------- */

client.login(process.env.BOT_TOKEN);
