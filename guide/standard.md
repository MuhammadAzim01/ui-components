# Component Standard (v2)

This file defines the baseline conventions for all components in `src/node_modules/*` and for guide examples.

## 1) Required module skeleton

### 1a) Instance-level STATE (normal components)

Every component in `src/node_modules/` or `lib/` etc uses the instance-level pattern. `get` is called inside the component function using the `sid` passed in from the parent via `opts.sid`. This gives an `sdb` and `id`. The main difference is that we define a fallback_instance function (api) alongside the fallback_module (defaults) as well.

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
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
    some_type: handle_some_type
  }

  io.on.up = onmessage
  if (invite) io.accept(invite)

  await sdb.watch(onbatch)

  return el

  function onmessage (msg) {
    const handler = on_message[msg.type] || onmessage_fail
    handler(msg)
  }

  function onmessage_fail (msg) {
    fail(msg.data, msg.type)
  }

  function handle_some_type (msg) {
    _.up && _.up('done', { ok: true }, { cause: msg.head })
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
}
```

### 1b) Module-level STATE (page.js / demo-page pattern)

Entry-point/Root files like `web/page.js` and any per-component demo page use `sdb`, `id` (and sometimes `io`) **directly at module scope**. There is no `get(opts.sid)` call because it is the root node/module and it doesn't receive a `sid` from a parent.

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, io, id } = statedb(fallback_module)
const { drive, admin } = sdb
const net = require('../src/node_modules/net_helper')

const my_component = require('../src/node_modules/my_component')

boot()

async function boot () {
  const subs = await sdb.watch(onbatch)
  const { io: child_io, _: child_send } = net(id)
  child_io.on.my_component = component_protocol

  const el = await my_component({ ...subs[0], ids: { up: id } }, child_io.invite('my_component', { up: id }))
  document.body.append(el)

  function component_protocol (msg) {
    const handler = action_handlers[msg.type] || fail
    handler(msg)
  }

  const action_handlers = {
    refresh: handle_refresh
  }

  function handle_refresh (msg) {
    child_send.my_component('render', msg.data, msg.head ? { cause: msg.head } : {})
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn(__filename + ' invalid message', { cause: { data, type } }) }
}
```

## 2) Message dispatch standard

### Convention
- We dont use `switch (type)` for `onmessage` routing or any other type of selection. Instead `object[type](params)` is used.
- Use action objects:
  - `on_message` for current incoming channel handling
  - `action_handlers` for wrapper / forwarding handlers

### Pattern
```js
const on_message = {
  load_actions: handle_load_actions,
  filter_actions: handle_filter_actions
}

function onmessage (msg) {
  const handler = on_message[msg.type] || onmessage_fail
  handler(msg)
}
```

### Convention
- Prefer action maps for message routing.
- Small explicit guards are acceptable when a component only has one or two message types.
- Wrapper channels should use explicit fallback forwarding through connected `_` helpers.

### Pattern
```js
function io_petname () {
  const action_handlers = {
    ui_focus: forward_focus
  }
  return protocol

  function protocol (msg) {
    const handler = action_handlers[msg.type] || forward_default
    handler(msg)
  }

  function forward_default (msg) {
    _.up && _.up(msg.type, msg.data, msg.head ? { cause: msg.head } : {})
  }
}
```

## 3) Element creation and event handling

### Required
- Create all UI with JS + template literals.
- Use `shadow` with closed mode.
- Use `onclick`, `oninput`, etc. (avoid `addEventListener` in this codebase style).
- Keep render and behavior separated into named functions.

### Good
```js
button.onclick = on_button_click
```

### Avoid
```js
button.addEventListener('click', () => { ... })
```

## 4) sdb + drive usage standard

- Always watch updates or changes in data via `await sdb.watch(onbatch)`.
- Keep dataset handlers in `on` object.
- Read batch payload through `paths` + `drive.get(path).then(file => file.raw)`.
- Use `drive.put()` to persist updates or changes to data that affect the UI.
- Use flags when `drive.put()` should not trigger a full rerender flow.

## 5) Protocol communication standard

- For net-based components, use `const { io, _ } = net(id)`.
- Register handlers on `io.on`.
- Accept parent wiring with `if (invite) io.accept(invite)`.
- Create child wiring with `io.invite(name, { up: id })`.
- Send through `_` channel helpers like `_.up && _.up(type, data, refs)` or `_.child(type, data, refs)`.
- Use `refs: { cause: msg.head }` for derived messages, `{}` for root/UI events.
- Do not manually construct `{ head, refs, type, data }` for net-managed sends.
- Do not manually assign channel helpers onto `_`.
- See more in `standard_protocol.md` and `../src/node_modules/net_helper/README.md`.

## 6) Fallback structure standard

- Use `fallback_module` + `fallback_instance`.
- Submodules in `_` must define `$` at module-level declaration.
- Instance mappings must define `mapping` when datasets are passed down.
- Keep dataset names aligned with child expectations.

## 7) Naming conventions

- Use snake_case where practical.
- Prefer named functions Instead of Anonymous.

## 8) Handling Object undefined

- Avoid `?.` optional chaining in this codebase unless there is a strong reason.
- Use direct property access for required state and required objects.
- Use explicit guards where a connection is optional, e.g. `_.up && _.up(...)`.