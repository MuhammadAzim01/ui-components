# Component Standard (v1)

This file defines the baseline conventions for all components in `src/node_modules/*` and for guide examples.

## 1) Required module skeleton

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = component

async function component (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) throw new Error(`Component ${__filename} requires ids.up to be provided`)

  const by = id
  const to = ids.up
  let mid = 0

  const on = {
    style: inject
  }

  const on_message = {
    some_type: handle_some_type
  }

  let _ = null
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  await sdb.watch(onbatch)

  return el

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
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
}
```

## 2) Message dispatch standard

### Convention
- We dont use `switch (type)` for `onmessage` routing or any other type of selection. Instead `object[type](params)` is used.
- Use action objects:
  - `on_message` for parent -> current component
  - `action_handlers` for child protocol routing

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
- We dont use direct checks like `if (msg.type === 'ui_focus') ...`.
- Use `action_handlers` with explicit fallback forwarding.

### Pattern
```js
function child_protocol (send) {
  _.send_child = send
  const action_handlers = {
    ui_focus: forward_focus
  }
  return on

  function on (msg) {
    const handler = action_handlers[msg.type] || forward_default
    handler(msg)
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

- Always send full message object: `{ head, refs, type, data }`.
- Build `head` dynamically using `[by, to, mid++]`.
- Use `refs: { cause: msg.head }` for derived messages, `{}` for root/UI events.
- See more in `protocol.md`.

## 6) Fallback structure standard

- Use `fallback_module` + `fallback_instance`.
- Submodules in `_` must define `$` at module-level declaration.
- Instance mappings must define `mapping` when datasets are passed down.
- Keep dataset names aligned with child expectations.

## 7) Naming conventions

- Use snake_case where practical.
- Prefer named functions Instead of Anonymous.