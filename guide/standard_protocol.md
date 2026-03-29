# Standard Protocol Guide

This guide explains the current messaging system used in our UI components. Communication is handled through `net_helper` using `invite` / `accept` and channel helpers on `_`.

## Core Concepts

The current protocol is based on a shared router created with `net(id)`:

1. A parent creates a local net instance.
2. The parent registers handlers on `io.on`.
3. The parent passes `io.invite(name, { up: id })` to the child.
4. The child creates its own net instance, registers `io.on`, and calls `io.accept(invite)`.
5. Both sides receive channel helpers on `_` and send with `_.channel(type, data, refs)`.

This creates a two-way communication channel:
- **Upward (Child -> Parent)**: Child sends through `_.up(...)`.
- **Downward (Parent -> Child)**: Parent sends through `_.child(...)`.

## Message Structure

Every routed message in the system has this structure:

```js
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: "message_type",
  data: { ... },
  meta: {
    time,
    stack
  }
}
```

### 1. `head` (Message Header)
The `head` is an array of 3 elements that uniquely identifies the message: `[from, to, id]`

- **`from` (sender_id)**: The instance ID of the component sending the message.
- **`to` (receiver_id)**: The connected recipient for the current channel.
- **`id` (message_id)**: The per-channel message counter managed by `net_helper`.

**Example:** `['app123', 'app456', 0]`

### 2. `refs` (References)
The `refs` object provides context and causality for the message.

- **`cause`**: If a message is triggered by another message (e.g., a response to a request), `refs.cause` must contain the `head` of the triggering message.
- **Root Events**: For user-initiated events (like clicks) or spontaneous events, `refs` should be an empty object `{}`.
- `refs` is provided by the caller, but `head` and `meta` are built by `net_helper`.

**Example:**
```javascript
// Response to a request
refs: { cause: ['app456', 'app123', 0] }

// User click event
refs: {}
```

### 3. `type` & `data`
- **`type`**: A string indicating the action or event (e.g., `'ui_focus'`, `'submit'`, `'update'`).
- **`data`**: The payload of the message. Can be any data type.

## Channel Helpers on `_`

After `invite` / `accept`, each registered channel becomes a callable helper on `_`.

Example:

```js
_.up = send
_.up.channel === 'up'
_.up.to === 'connected_recipient_id'
```

Send through the helper directly:

```javascript
_.up && _.up('something', data, {})
_.petname('done', data, { cause: msg.head })
```

Do not manually build `{ head, refs, type, data }` for net-managed sends.

## Implementation Pattern

Here is the standard template for any component:

```javascript
const net = require('net_helper')

async function my_component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { io, _ } = net(id)

  io.on.up = onmessage
  if (invite) io.accept(invite)

  // 1. Sending a Message (e.g., on click)
  button.onclick = () => {
    _.up && _.up('click', 'hello', {})
  }

  // 2. Receiving Messages
  function onmessage (msg) {
    const handler = on_message[msg.type] || fail
    handler(msg)
  }

  function handle_click (msg) {
    _.up && _.up('done', { ok: true }, { cause: msg.head })
  }

  return el
}
```

## Parent / Child Wiring Pattern

Parent:

```js
const { io: child_io, _: child_send } = net(id)
child_io.on.child = child_protocol

const child = await child_component(subs[0], child_io.invite('child', { up: id }))

function child_protocol (msg) {
  const handler = action_handlers[msg.type] || fail
  handler(msg)
}

function render_child (msg) {
  child_send.child('render', msg.data, msg.head ? { cause: msg.head } : {})
}
```

Child:

```javascript
async function child_component (opts, invite) {
  const { id } = await get(opts.sid)
  const { io, _ } = net(id)

  io.on.up = onmessage
  if (invite) io.accept(invite)
}
```

## Routing Notes

- `net_helper` forwards automatically based on `head[1]`.
- Do not add manual forwarding just to move a message through already-connected channels.
- Use the correct `_` helper directly instead.
