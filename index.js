const puppeteer = require('puppeteer')
const { Client, Intents, MessageAttachment } = require('discord.js')
const Keyv = require('keyv')
const CronJob = require('cron').CronJob
const fetch = require('node-fetch')
const AsyncLock = require('async-lock')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
dayjs.extend(utc)
const { URL, URLSearchParams } = require('url')
const { token, chromium_path } = require('./config.json')

// User data
/*{
  key: 'WK_API_TOKEN',
  showStreak: true,
  streak: 0,
}*/

// Channel data
/*{
  theme: 'light',
  users: [id, id, ...],
  hour: 0,
}*/

const helpText = {
  default: {
    title: 'WaniKani Daily',
    url: 'https://github.com/GRA0007/wanikani-discord',
    description: 'Get daily updates in your Discord server with your WaniKani progress! This bot also tracks your streak (days with at least 1 lesson or review).\n\n[Add to your server](<https://discord.com/api/oauth2/authorize?client_id=938595177424105534&permissions=277025705024&scope=bot%20applications.commands>)',
    author: {
      name: 'Created by Benpai#1138',
      icon_url: 'https://cdn.discordapp.com/avatars/183911061496266752/dd3ac4c2d47c0d364faa6e1def91dabe.webp',
      url: 'https://bengrant.dev',
    },
    fields: [
      {
        name: 'Bug reports',
        value: 'To report bugs, contact Benpai#1138 or visit the [forum post](<https://community.wanikani.com/t/a-wanikani-daily-discord-bot/55682>).',
      },
    ],
  },
  register: {
    title: '`/register <api_token>`',
    description: 'Register a new user to receive daily updates in the current channel. Requires a WaniKani v2 API token. The token can be omitted if you are already registered in another channel.',
  },
  unregister: {
    title: '`/unregister <@user>`',
    description: 'Unregister yourself (or another user) from updates. If unregistering another user, you must have the _manage messages_ permission.',
  },
  streak: {
    title: '`/streak [enabled/disabled]`',
    description: 'Enable or disable showing a streak on your daily card.',
  },
  setstreak: {
    title: '`/setstreak [number]`',
    description: 'Manually set your streak to a number. Useful if you have already been using WaniKani for a while, or if you want to reset it to 0.',
  },
  time: {
    title: '`/time [hour]`',
    description: 'Set the hour of each day when all updates in the current channel will be sent. Use GMT time (0 to 23).',
  },
  theme: {
    title: '`/theme [light/dark]`',
    description: 'Set the theme to use in the current channel. Will affect all updates in this channel.',
  },
  unregisterall: {
    title: '`/unregisterall`',
    description: 'If run from a server, removes all registrations in that server. Can only be used if you have the _manage messages_ permission.\n\nIf run from a DM, removes all registrations in all servers for the current user.',
  },
}

const emojis = {
  streak: '<:streak:940046252236738620>',
}

// Database
const users = new Keyv('sqlite://db.sqlite', { namespace: 'users' })
const channels = new Keyv('sqlite://db.sqlite', { namespace: 'channels' })

const client = new Client({ intents: [Intents.FLAGS.GUILDS] })
const lock = new AsyncLock()

