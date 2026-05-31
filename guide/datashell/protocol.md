# Protocol

Use this when components communicate with parents or children.

The component communication pattern uses `net_helper`, `invite` / `accept`, `io.on`, and channel helpers on `_`.

For the exact helper API, read [net-helper.md](./net-helper.md).

## Component pattern

```js
const net = require('net_helper')

async function component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { io, _ } = net(id)

  io.on = {
    up: onmessage
  }
  if (invite) io.accept(invite)

  return el

  function onmessage (msg) {
    const handler = on_message[msg.type] || onmessage_fail
    handler(msg)
  }

  function onmessage_fail (msg) {
    fail(msg.data, msg.type)
  }
}
```

## Send messages

Channel helpers use this signature:

```js
_.channel(type, refs, data)
```

Use `{}` for root or UI-originated messages.

```js
function onbutton_click () {
  _.up('button_clicked', {}, { value: true })
}
```

Use `{ cause: msg.head }` for messages caused by another message.

```js
function handle_request (msg) {
  _.up('request_done', { cause: msg.head }, { ok: true })
}
```

Do not manually build `head`, `refs`, `type`, `data`, or `meta`.

## Parent to child

```js
const { io, _ } = net(id)

io.on = {
  child: child_protocol
}

const child = await child_component({ ...subs[0] }, io.invite('child', { up: id }))

function child_protocol (msg) {
  const handler = child_messages[msg.type] || fail
  handler(msg)
}

function render_child (msg) {
  _.child('render', msg.head ? { cause: msg.head } : {}, msg.data)
}
```

See [../examples/parent-child.js](../examples/parent-child.js) for a complete example.

## Route messages

Use action maps.

```js
const on_message = {
  load: handle_load,
  save: handle_save
}

function onmessage (msg) {
  const handler = on_message[msg.type] || onmessage_fail
  handler(msg)
}
```

Do not use `switch` for message routing.

## Forwarding

Do not forward messages just to move them through already connected components.

Use the correct connected `_` helper directly.

Forward only when a wrapper intentionally:

- translates message type or data
- filters messages
- enriches payload
- bridges components that do not directly share channel helpers

## Avoid

- No old callback protocol style.
- No manual channel helper assignment onto `_`.
- No manual message object construction.
- No `_.channel(type, data, refs)` argument order.

