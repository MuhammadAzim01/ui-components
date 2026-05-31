# Context Glossary

## defaults

The module-level default state factory passed to `statedb(...)`.

Older source files may call this `fallback_module`; public guide documentation should prefer `defaults`.

## api

The nested instance customization factory returned from `defaults`.

Older source files may call this `fallback_instance`; public guide documentation should prefer `api`.

## channel helper

A send function created by `net_helper` on `_`.

Use the signature `_.channel(type, refs, data)`. Use `{}` for root or UI-originated messages, and `{ cause: msg.head }` for messages derived from another message.

## coding standards

The strict developer rules for this repository's component code.

Public guide documentation should use `guide/coding-standards.md` as the canonical file for these rules.

## Data Shell guide

The public guide area for STATE, protocol, and `net_helper` concepts.

Use `guide/datashell/` for docs that explain persistent component data, dataset mappings, `sdb.watch`, `drive`, `invite` / `accept`, and channel helper messaging.

## protocol guide

The task-facing Data Shell guide for component communication patterns.

Use `guide/datashell/protocol.md` for parent/child wiring, action maps, causality refs, and forwarding rules.

## net_helper guide

The API-facing Data Shell guide for the `net_helper` module.

Use `guide/datashell/net-helper.md` for `net(id)`, `io.invite`, `io.accept`, `io.on`, `_`, and exact channel helper behavior.

## task-routed guide

The public guide structure should route by developer intent.

Use top-level task docs such as `guide/create-component.md`, `guide/use-existing-component.md`, `guide/demo-pages.md`, and `guide/theme-widget.md`.

## guide examples

Complete reusable guide examples should live under `guide/examples/`.

Keep public docs concise with short inline snippets, and link to focused example files for full component, demo page, and parent/child protocol examples.