// Fetch data from the WaniKani API
const fetchWK = async (resource, key, params) => {
  const url = new URL(`https://api.wanikani.com/v2/${resource}`)
  if (params) {
    url.search = new URLSearchParams(params).toString()
  }

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${key}`,
    },
  })
  
  if (res.status !== 200) throw res
  return await res.json()
}

// Render a card
const renderCard = async (page, data) => {
  await page.evaluate((_, data) => {
    // Theme
    document.body.classList.toggle('dark', data.theme === 'dark')

    // Level and time served
    document.querySelector('.stats .level').innerHTML = `Level ${data.level}`
    document.querySelector('.stats .time').innerHTML = `for ${data.levelTime} days`
    document.querySelector('.stats .timeServed').innerHTML = `${data.totalTime} days served`

    // Completed lessons and reviews
    document.querySelector('.status .lessons').innerHTML = data.completedLessons || ''
    document.querySelector('.status .reviews').innerHTML = data.completedReviews || ''

    // Streak
    document.querySelector('.progress').classList.toggle('hidden', !data.showStreak)
    document.querySelector('.progress .flame').classList.toggle('dead', data.streak === 0)
    document.querySelector('.progress .streak').innerHTML = data.streak || ''

    // Upcoming lessons and reviews
    document.querySelector('.progress .lessons').innerHTML = data.upcomingLessons || ''
    document.querySelector('.progress .reviews').innerHTML = data.upcomingReviews || ''
  }, data)

  return await page.screenshot()
}

// Compose the embed and send the user card
const sendUserCard = async (userid, channelid, body, data) => {
  const renderedCard = await lock.acquire('browser', async () => await renderCard(body, data))
  const cardFile = new MessageAttachment(renderedCard, 'wk_daily.png', {
    description: `Level ${data.level}, ${data.streak} day streak`
  })
  const user = await client.users.fetch(userid)
  const channel = await client.channels.fetch(channelid)
  const embed = {
    color: data.streak > 0 ? 0x1C46F5 : 0xE74B3C,
    author: {
      name: user.username,
      icon_url: user.displayAvatarURL(),
    },
    image: {
      url: 'attachment://wk_daily.png',
    },
  }
  await channel.send({ embeds: [embed], files: [cardFile] })
}

// Send all the registered cards
const sendCards = async () => {
  // Find all users that are ready to send
  const currentHour = dayjs().utc().hour()
  const allChannels = await channels.get('channels') ?? []
  const fetchedChannels = await Promise.allSettled(allChannels.map(async channelId => {
    const channelData = await channels.get(channelId)
    return { ...channelData, id: channelId }
  }))
  const selectedChannels = fetchedChannels.filter(p => p.status === 'fulfilled').map(p => p.value).filter(c => c.hour === currentHour && c.users.length > 0)

  if (selectedChannels.length === 0) return // No channels registered for this hour

  // Start the browser
  console.log(new Date().toLocaleString(), `Sending out cards to ${selectedChannels.length} channels`)
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...chromium_path && { executablePath: chromium_path }, // Allow specifying an external executable to use
  })
  page = await browser.newPage()
  await page.setViewport({ width: 450, height: 300, deviceScaleFactor: 2 })
  await page.goto(`file:///${__dirname}/card/index.html`)
  const body = await page.$('body')

  // Loop through channels
  const last_date = dayjs().subtract(1, 'day')
  await Promise.allSettled(selectedChannels.map(async channel => {
    // Loop through users in channel
    await Promise.allSettled(channel.users.map(async userid => {
      const userData = await users.get(userid)
      if (!userData) return console.error(new Date().toLocaleString(), 'User data missing:', userid)

      // Fetch data from the API
      try {
        const wkUser = await fetchWK('user', userData.key)
        if (wkUser.data.current_vacation_started_at !== null) return await users.set(userid, { ...userData, streak: 0 })
        const wkSummary = await fetchWK('summary', userData.key)
        const wkLevels = await fetchWK('level_progressions', userData.key)
        const wkAssignments = await fetchWK('assignments', userData.key, { updated_after: last_date.toISOString() })
        const wkReviews = await fetchWK('reviews', userData.key, { updated_after: last_date.toISOString() })
        const completedLessons = wkAssignments.data.filter(a => dayjs(a.data.started_at).isAfter(last_date)).length

        // Update streak
        let streak = userData.streak
        if (completedLessons > 0 || wkReviews.total_count > 0) {
          streak++
        } else if (wkSummary.data.reviews[0].subject_ids.length !== 0) {
          streak = 0
        }
        await users.set(userid, { ...userData, streak })

        await sendUserCard(userid, channel.id, body, {
          theme: channel.theme,
          level: wkUser.data.level,
          levelTime: dayjs().diff(dayjs(wkLevels.data.at(-1).data.unlocked_at), 'days'),
          totalTime: dayjs().diff(dayjs(wkUser.data.started_at), 'days'),
          completedLessons,
          completedReviews: wkReviews.total_count,
          showStreak: userData.showStreak,
          streak,
          upcomingLessons: wkSummary.data.lessons[0].subject_ids.length,
          upcomingReviews: wkSummary.data.reviews[0].subject_ids.length,
        })
      } catch (e) {
        console.error(new Date().toLocaleString(), 'WaniKani API error', e)
      }
    }))
  }))

  // Close the browser
  await browser.close()
}

