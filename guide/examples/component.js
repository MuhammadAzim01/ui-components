const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(defaults)
const net = require('net_helper')

module.exports = status_button

async function status_button (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const { io, _ } = net(id)

  const on = {
    style: inject,
    label: onlabel
  }

  const on_message = {
    set_label: handle_set_label
  }

  io.on = {
    up: onmessage
  }
  if (invite) io.accept(invite)

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = '<button class="status-button"></button>'

  const button = shadow.querySelector('.status-button')
  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]
  button.onclick = onbutton_click

  await sdb.watch(onbatch)

  return el

  function onbutton_click () {
    if (_.up) _.up('status_clicked', {}, { active: button.classList.toggle('active') })
  }

  function onmessage (msg) {
    const handler = on_message[msg.type] || onmessage_fail
    handler(msg)
  }

  function onmessage_fail (msg) {
    fail(msg.data, msg.type)
  }

  function handle_set_label (msg) {
    button.textContent = msg.data.label
    if (_.up) _.up('label_updated', { cause: msg.head }, { label: msg.data.label })
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const handler = on[type] || fail
      handler(data, type)
    }
  }

  function inject (data) {
    sheet.replaceSync(data.join('\n'))
  }

  function onlabel (data) {
    button.textContent = data[0]
  }

  function fail (data, type) {
    console.warn(__filename + ' invalid message', { cause: { data, type } })
  }
}
function defaults () {
  return {
    api,
    drive: {
      'style/': {
        'theme.css': {
          raw: `
            .status-button {
              border: 1px solid #999;
              padding: 6px 10px;
            }
          `
        }
      }
    }
  }

  function api () {
    return {
      drive: {
        'label/': {
          'text.txt': {
            raw: 'Ready'
          }
        },
        'style/': {}
      }
    }
  }
}
