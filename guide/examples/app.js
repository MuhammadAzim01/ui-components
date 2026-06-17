const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, id } = statedb(defaults)
const net = require('net_helper')

const status_button = require('status_button')

module.exports = app

async function app () {
  const { io, _ } = net(id)

  const on = {
    style: inject
  }

  const action_handlers = {
    status_clicked: handle_status_clicked
  }

  io.on = {
    status_button: io_status_button()
  }

  const subs = await sdb.watch(onbatch)
  const el = await status_button({ ...subs[0] }, io.invite('status_button', { up: id }))

  return el

  async function onbatch (batch) {
    const { drive } = sdb

    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const handler = on[type] || fail
      handler(data, type)
    }
  }

  function io_status_button () {
    return function status_button_protocol (msg) {
      const handler = action_handlers[msg.type] || fail
      handler(msg)
    }
  }

  function handle_status_clicked (msg) {
    _.status_button('set_label', { cause: msg.head }, { label: msg.data.active ? 'Active' : 'Ready' })
  }

  function inject (data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data.join('\n'))
    document.adoptedStyleSheets = [sheet]
  }

  function fail (data, type) {
    console.warn(__filename + ' invalid message', { cause: { data, type } })
  }
}

function defaults () {
  return {
    _: {
      status_button: {
        $: '',
        0: '',
        mapping: {
          style: 'style'
        }
      }
    },
    drive: {
      'style/': {
        'page.css': {
          raw: 'body { margin: 16px; }'
        }
      }
    }
  }
}
