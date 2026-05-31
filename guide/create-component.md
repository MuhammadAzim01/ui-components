# Create A Component

Use this when creating a reusable component under `src/node_modules/*`.

Read [coding-standards.md](./coding-standards.md) first.

## Default pattern

Reusable components use instance-level STATE.

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(defaults)
const net = require('net_helper')

module.exports = component

async function component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const { io, _ } = net(id)

  const on = {
    style: inject
  }

  const on_message = {
    render: handle_render
  }

  io.on = {
    up: onmessage
  }
  if (invite) io.accept(invite)

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = '<button class="button"></button>'

  const button = shadow.querySelector('.button')
  button.onclick = onbutton_click

  await sdb.watch(onbatch)

  return el

  function onbutton_click () {
    if (_.up) _.up('button_clicked', {}, { value: true })
  }

  function handle_render (msg) {
    if (_.up) _.up('rendered', { cause: msg.head }, { ok: true })
  }

  function onmessage (msg) {
    const handler = on_message[msg.type] || onmessage_fail
    handler(msg)
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
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data.join('\n'))
    shadow.adoptedStyleSheets = [sheet]
  }

  function fail (data, type) {
    console.warn(__filename + ' invalid message', { cause: { data, type } })
  }
}
```

See the full example in [examples/component.js](./examples/component.js).

## Add datasets

Define persistent files in `defaults` or `api`.

```js
function defaults () {
  return {
    api,
    drive: {
      'style/': {
        'theme.css': {
          raw: '.button { display: inline-flex; }'
        }
      }
    }
  }

  function api () {
    return {
      drive: {
        'style/': {}
      }
    }
  }
}
```

Use [datashell/state.md](./datashell/state.md) for the full STATE rules.

## Add parent communication

Use `net_helper` when the component sends events to a parent or receives commands.

```js
function onbutton_click () {
  _.up('button_clicked', {}, { value: true })
}

function handle_render (msg) {
  _.up('rendered', { cause: msg.head }, { ok: true })
}
```

Use [datashell/protocol.md](./datashell/protocol.md) for parent/child wiring.
