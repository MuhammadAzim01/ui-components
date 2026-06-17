# Net Helper

Use this when you need the exact `net_helper` API or router behavior.

For normal component communication, start with [protocol.md](./protocol.md).

## API

```js
const net = require('net_helper')

const { io, _ } = net(id)

io.on = {
  up: io_up(),
  child: io_child()
}
```

`net(id)` returns:

- `io.invite(name, ids)`
- `io.accept(invite)`
- `io.on`
- `_`

## Invite and accept

A parent creates an invite for a child.

```js
const child = await child_component({ ...subs[0] }, io.invite('child', { up: id }))
```

The child accepts the invite.

```js
async function child_component (opts, invite) {
  const { id } = await get(opts.sid)
  const { io, _ } = net(id)

  io.on = {
    up: io_up()
  }
  if (invite) io.accept(invite)
}
```

After `invite` and `accept`, `net_helper` creates channel helpers on `_`.

## Channel helpers

Each helper sends a message through a named channel.

```js
const head = _.child('render', { cause: msg.head }, msg.data)
```

Signature:

```js
_.channel(type, refs = {}, data = null)
```

The helper creates:

- `head`
- `refs`
- `type`
- `data`
- `meta.time`
- `meta.stack`

The helper returns the generated `head`.

Keep the returned `head` only when you need to match a later response.

## Message shape

Messages routed by `net_helper` have this shape:

```js
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: 'message_type',
  data: {},
  meta: {
    time,
    stack
  }
}
```

`head` and `meta` are managed by `net_helper`.

Callers provide `type`, `refs`, and `data`.

## Routing behavior

`net_helper` routes by the recipient in `head`.

If the recipient is not the current component, the router forwards the message through known connected channels.

Components should still use channel helpers directly instead of rebuilding message objects.

```js
_.action_bar(msg.type, { cause: msg.head }, msg.data)
_.up('render_form', { cause: msg.head }, data)
```

