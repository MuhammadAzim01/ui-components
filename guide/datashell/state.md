# STATE And Data

Use this when working with `STATE`, `sdb`, `drive`, `defaults`, `api`, datasets, mappings, or `sdb.watch`.

## Setup

```js
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(defaults)
```

Reusable components fetch instance state inside the component.

```js
async function component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
}
```

Root pages and demo pages may use module-level STATE.

```js
const { sdb, id } = statedb(defaults)
```

## Watch datasets

Use `await sdb.watch(onbatch)`.

Batch entries contain `type` and `paths`.

```js
const on = {
  style: inject,
  icons: iconject
}

await sdb.watch(onbatch)

async function onbatch (batch) {
  for (const { type, paths } of batch) {
    const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
    const handler = on[type] || fail
    handler(data, type)
  }
}
```

Handlers receive dataset file contents as `data`.

Do not use the old `{ type, data }` batch shape.

## Drive

`drive` stores persistent data attached to the current node.

Use datasets with trailing slashes.

```js
drive: {
  'style/': {
    'theme.css': {
      raw: `
        .component {
          display: flex;
        }
      `
    }
  }
}
```

Use `$ref` for larger CSS, SVG, or asset content near the module.

```js
drive: {
  'icons/': {
    'close.svg': {
      $ref: 'close.svg'
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
            style: 'style'
          }
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: '.component { display: flex; }'
          }
        }
      }
    }
  }
}
```

## `_` and mapping

`_` defines submodules and instances.

Module-level submodule declarations must include `$`.

```js
_: {
  child_component: {
    $: ''
  }
}
```

Instance mappings must include `mapping` when datasets pass to child modules.

```js
_: {
  child_component: {
    0: '',
    mapping: {
      style: 'parent_style'
    }
  }
}
```

The mapping key is the child dataset name.

The mapping value is the parent dataset name.

Empty parent datasets are acceptable when they exist only for mapping.

```js
drive: {
  'parent_style/': {}
}
```

## Drive updates

Use `drive.put()` for persisted data updates that affect UI.

`drive.put()` triggers `onbatch`.

Use flags when a write should not cause the normal UI update path.

## Compatibility notes

Older source files may call `defaults` `fallback_module`.

Older source files may call `api` `fallback_instance`.

Guide examples should use `defaults` and `api`.

