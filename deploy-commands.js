const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('newtask')
    .setDescription('Create a new task channel')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('Task name')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('userlimit')
        .setDescription('Maximum number of users')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('amount')
        .setDescription('Amount / reward')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('description')
        .setDescription('Work description')
        .setRequired(true)
    )
    // 👇 link stays optional and now is LAST
    .addStringOption(option =>
      option
        .setName('link')
        .setDescription('Task link (optional)')
        .setRequired(false)
    )
    .toJSON(),

  // /close
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close (lock) a task channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to close (defaults to current)')
        .setRequired(false)
    )
    .toJSON(),

  // /open
  new SlashCommandBuilder()
    .setName('open')
    .setDescription('Open (unlock) a task channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to open (defaults to current)')
        .setRequired(false)
    )
    .toJSON(),

  // /end
  new SlashCommandBuilder()
    .setName('end')
    .setDescription('End a task and move it to completed category')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to end (defaults to current)')
        .setRequired(false)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('🚀 Registering (deploying) slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Slash commands registered successfully!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();
