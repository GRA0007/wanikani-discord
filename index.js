const puppeteer = require('puppeteer')
const { Client, Intents, MessageAttachment } = require('discord.js')
const Keyv = require('keyv')
const CronJob = require('cron').CronJob
const fetch = require('node-fetch')
const dayjs = require('Dayjs')
const { URL, URLSearchParams } = require('url')
const { token, hour } = require('./config.json')

// User data
/*{
  key: 'WK_API_TOKEN',
  channel: 'CHANNEL_ID',
  showStreak: true,
  streak: 0,
}*/

const db = new Keyv('sqlite://db.sqlite')

const client = new Client({ intents: [Intents.FLAGS.GUILDS] })

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
  return await res.json()
}

const renderCard = async (page, data) => {
  await page.evaluate((_, data) => {
    document.querySelector('.stats .level').innerHTML = `Level ${data.level}`
    document.querySelector('.stats .time').innerHTML = `for ${data.levelTime} days`
    document.querySelector('.stats .timeServed').innerHTML = `${data.totalTime} days served`

    document.querySelector('.status .lessons').innerHTML = data.completedLessons || ''
    document.querySelector('.status .reviews').innerHTML = data.completedReviews || ''

    document.querySelector('.progress').classList.toggle('hidden', !data.showStreak)
    document.querySelector('.progress .flame').classList.toggle('dead', data.streak === 0)
    document.querySelector('.progress .streak').innerHTML = data.streak || ''

    document.querySelector('.progress .lessons').innerHTML = data.upcomingLessons || ''
    document.querySelector('.progress .reviews').innerHTML = data.upcomingReviews || ''
  }, data)

  return await page.screenshot()
}

const sendUserCard = async (userid, channelid, body, data) => {
  const cardFile = new MessageAttachment(await renderCard(body, data), 'card.png', {
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
      url: 'attachment://card.png',
    },
    footer: {
      text: dayjs().format('D MMMM, YYYY'),
    },
  }
  await channel.send({ embeds: [embed], files: [cardFile] })
}

// Send all the registered cards
const sendCards = async () => {
  // Start the browser
  console.log(new Date().toLocaleString(), 'Sending out cards')
  const browser = await puppeteer.launch({'args': ['--no-sandbox', '--disable-setuid-sandbox']})
  page = await browser.newPage()
  await page.setViewport({ width: 450, height: 300, deviceScaleFactor: 2 })
  await page.goto(`file:///${__dirname}/card/index.html`)
  const body = await page.$('body')

  // Loop through users
  const last_date = dayjs().subtract(1, 'day')
  const users = await db.get('users') ?? []
  await Promise.allSettled(users.map(async userid => {
    const userData = await db.get(userid)
    if (!userData) return console.error(new Date().toLocaleString(), 'user data missing', userid)

    // Fetch data from the API
    const wkUser = await fetchWK('user', userData.key)
    if (wkUser.data.current_vacation_started_at !== null) return await db.set(userid, { ...userData, streak: 0 })
    const wkSummary = await fetchWK('summary', userData.key)
    const wkLevels = await fetchWK('level_progressions', userData.key)
    const wkAssignments = await fetchWK('assignments', userData.key, { updated_after: last_date.toISOString() })
    const wkReviews = await fetchWK('reviews', userData.key, { updated_after: last_date.toISOString() })
    const completedLessons = wkAssignments.data.filter(a => dayjs(a.data.started_at).isAfter(last_date)).length

    // Update streak
    let streak = userData.streak
    if (completedLessons > 0 || wkReviews.total_count > 0) {
      streak++
    } else {
      streak = 0
    }
    await db.set(userid, { ...userData, streak })

    await sendUserCard(userid, userData.channel, body, {
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
  }))

  // Close the browser
  await browser.close()
}

client.once('ready', async () => {
	console.log(new Date().toLocaleString(), `Logged in as ${client.user.tag}`)

  // Run every day
  new CronJob(`0 0 ${hour} * * *`, sendCards, null, true)
})

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return

  if (interaction.commandName === 'register') {
    const key = interaction.options.getString('api_token', true)
    const userData = await db.get(interaction.user.id) ?? { showStreak: true, streak: 0 } // defaults
    await db.set(interaction.user.id, {
      ...userData,
      key,
      channel: interaction.channelId,
    })
    const users = await db.get('users') ?? []
    await db.set('users', [...users.filter(u => u !== interaction.user.id), interaction.user.id])
    interaction.reply({
      content: 'Your API token has been saved. You will receive updates in this channel every day. Use `/unregister` to cancel your updates.',
      ephemeral: true,
    })
  } else if (interaction.commandName === 'unregister') {
    const user = interaction.options.getMember('user') || interaction.member
    if (user.id !== interaction.user.id && !interaction.memberPermissions.has('MANAGE_MESSAGES')) {
      interaction.reply({
        content: 'You need the _manage messages_ permission to unregister another user.',
        ephemeral: true,
      })
    } else {
      const users = await db.get('users')
      await db.set('users', users.filter(u => u !== user.id))
      interaction.reply({
        content: `Updates for ${user.displayName} have been cancelled.`,
        ephemeral: true,
      })
    }
  } else if (interaction.commandName === 'streak') {
    const showStreak = interaction.options.getBoolean('enabled', true)
    const users = await db.get('users')
    if (!users.includes(interaction.user.id)) {
      interaction.reply({
        content: 'You are not registered for updates. You can do so with `/register [api_token]`.',
        ephemeral: true,
      })
    } else {
      const userData = await db.get(interaction.user.id)
      await db.set(interaction.user.id, { ...userData, showStreak })
      interaction.reply({
        content: `Your streak has been ${showStreak ? 'enabled' : 'disabled'}.`,
        ephemeral: true,
      })
    }
  } else if (interaction.commandName === 'setstreak') {
    const streak = interaction.options.getInteger('value', true)
    const users = await db.get('users')
    if (!users.includes(interaction.user.id)) {
      interaction.reply({
        content: 'You are not registered for updates. You can do so with `/register [api_token]`.',
        ephemeral: true,
      })
    } else {
      const userData = await db.get(interaction.user.id)
      await db.set(interaction.user.id, { ...userData, streak })
      interaction.reply({
        content: `Your streak has been manually set to ${streak}.`,
        ephemeral: true,
      })
    }
  } else if (interaction.commandName === 'unregisterall') {
    if (!interaction.inGuild()) {
      interaction.reply({
        content: 'This command doesn\'t work in a direct message.',
        ephemeral: true,
      })
    } else if (!interaction.memberPermissions.has('MANAGE_MESSAGES')) {
      interaction.reply({
        content: 'You need the _manage messages_ permission to unregister another user.',
        ephemeral: true,
      })
    } else {
      await interaction.deferReply()
      const channels = await interaction.guild.channels.fetch()
      const channelIds = channels.map(c => c.id)
      const users = await db.get('users')
      let cancelled = []
      await Promise.allSettled(users.map(async userid => {
        const userData = await db.get(userid)
        if (channelIds.includes(userData.channel)) {
          cancelled = [...cancelled, userid]
        }
      }))
      await db.set('users', users.filter(u => !cancelled.includes(u)))
      interaction.reply(`All updates have been disabled in this server. (${cancelled.length} user${cancelled.length === 1 ? '' : 's'})`)
    }
  }
})

client.login(token).catch(() => {
  console.error(new Date().toLocaleString(), 'Failed to login, restarting')
  process.exit()
})
