# Protocol

Use this when components communicate with parents or children.

The component communication pattern uses `net_helper`, `invite` / `accept`, `io.on`, and channel helpers on `_`.

For the exact helper API, read [net-helper.md](./net-helper.md).

## Component pattern

Every component registers message handlers on `io.on` using instantiating functions (like `io_up()`) and accepts the parent invite if present:

```js
io.on = {
  up: io_up()
}
if (invite) io.accept(invite)
```

See the full setup under `async function component` in [examples/component.js](../examples/component.js).

Channel helpers use this signature:

```js
_[name](type, refs = {}, data = null)
```

Messages contain a `head` array of structure `[by, to, mid]` representing sender (`by`), receiver (`to`), and message identifier (`mid`).

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
  child: io_child()
}

const child = await child_component({ ...subs[0] }, io.invite('child', { up: id }))

function io_child () {
  return function child_protocol (msg) {
    const handler = child_messages[msg.type] || fail
    handler(msg)
  }
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
- No incorrect `_[name](type, data, refs)` helper argument order.
