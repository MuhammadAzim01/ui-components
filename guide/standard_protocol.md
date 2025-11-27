# Standard Protocol Guide

This guide explains the standard messaging protocol used in our UI components system. The protocol allows components to communicate effectively up and down the hierarchy.

## Core Concepts

The protocol is based on a **Double Callback** pattern where:
1. A parent component passes a `protocol` function to its child.
2. The child calls this `protocol` function, passing its own `onmessage` handler.
3. The `protocol` function returns a `send` function that the child uses to send messages to the parent.

This creates a two-way communication channel:
- **Upward (Child -> Parent)**: Child uses the returned `send` function.
- **Downward (Parent -> Child)**: Parent uses the child's `onmessage` handler.

## Message Structure

Every message in the system follows a strict JSON structure:

```js
{
  head: [sender_id, receiver_id, message_id],
  refs: { cause: parent_message_head },
  type: "message_type",
  data: { ... }
}
```

### 1. `head` (Message Header)
The `head` is an array of 3 elements that uniquely identifies the message: `[from, to, id]`

- **`from` (sender_id)**: The instance ID of the component sending the message.
  - *Dynamic*: Always derived from `opts.sid` (e.g., `const { id } = await get(opts.sid)`).
- **`to` (receiver_id)**: The instance ID of the component receiving the message.
  - *Dynamic*: For upward messages, this is passed by the parent via `opts.ids.up`.
  - For downward messages, the parent knows the child's ID (or uses a specific name like `'child_component'`).
- **`id` (message_id)**: A unique counter for the message, specific to the sender instance.
  - Typically implemented as a local `let mid = 0` counter that increments with `mid++`.

**Example:** `['app123', 'app456', 0]`

### 2. `refs` (References)
The `refs` object provides context and causality for the message.

- **`cause`**: If a message is triggered by another message (e.g., a response to a request), `refs.cause` must contain the `head` of the triggering message.
- **Root Events**: For user-initiated events (like clicks) or spontaneous events, `refs` should be an empty object `{}`.

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

## Dynamic `by` and `to`

To ensure components are reusable and instance-independent, we **never** hardcode component IDs.

### Setting up `by` and `to`
Every component initializes these values at the start:

```javascript
async function my_component(opts, protocol) {
  // 1. Get our own instance ID ('by')
  const { id } = await get(opts.sid)
  const by = id

  // 2. Get the parent's instance ID ('to')
  const ids = opts.ids
  if (!ids || !ids.up) throw new Error('ids.up required')
  const to = ids.up
  
  // ...
}
```
- The parent MUST provide this in opts.ids.up by passing it as parameter. For Example the parent of my_component:
```js
await my_component({...subs[0], ids: { up: 'parent_id' } }, protocol)
```

### Sending Messages
When sending a message upward, always use the dynamic variables:

```javascript
const head = [by, to, mid++]
const refs = {} // or { cause: incoming_msg.head }
send({ head, refs, type: 'something', data: ... })
```

## Implementation Pattern

Here is the standard template for any component:

```javascript
async function my_component (opts, protocol) {
  // 1. Setup IDs
  const { id, sdb } = await get(opts.sid)
  const ids = opts.ids
  if (!ids || !ids.up) throw new Error('ids.up required')
  const by = id
  const to = ids.up
  let mid = 0 // message id, will be incremented with each message

  // 2. Setup Protocol
  let send = null
  let _ = null
  if (protocol) {
    // Initialize protocol: give parent our onmessage, get back send
    send = protocol(onmessage)
    _ = { up: send }
  }

  // 3. Sending a Message (e.g., on click)
  button.onclick = () => {
    if (_) {
      const head = [by, to, mid++]
      const refs = {} // User event, no cause
      _.up({ head, refs, type: 'click', data: 'hello' })
    }
  }

  // 4. Receiving Messages
  function onmessage (msg) {
    const { head, refs, type, data } = msg
    // Handle message...
    
    // If replying:
    // const reply_head = [by, to, mid++]
    // const reply_refs = { cause: head }
    // _.up({ head: reply_head, refs: reply_refs, ... })
  }
  
  return el
}
```
