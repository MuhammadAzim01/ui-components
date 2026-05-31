# Coding Standards

Use this as the strict rule set for component code and guide examples.

## Base rules

- Use CommonJS: `require`, `module.exports`.
- Use StandardJS / standardx style.
- Use 2-space indentation.
- Use `snake_case` where practical.
- Prefer named functions.
- Do not use classes for components.
- Do not use `this` for components.
- Keep changes scoped to the task.
- Modernize touched old code paths when safe.
- Do not invent workflow commands.
- Do not create a new test setup by default.

## Component rules

- Reusable components use instance-level STATE with `get(opts.sid)`.
- Root pages and demo pages may use module-level STATE.
- Build UI with JavaScript and template literals.
- Use closed shadow DOM: `el.attachShadow({ mode: 'closed' })`.
- Use property handlers such as `onclick`, `oninput`, and `onchange`.
- Use `addEventListener` only when an API requires it.
- Keep render and behavior separated into named functions.
- Keep main setup above `return el`.
- Keep helper functions used by the component below `return el`.
- Keep `defaults` outside the component function.

## STATE rules

- Use `defaults` for module defaults.
- Use nested `api` for instance customization.
- Use `await sdb.watch(onbatch)`.
- Read batch entries through `paths`.
- Load dataset files with `drive.get(path).then(file => file.raw)`.
- Use trailing slashes for dataset names.
- Use `$ref` for bulky CSS, SVG, and asset content.
- Use `drive.put()` for persisted UI-affecting data updates.
- Use flags when a write should not trigger the full UI update flow.

## Submodule and mapping rules

- `_` defines submodules and instances.
- Module-level submodule declarations must include `$`.
- Instance mappings must include `mapping` when datasets pass to child modules.
- Keep dataset names aligned with child expectations.
- Empty datasets are acceptable when needed only for mapping.

## Protocol rules

- Use `const { io, _ } = net(id)` for `net_helper`.
- Register handlers on `io.on`.
- Accept parent wiring with `if (invite) io.accept(invite)`.
- Send messages with channel helpers on `_`.
- Use `_.channel(type, refs, data)`.
- Use `{}` for root or UI-originated messages.
- Use `{ cause: msg.head }` for messages derived from another message.
- Route incoming messages through action maps.
- Forward only when a wrapper translates, filters, enriches, or bridges messages.

## Avoid

- No old protocol callback patterns.
- No old `{ type, data }` `onbatch` examples.
- No reusable-component module-level STATE.
- No manual construction of `{ head, refs, type, data }`.
- No manual assignment of channel helpers onto `_`.
- No `switch` for message routing.
- No generic forwarding just to move messages around.
- No optional chaining unless runtime optionality is intentional.

## Compatibility notes

Older source files may use `fallback_module` for `defaults`.

Older source files may use `fallback_instance` for `api`.

Guide docs and new examples should use `defaults` and `api`.

