# Demo Pages

Use this when creating a browser preview page.

Create two modules:

- `web/page.js`: minimal browser entry that configures the document and renders the app.
- `src/app.js`: app setup module that creates the UI and wires components.

`app.js` may also live under `src/node_modules` when you want to package the app like the other local modules.

## page.js

Keep `page.js` small. It should not contain component setup, STATE defaults, dataset mappings, or protocol wiring.

```js
const app = require('../src/app')
config().then(boot_default_page)

async function config () {
  const html = document.documentElement
  const meta = document.createElement('meta')
  const font = 'https://fonts.googleapis.com/css?family=Nunito:300,400,700,900|Slackey&display=swap'
  const loadFont = `<link href=${font} rel='stylesheet' type='text/css'>`

  html.setAttribute('lang', 'en')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', 'width=device-width,initial-scale=1.0')
  document.head.append(meta)
  document.head.insertAdjacentHTML('beforeend', loadFont)

  await document.fonts.ready
}

async function boot_default_page () {
  document.body.append(await app())
}
```

See [examples/page.js](./examples/page.js).

## app.js

Use `app.js` for the actual app setup.

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, id } = statedb(defaults)
const net = require('net_helper')

const component = require('component')

module.exports = app

async function app () {
  const { io, _ } = net(id)

  const on = {
    style: inject
  }

  const action_handlers = {
    ready: handle_ready
  }

  io.on = {
    component: component_protocol
  }

  const subs = await sdb.watch(onbatch)
  const el = await component({ ...subs[0] }, io.invite('component', { up: id }))

  return el

  async function onbatch (batch) {
    const { drive } = sdb

    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const handler = on[type] || fail
      handler(data, type)
    }
  }

  function component_protocol (msg) {
    const handler = action_handlers[msg.type] || fail
    handler(msg)
  }

  function handle_ready (msg) {
    _.component('render', { cause: msg.head }, { ok: true })
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
```

See [examples/app.js](./examples/app.js).

## Defaults

`app.js` defines child instances in `defaults`.

```js
function defaults () {
  return {
    _: {
      component: {
        $: '',
        0: '',
        mapping: {
          style: 'style'
        }
      }
    },
    drive: {
      'style/': {}
    }
  }
}
```

## Point of View

- Keep `web/page.js` minimal.
- Put app setup in `app.js`.
- Use module-level STATE in `app.js` only when it is the root app module.
- Use `get(opts.sid)` inside reusable components.
