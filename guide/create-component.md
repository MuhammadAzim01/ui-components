# Create A Component

Use this when creating a reusable component under `src/node_modules/*`.

Read [coding-standards.md](./coding-standards.md) first.

## Default pattern

Reusable components use instance-level STATE. The basic structure looks like:

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

  // ... setup DOM, protocols, watch drive state, return element ...
}
```

See a fully working component implementation in [examples/component.js](./examples/component.js).

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
