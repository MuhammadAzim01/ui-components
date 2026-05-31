# Cheat Sheet

Use this when you need the shortest working overview of this repository's component style.

## Component shape

Reusable components live under `src/node_modules/*`.

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(defaults)

module.exports = component

async function component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = '<div class="component"></div>'

  await sdb.watch(onbatch)

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      console.log(type, data)
    }
  }
}
```

## Defaults and api

Use `defaults` for module defaults.

Use nested `api` for instance customization.

```js
function defaults () {
  return {
    api,
    drive: {
      'style/': {
        'theme.css': {
          raw: '.component { display: flex; }'
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

Older source files may call these functions `fallback_module` and `fallback_instance`.

## Datasets

Datasets use folder names with trailing slashes.

```js
drive: {
  'icons/': {
    'close.svg': {
      $ref: 'close.svg'
    }
  }
}
```

Use `$ref` for CSS, SVG, or larger assets near the module file.

## Messaging

Use `net_helper` when a component talks to a parent or child.

```js
const net = require('net_helper')
const { io, _ } = net(id)

io.on = {
  up: onmessage
}
if (invite) io.accept(invite)

button.onclick = onbutton_click

function onbutton_click () {
  _.up('button_clicked', {}, { value: true })
}
```

Channel helpers use this signature:

```js
_.channel(type, refs, data)
```

Use `{}` for root or UI events.

Use `{ cause: msg.head }` when a message is caused by another message.

## Read next

- Strict rules: [coding-standards.md](./coding-standards.md)
- Create a component: [create-component.md](./create-component.md)
- STATE and datasets: [datashell/state.md](./datashell/state.md)
- Protocol: [datashell/protocol.md](./datashell/protocol.md)

