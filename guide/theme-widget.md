# Theme Widget

Use this when changing theme widget styling, datasets, mappings, or dependency wiring.

`theme_widget` is an application-level component used to modify theme data for other modules.

Theme work usually means finding which child module owns the visual element, then mapping or updating the right dataset through parent fallbacks.

## Dependency tree

```text
theme_widget
  program_container
    console_history
    actions
    tabbed_editor
    graph_explorer_wrapper
    docs_window
  taskbar
    action_executor
      program
      steps_wizard
      form_input
      input_test
    action_bar
      quick_actions
    tabsbar
      tabs
      task_manager
```

## Workflow

1. Find the module that owns the target visual element.
2. Inspect its `defaults` and `api` drive datasets.
3. Check parent `_` mappings from `theme_widget` down to that module.
4. Add or adjust datasets where mapping requires them.
5. Use `$ref` for bulky CSS or SVG assets.
6. Keep mapping names aligned with child expectations.

## Source links

- [`theme_widget`](../src/node_modules/theme_widget/theme_widget.js)
- [`program_container`](../src/node_modules/program_container/program_container.js)
- [`console_history`](../src/node_modules/console_history/console_history.js)
- [`actions`](../src/node_modules/actions/actions.js)
- [`tabbed_editor`](../src/node_modules/tabbed_editor/tabbed_editor.js)
- [`graph_explorer_wrapper`](../src/node_modules/graph_explorer_wrapper/graph_explorer_wrapper.js)
- [`docs_window`](../src/node_modules/docs_window/docs_window.js)
- [`taskbar`](../src/node_modules/taskbar/taskbar.js)
- [`action_executor`](../src/node_modules/action_executor/action_executor.js)
- [`program`](../src/node_modules/program/program.js)
- [`steps_wizard`](../src/node_modules/steps_wizard/steps_wizard.js)
- [`form_input`](../src/node_modules/form_input/form_input.js)
- [`input_test`](../src/node_modules/input_test/input_test.js)
- [`action_bar`](../src/node_modules/action_bar/action_bar.js)
- [`quick_actions`](../src/node_modules/quick_actions/quick_actions.js)
- [`tabsbar`](../src/node_modules/tabsbar/tabsbar.js)
- [`tabs`](../src/node_modules/tabs/tabs.js)
- [`task_manager`](../src/node_modules/task_manager/task_manager.js)