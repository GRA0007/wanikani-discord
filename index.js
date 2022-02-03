const puppeteer = require('puppeteer')
const { Client, Intents, MessageAttachment } = require('discord.js')
const Keyv = require('keyv')
const CronJob = require('cron').CronJob
const fetch = require('node-fetch')
const dayjs = require('Dayjs')
const { URL, URLSearchParams } = require('url')
const { token, hour } = require('./config.json')


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
    if (wkUser.data.current_vacation_started_at !== null) return
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

client.login(token).catch(() => {
  console.error(new Date().toLocaleString(), 'Failed to login, restarting')
  process.exit()
})
