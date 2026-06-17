const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(defaults)
const net = require('net_helper')

const child_component = require('child_component')

module.exports = parent_component

async function parent_component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const { io, _ } = net(id)

  const on = {
    style: inject
  }

  const child_messages = {
    child_ready: handle_child_ready,
    child_changed: handle_child_changed
  }

  const parent_messages = {
    set_child: handle_set_child
  }

  io.on = {
    up: io_up(),
    child: io_child()
  }
  if (invite) io.accept(invite)

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = '<section class="parent"><child-placeholder></child-placeholder></section>'

  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]
  const placeholder = shadow.querySelector('child-placeholder')

  const subs = await sdb.watch(onbatch)
  const child = await child_component({ ...subs[0] }, io.invite('child', { up: id }))
  placeholder.replaceWith(child)

  return el

  function io_up () {
    return function onmessage (msg) {
      const handler = parent_messages[msg.type] || onmessage_fail
      handler(msg)
    }
  }

  function io_child () {
    return function child_protocol (msg) {
      const handler = child_messages[msg.type] || onmessage_fail
      handler(msg)
    }
  }

  function handle_child_ready (msg) {
    _.child('render', { cause: msg.head }, { status: 'ready' })
  }

  function handle_child_changed (msg) {
    if (_.up) _.up('child_changed', { cause: msg.head }, msg.data)
  }

  function handle_set_child (msg) {
    _.child('render', { cause: msg.head }, msg.data)
  }

  function onmessage_fail (msg) {
    fail(msg.data, msg.type)
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

  function fail (data, type) {
    console.warn(__filename + ' invalid message', { cause: { data, type } })
  }
}

function defaults () {
  return {
    api,
    _: {
      child_component: {
        $: ''
      }
    }
  }

  function api () {
    return {
      _: {
        child_component: {
          0: '',
          mapping: {
            style: 'child_style'
          }
        }
      },
      drive: {
        'style/': {
          'parent.css': {
            raw: '.parent { display: grid; gap: 8px; }'
          }
        },
        'child_style/': {}
      }
    }
  }
}
