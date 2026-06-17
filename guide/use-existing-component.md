# Use An Existing Component

Use this when extracting a component from `src/node_modules/*` and mounting it in another app or parent component.

## Create an instance

Parent components create child instances through `_` in `defaults` or `api`.

```js
const child_component = require('child_component')

function defaults () {
  return {
    api,
    _: {
      child_component: {
        $: ''
      }
    }
  }

  function api () {
    return {
      _: {
        child_component: {
          0: '',
          mapping: {
            style: 'child_style'
          }
        }
      },
      drive: {
        'child_style/': {}
      }
    }
  }
}
```

## Mount the child

Call `sdb.watch(onbatch)` to get child instance SIDs.

```js
const subs = await sdb.watch(onbatch)
const child = await child_component({ ...subs[0] })
placeholder.replaceWith(child)
```

## Wire messages when needed

If the child uses `net_helper`, pass an invite.

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
```

Use the connected channel helper to send to the child.

```js
function render_child (msg) {
  _.child('render', msg.head ? { cause: msg.head } : {}, msg.data)
}
```

## Map datasets

Use `mapping` when the parent passes datasets to the child.

```js
mapping: {
  style: 'child_style',
  icons: 'child_icons'
}
```

The key is the child dataset name.

The value is the parent dataset name.

Read [datashell/state.md](./datashell/state.md) before changing dataset names.