client.once('ready', async () => {
	console.log(new Date().toLocaleString(), `Logged in as ${client.user.tag} to ${client.guilds.cache.size} servers`)

  // Run every hour
  new CronJob(`0 0 * * * *`, sendCards, null, true)
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return

  if (interaction.commandName === 'register') {
    const key = interaction.options.getString('api_token')
    await interaction.deferReply({ ephemeral: interaction.inGuild() })
    try {
      const userData = await users.get(interaction.user.id) ?? { showStreak: true, streak: 0 } // defaults
      if (!key && !userData.key) {
        return interaction.editReply({
          content: 'Your account is not linked with a WaniKani API token yet. Please run `/register [api_token]` with your WaniKani V2 API token.',
          ephemeral: interaction.inGuild(),
        })
      }
      const wkUser = await fetchWK('user', key ?? userData.key)
      if (key) {
        await users.set(interaction.user.id, { ...userData, key })
      }
      const channel = await channels.get(interaction.channelId) ?? { theme: 'light', hour: 0, users: [] } // defaults
      await channels.set(interaction.channelId, { ...channel, users: [...channel.users.filter(u => u !== interaction.user.id), interaction.user.id] })
      const channelList = await channels.get('channels') ?? []
      await channels.set('channels', [...channelList.filter(c => c !== interaction.channelId), interaction.channelId])
      interaction.editReply({
        content: `✅ Your API token for the WaniKani account [${wkUser.data.username}](<${wkUser.data.profile_url}>) has been saved. Updates will be sent in this channel every day at <t:${dayjs().add(1, 'day').utc().hour(channel.hour).minute(0).unix()}:t>.\nUse \`/time\` to change when your updates are sent for everyone in this channel.\nUse \`/unregister\` to cancel your updates.`,
        ephemeral: interaction.inGuild(),
      })
    } catch (e) {
      if (e.status === 401) {
        interaction.editReply({
          content: `The API token you entered isn't valid. Please make sure you copied it without any extra characters or spaces.`,
          ephemeral: interaction.inGuild(),
        })
      } else {
        interaction.editReply({
          content: `The WaniKani API is currently not responding, please try again later.`,
          ephemeral: interaction.inGuild(),
        })
      }
    }
  } else if (interaction.commandName === 'unregister') {
    const user = interaction.options.getMember('user') || interaction.member
    if (user.id !== interaction.user.id && !interaction.memberPermissions.has('MANAGE_MESSAGES')) {
      interaction.reply({
        content: 'You need the _manage messages_ permission to unregister another user.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      const channel = await channels.get(interaction.channelId)
      if (!channel || !channel.users.includes(interaction.user.id)) {
        return interaction.reply({
          content: 'This user is not registered in this channel. Run this command from the channel that the user registered in.',
          ephemeral: interaction.inGuild(),
        })
      }
      await channels.set(interaction.channelId, { ...channel, users: channel.users.filter(u => u !== user.id) })
      interaction.reply({
        content: `Updates for ${user.displayName} have been cancelled in this channel.`,
        ephemeral: interaction.inGuild(),
      })
    }
  } else if (interaction.commandName === 'streak') {
    const showStreak = interaction.options.getBoolean('enabled', true)
    const userData = await users.get(interaction.user.id)
    if (!userData) {
      interaction.reply({
        content: 'You are not registered for updates. You can do so with `/register [api_token]`.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      await users.set(interaction.user.id, { ...userData, showStreak })
      interaction.reply({
        content: `Your streak has been ${showStreak ? 'enabled' : 'disabled'} in all channels.`,
        ephemeral: interaction.inGuild(),
      })
    }
  } else if (interaction.commandName === 'setstreak') {
    const streak = interaction.options.getInteger('value', true)
    const userData = await users.get(interaction.user.id)
    if (!userData) {
      interaction.reply({
        content: 'You are not registered for updates. You can do so with `/register [api_token]`.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      await users.set(interaction.user.id, { ...userData, streak })
      interaction.reply({
        content: `Your streak has been manually set to ${streak}.`,
        ephemeral: interaction.inGuild(),
      })
    }
  } else if (interaction.commandName === 'time') {
    const hour = interaction.options.getInteger('hour', true)
    const channelData = await channels.get(interaction.channelId)
    if (!channelData) {
      interaction.reply({
        content: 'This channel has no registered updates.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      await channels.set(interaction.channelId, { ...channelData, hour })
      interaction.reply(`Daily updates in this channel will now be sent at <t:${dayjs().add(1, 'day').utc().hour(hour).minute(0).unix()}:t>.`)
    }
  } else if (interaction.commandName === 'theme') {
    const theme = interaction.options.getString('set', true)
    const channelData = await channels.get(interaction.channelId)
    if (!channelData) {
      interaction.reply({
        content: 'This channel has no registered updates.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      await channels.set(interaction.channelId, { ...channelData, theme })
      interaction.reply(`The channel theme has been set to ${theme}.`)
    }
  } else if (interaction.commandName === 'unregisterall') {
    if (!interaction.inGuild()) {
      await interaction.deferReply()
      const allChannels = await channels.get('channels') ?? []
      let total = 0
      await Promise.allSettled(allChannels.forEach(async channelId => {
        const channelData = await channels.get(channelId)
        if (channelData.users.includes(interaction.user.id)) {
          total++
          await channels.set(channelId, { ...channelData, users: channelData.users.filter(u => u !== interaction.user.id) })
        }
      }))
      interaction.editReply(`Unregistered you from ${total} channel${total === 1 ? '' : 's'}`)
    } else if (!interaction.memberPermissions.has('MANAGE_MESSAGES')) {
      interaction.reply({
        content: 'You need the _manage messages_ permission to unregister another user.',
        ephemeral: interaction.inGuild(),
      })
    } else {
      // Unregister all channels in the current server
      const guildChannels = await interaction.guild.channels.fetch()
      const channelIds = guildChannels.map(c => c.id)
      const registeredChannels = await channels.get('channels') ?? []
      const updatedChannels = registeredChannels.filter(c => !channelIds.includes(c))
      await channels.set('channels', updatedChannels)
      const count = registeredChannels.length - updatedChannels.length
      interaction.reply(`All updates have been disabled in this server. (${count} channel${count === 1 ? '' : 's'} disabled)`)
    }
  } else if (interaction.commandName === 'help') {
    const command = interaction.options.getString('command')
    interaction.reply({
      embeds: [{
        color: 0x1C46F5,
        ...helpText[command ?? 'default'],
      }],
      ephemeral: interaction.inGuild(),
    })
  }
})

client.login(token).catch(() => {
  console.error(new Date().toLocaleString(), 'Failed to login, restarting')
  process.exit()
})
