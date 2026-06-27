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

Use `docs.hook(element, doc_content)` to wrap all event handler properties already assigned on the element, such as `onclick`, `ontouchstart`, or `onmousedown`. In docs mode, those events show the docs instead of running the handler.

```js
const button = document.createElement('button')
button.onclick = onbutton_click
button.onmousedown = onbutton_press

docs.hook(button, '# Close Button\nCloses the current view.')
```

`docs.hook` applies the same documentation to every handler it wraps on that element. The wrapped handler metadata includes `event_type`, but `docs.hook` does not accept separate docs per event. If `onclick`, `ontouchstart`, `onmousedown`, or a click-and-hold handler need different documentation, wrap each handler directly with `docs.wrap`.
e.g.
```js
button.onclick = docs.wrap(onbutton_click, '# Close Button\nCloses the current view.')
```

### Wrapping individual handlers

Use `docs.wrap(handler, doc_content)` to manually wrap an event handler:

```js
button.onmousedown = docs.wrap(onbutton_press, '# Press Button\nStarts press-and-hold behavior.')
button.onmouseup = docs.wrap(onbutton_release, '# Release Button\nEnds press-and-hold behavior.')
button.onmouseover = docs.wrap(onbutton_hover, '# Hover Button\nShows button tooltip.')
```

The wrapped handler receives `(event, sys)`. `sys` exposes docs helpers such as `sys.is_docs_mode()`, `sys.get_doc()`, `sys.get_meta()`, and `sys.show_doc()`.

### Wrapping isolated handlers

Use `docs.wrap_isolated(handler_string, doc_content)` when the handler must be created from a function string and must not access local closure scope.

```js
button.onclick = docs.wrap_isolated(
  'function (event, sys) { console.log(sys.get_meta().sid) }',
  '# Inspect Button\nLogs this component sid.'
)
```

---

## How the ❔ details window works

The details window leverages a global docs mode state:

1. Docs mode is activated globally (e.g. by toggling the `docs_toggle` action).
2. When the user clicks an element with a hooked or wrapped event handler, `DOCS` prevents the default action, stops propagation, and triggers the doc display handler.
3. When the user triggers a registered action, the action `info` text is shown instead of executing the action.
4. The display handler receives `{ content, sid }` and renders the markdown in the details window.

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
  "info": "Explain what this action does when it is triggered.",
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

`info` is required. Keep it short and useful because docs mode displays this text in the details window when the action would normally run.

### Registering actions

Load the actions array from the component drive and register:

```js
const actions_file = await drive.get('actions/commands.json')
if (actions_file.raw) {
  const actions = JSON.parse(actions_file.raw)
  docs.register_actions(actions)
}
```

When a component is about to run a registered action, call `docs.show_action_info(action)` first. It returns `true` in docs mode after displaying `action.info`, so the component should stop there.

```js
function on_action_click () {
  if (docs.show_action_info(action)) return
  run_action(action)
}
```

### Retrieving actions (ActionBar/Admin)

The root module uses the admin API to retrieve registered actions for the focused app:

```js
const actions = docs.admin.get_actions(focused_sid)
// Pass actions to action_bar component
```
