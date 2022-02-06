const { SlashCommandBuilder } = require('@discordjs/builders')
const { REST } = require('@discordjs/rest')
const { Routes } = require('discord-api-types/v9')
const { token, client_id } = require('./config.json')

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Start receiving updates in this channel')
    .addStringOption(option => option
      .setName('api_token')
      .setDescription('Your WaniKani API token (from your settings)')
      .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unregister')
    .setDescription('Stop receiving updates for this user in this channel')
    .addUserOption(option => option
      .setName('user')
      .setDescription('Optionally specify user (admin only)')
      .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('streak')
    .setDescription('Enable/disable displaying your streak')
    .addBooleanOption(option => option
      .setName('enabled')
      .setDescription('Whether to enable or disable your streak')
      .setRequired(true)
    ),
  
  new SlashCommandBuilder()
    .setName('setstreak')
    .setDescription('Manually set your WaniKani streak')
    .addIntegerOption(option => option
      .setName('value')
      .setDescription('Value to set your streak to (0 to reset)')
      .setRequired(true)
      .setMinValue(0)
    ),
  
  new SlashCommandBuilder()
    .setName('time')
    .setDescription('Choose when to send the daily updates in this channel')
    .addIntegerOption(option => option
      .setName('hour')
      .setDescription('Hour to send update (GMT)')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(23)
    ),

  new SlashCommandBuilder()
    .setName('theme')
    .setDescription('Set the theme to use in this channel')
    .addStringOption(option => option
      .setName('set')
      .setDescription('Light or dark')
      .setRequired(true)
      .addChoice('light', 'light')
      .addChoice('dark', 'dark')
    ),
  
  new SlashCommandBuilder()
    .setName('unregisterall')
    .setDescription('Cancel all updates in this channel (admin only), or unregister you from all servers (from DM)'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Read help text about this bot or a specific command')
    .addStringOption(option => option
      .setName('command')
      .setDescription('Info about a specific command')
      .setRequired(false)
      .addChoice('register', 'register')
      .addChoice('unregister', 'unregister')
      .addChoice('streak', 'streak')
      .addChoice('setstreak', 'setstreak')
      .addChoice('time', 'time')
      .addChoice('theme', 'theme')
      .addChoice('unregisterall', 'unregisterall')
    ),
    
].map(cmd => cmd.toJSON())

const rest = new REST({ version: '9' }).setToken(token)

if (process.argv[2]) {
  console.log('Deploying commands to the guild specified')
  rest.put(Routes.applicationGuildCommands(client_id, process.argv[2]), { body: commands })
    .then(() => console.log('Success'))
    .catch(console.error)
} else {
  console.log('Deploying commands globally')
  rest.put(Routes.applicationCommands(client_id), { body: commands })
    .then(() => console.log('Success, please wait 1 hour for commands to roll out'))
    .catch(console.error)
}