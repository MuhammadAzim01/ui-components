# Demo Pages

Use this when creating a browser preview page.

Create two modules:

- `web/page.js`: minimal browser entry that configures the document and renders the app.
- `src/app.js`: app setup module that creates the UI and wires components.

`app.js` may also live under `src/node_modules` when you want to package the app like the other local modules.

## page.js

Keep `page.js` small. It should not contain component setup, STATE defaults, dataset mappings, or protocol wiring. It should only configure the document and boot the app module.

See the complete example in [examples/page.js](./examples/page.js).

## app.js

Use `app.js` for the actual app setup. It acts as the root module, initializing the router API, mounting children, and watching root datasets.

See the complete example in [examples/app.js](./examples/app.js).

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
