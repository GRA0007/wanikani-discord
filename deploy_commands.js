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
      .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('unregister')
    .setDescription('Stop receiving updates for this user')
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
    .setName('unregisterall')
    .setDescription('Cancel all updates in this server (admin only)'),
    
].map(cmd => cmd.toJSON())

const rest = new REST({ version: '9' }).setToken(token)

rest.put(Routes.applicationGuildCommands(client_id, '332158176650854401'), { body: commands })
	.then(() => console.log('Successfully registered application commands'))
	.catch(console.error)