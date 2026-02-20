# Theme Widget – Dependency Hierarchy + Drive Integration

## Overview
Theme Widget composes the main UI shell. Every component expects `opts.ids.up` to be provided for protocol routing. Most components use the DOCS module for docs mode and action registration (datasets `docs/` + `actions/`).

## Dependency hierarchy (nested)
- theme_widget
  - program_container
    - console_history
    - actions
    - tabbed_editor
    - graph_explorer_wrapper
      - graph-explorer (external module)
      - graphdb (local helper)
    - docs_window
    - DOCS (internal dependency)
  - taskbar
    - action_bar
      - quick_actions
    - action_executor
      - program
        - form_input (from program)
        - input_test (from program)
      - steps_wizard
      - form_input (dynamic form input component)
      - input_test (dynamic form input component)
    - tabsbar
      - tabs
      - task_manager

## Drive requirements by component
“Required” below means the component reads the dataset and/or expects the file to exist for full integration.

### theme_widget (@src/node_modules/theme_widget/theme_widget.js)
- Required datasets
  - `style/theme.css` (applied to host)
- Pass-through datasets to subcomponents (exist in drive for mapping)
  - `flags/`, `commands/`, `icons/`, `scroll/`, `actions/`, `hardcons/`, `files/`, `highlight/`, `active_tab/`, `entries/`, `runtime/`, `mode/`, `keybinds/`, `undo/`, `focused/`, `temp_actions/`, `temp_quick_actions/`, `prefs/`, `variables/`, `data/`, `docs/`, `docs_style/`

### program_container (@src/node_modules/program_container/program_container.js)
- Required datasets
  - `style/theme.css`
  - `docs_style/` (forwarded to docs_window)
- Required for subcomponents (mapped)
  - console_history: `commands/`, `icons/`, `scroll/`, `docs/`, `actions/`
  - actions: `actions/`, `icons/`, `hardcons/`, `docs/`
  - tabbed_editor: `files/`, `highlight/`, `active_tab/`, `docs/`
  - graph_explorer_wrapper: `style/` (mapped as theme), `entries/`, `runtime/`, `mode/`, `flags/`, `keybinds/`, `undo/`, `docs/`
  - docs_window: `docs_style/`

### taskbar (@src/node_modules/taskbar/taskbar.js)
- Required datasets
  - `style/theme.css`
- Required for subcomponents (mapped)
  - action_bar: `icons/`, `style/`, `variables/`, `data/`, `actions/`, `hardcons/`, `prefs/`, `docs/`
  - action_executor: `style/`, `variables/`, `docs/`, `data/`
  - tabsbar: `icons/`, `style/`, `docs/`, `actions/`

### action_bar (@src/node_modules/action_bar/action_bar.js)
- Required datasets
  - `icons/console.svg`
  - `style/theme.css`
  - `docs/README.md`
- Required for subcomponents
  - quick_actions: `style/`, `icons/`, `actions/`, `hardcons/`, `prefs/`, `docs/`

### quick_actions (@src/node_modules/quick_actions/quick_actions.js)
- Required datasets/files
  - `actions/default.json` (default actions list)
  - `prefs/tooltips.json` (tooltips config)
  - `icons/*.svg` (button icons)
  - `hardcons/submit.svg`, `hardcons/close.svg`, `hardcons/confirm.svg`
  - `style/theme.css`
  - `docs/README.md`

### action_executor (@src/node_modules/action_executor/action_executor.js)
- Required datasets
  - `style/action_executor.css`
- Required for subcomponents
  - program: `style/`, `variables/`, `docs/`
  - steps_wizard: `style/`, `variables/`, `docs/`
  - form_input: `style/`, `data/`, `docs/`
  - input_test: `style/`, `data/`, `docs/`

### program (@src/node_modules/program/program.js)
- Required datasets
  - `style/program.css`
  - `variables/program.json`

### steps_wizard (@src/node_modules/steps_wizard/steps_wizard.js)
- Required datasets/files
  - `style/stepswizard.css`
  - `docs/README.md`

### form_input (@src/node_modules/form_input/form_input.js)
- Required datasets/files
  - `style/theme.css`
  - `data/form_input.json`
  - `docs/README.md`

### input_test (@src/node_modules/input_test/input_test.js)
- Required datasets/files
  - `style/theme.css`
  - `data/input_test.json`
  - `docs/README.md`

### tabsbar (@src/node_modules/tabsbar/tabsbar.js)
- Required datasets/files
  - `style/theme.css`
  - `icons/hat.svg`, `icons/docs.svg`
  - `actions/command.json`
  - `docs/README.md`
- Required for subcomponents
  - tabs: `icons/`, `variables/`, `scroll/`, `style/`, `docs/`, `actions/`
  - task_manager: `count/`, `style/`, `docs/`, `actions/`

### tabs (@src/node_modules/tabs/tabs.js)
- Required datasets/files
  - `variables/tabs.json`
  - `scroll/position.json`
  - `icons/cross.svg` + numbered icons (e.g. `1.svg`, `2.svg`)
  - `actions/commands.json`
  - `style/theme.css`
  - `docs/README.md`

### task_manager (@src/node_modules/task_manager/task_manager.js)
- Required datasets/files
  - `count/value.json`
  - `actions/commands.json`
  - `style/theme.css`
  - `docs/README.md`

### console_history (@src/node_modules/console_history/console_history.js)
- Required datasets/files
  - `commands/list.json`
  - `icons/file.svg`, `icons/bulb.svg`, `icons/restore.svg`, `icons/delete.svg`
  - `actions/commands.json`
  - `style/theme.css`
  - `docs/README.md`

### actions (@src/node_modules/actions/actions.js)
- Required datasets/files
  - `actions/commands.json`
  - `icons/*.svg`
  - `hardcons/pin.svg`, `hardcons/unpin.svg`, `hardcons/default.svg`, `hardcons/undefault.svg`
  - `style/theme.css`
  - `docs/README.md`

### graph_explorer_wrapper (@src/node_modules/graph_explorer_wrapper/index.js)
- Required datasets/files
  - `theme/style.css`
  - `entries/entries.json` (graph DB entries)
  - `docs/README.md`
- Optional datasets (for full integration)
  - `runtime/`, `mode/`, `flags/`, `keybinds/`, `undo/`

### docs_window (@src/node_modules/docs_window/docs_window.js)
- Required datasets
  - `style/theme.css`

