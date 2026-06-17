# Actions And Docs

This guide is about registering component actions and document event handlers with the `DOCS` system.

## Using `DOCS` inside a component

Import `DOCS` and initialize it with the module filename and instance `sid`:

```js
const DOCS = require('DOCS')

async function component (opts, invite) {
  const { id, sdb } = await get(opts.sid)
  const docs = DOCS(__filename)(opts.sid)
  // ...
}
```

### Hooking DOM elements

Use `docs.hook(element, doc_content)` to wrap all inline event handlers (like `onclick`) on the element. In docs mode, trigger events show the docs instead of running the handler.

```js
const button = document.createElement('button')
button.onclick = onbutton_click

docs.hook(button, '# Close Button\nCloses the current view.')
```

### Wrapping individual handlers

Use `docs.wrap(handler, doc_content)` to manually wrap an event handler:

```js
button.onclick = docs.wrap(onbutton_click, '# Close Button\nCloses the current view.')
```

---

## How the ❔ details window works

The details window leverages a global docs mode state:

1. Docs mode is activated globally (e.g. by toggling the `docs_toggle` action).
2. When the user clicks an element with a hooked or wrapped event handler, `DOCS` prevents the default action, stops propagation, and triggers the doc display handler.
3. The display handler receives `{ content, sid }` and renders the markdown in the details window.

### Admin Setup (Root Module)

Only the first caller (the root module) gets the admin API:

```js
const docs = DOCS(__filename)(opts.sid)

// Toggle docs mode
docs.admin.set_docs_mode(true)

// Set the display callback
docs.admin.set_doc_display_handler(({ content, sid }) => {
  // Render details UI with content
})
```

---

## Action Registration for the ActionBar

Components register their available administrative/user actions using `docs.register_actions(actions_list)`.

### Action Schema

Each action must follow this shape:

```json
{
  "name": "Action Name",
  "icon": "icon_identifier",
  "status": {
    "pinned": true,
    "default": false
  },
  "steps": [
    {
      "name": "Step Name",
      "type": "mandatory",
      "is_completed": false,
      "component": "form_input",
      "status": "default",
      "data": ""
    }
  ]
}
```

### Registering actions

Load the actions array from the component drive and register:

```js
const actions_file = await drive.get('actions/commands.json')
if (actions_file.raw) {
  const actions = JSON.parse(actions_file.raw)
  docs.register_actions(actions)
}
```

### Retrieving actions (ActionBar/Admin)

The root module uses the admin API to retrieve registered actions for the focused app:

```js
const actions = docs.admin.get_actions(focused_sid)
// Pass actions to action_bar component
```
