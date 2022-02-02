const puppeteer = require('puppeteer')
const { Client, Intents, MessageAttachment } = require('discord.js')
const Dayjs = require('Dayjs')
const { token } = require('./config.json')

const client = new Client({ intents: [Intents.FLAGS.GUILDS] })

const renderCard = async page => {
  await page.evaluate(() => {
    document.querySelector('.stats .level').innerHTML = `Level ${7}`
    document.querySelector('.stats .time').innerHTML = `for ${17} days`
    document.querySelector('.stats .timeServed').innerHTML = `${1625} days served`

    document.querySelector('.status .lessons').innerHTML = 20
    document.querySelector('.status .reviews').innerHTML = 51

    document.querySelector('.progress').classList.toggle('hidden', true)
    document.querySelector('.progress .flame').classList.toggle('dead', false)
    document.querySelector('.progress .streak').innerHTML = 107

    document.querySelector('.progress .lessons').innerHTML = 108
    document.querySelector('.progress .reviews').innerHTML = 29
  })
  return await page.screenshot()
}

client.once('ready', async () => {
	console.log(`Logged in as ${client.user.tag}`)

  // Start the browser
  console.log('starting the browser')
  const browser = await puppeteer.launch({'args': ['--no-sandbox', '--disable-setuid-sandbox']})
  page = await browser.newPage()
  await page.setViewport({ width: 450, height: 300, deviceScaleFactor: 2 })
  console.log('loading the page')
  await page.goto(`file:///${__dirname}/card/index.html`)
  const body = await page.$('body')

  // Test
  console.log('sending the embed')
  const cardFile = new MessageAttachment(await renderCard(body), 'card.png', {
    description: `Level ${7}, ${68} day streak`
  })
  const channel = await client.channels.fetch('352449754573045763')
  const embed = {
    color: 0x1C46F5,
    author: {
      name: 'Benpai',
      icon_url: 'https://images-ext-1.discordapp.net/external/YS_6jpsQcFrQkSyk-GIDe_jtHI1gZ_LjNtLUQhe87B0/https/cdn.discordapp.com/avatars/183911061496266752/dd3ac4c2d47c0d364faa6e1def91dabe.webp',
    },
    image: {
      url: 'attachment://card.png',
    },
    footer: {
      text: Dayjs().format('D MMMM, YYYY'),
    },
  }
  await channel.send({ embeds: [embed], files: [cardFile] })
  process.exit()
})

client.login(token)