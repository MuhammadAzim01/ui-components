# Data Shell

Use this section for STATE, datasets, mappings, and component messaging.

## Read by task

- Persistent component data: read [state.md](./state.md).
- Parent/child communication: read [protocol.md](./protocol.md).
- Exact router API behavior: read [net-helper.md](./net-helper.md).

## Core terms

- `STATE`: creates state database access for a module.
- `statedb`: the module-scoped state database function.
- `defaults`: module-level default state factory.
- `api`: instance customization factory returned by `defaults`.
- `sdb`: state database for the current node or instance.
- `drive`: persistent data attached to the current node.
- dataset: a named folder in `drive`, such as `style/`.
- mapping: parent-to-child dataset connection.
- invite: wiring object passed from parent to child.
- channel helper: send function created on `_` by `net_helper`.

Older source files may call `defaults` `fallback_module`.

Older source files may call `api` `fallback_instance`.

