## Completed Tasks

### Worklog 84

- [x] Added `guide/standard.md` and `guide/theme_widget.md`
- [x] Implemented standard practices across the JS codebase

### Worklog 85

- [x] Renamed components and improved naming around the previous `exec` / `space` structure
- [x] Moved or merged manager responsibilities into `taskbar`
- [x] Merged `focus_tracker` behavior into `theme_widget`
- [x] Updated anonymous functions and refactored one-liners
- [x] Ran a linting pass

### Worklog 86

- [x] Refactored layout dynamic grid sizing and actions visibility handling
- [x] Refined `program_container` to better house `graph_explorer`
- [x] Removed optional chaining and verbose `&&` operator patterns
- [x] Added step execution with graph explorer commands

### Worklog 87

- [x] Updated `guide/theme_widget.md`
- [x] Added a module-level example to `guide/standard.md`
- [x] Replaced remaining `else-if` routing with `obj[type](data)` style in multiple places
- [x] Styled elements with `CSSStyleSheet`
- [x] Simplified fail functions

### Worklog 88

- [x] create a `task.md` to track the current task list and progress
- [x] Create a shared `net` helper module for protocol wiring and refactor component communication to use it project-wide

## TODO Tasks
### Net Module

- [ ] Update the communication part of `guide/standard.md` and `guide/standard_protocol.md` to reflect the shared helper once it exists

### Documentation

- [ ] Package `DOCS` as a proper module folder with `DOCS/index.js` and `DOCS/README.md`

- [ ] Write down the standard for how actions should be defined and registered in a README

- [ ] De-duplicate and tighten the guide files
  - focus on `guide/standard.md`, `guide/deep_guide_for_modules.md`, and `guide/cheat_sheet.md`
  - replace repeated explanations with links to the exact sections that should be read

- [ ] Keep hierarchy / structure docs concise and responsibility-driven
  - avoid long walls of text that are hard to keep in sync
  - keep using source links into module files where useful

### Root Module

- [ ] Fix the root boot pattern in `web/page.js` and remove `boot({ sid: '' })`
- [ ] Extract the current root demo / gallery logic from `web/page.js` into a dedicated component such as `ui_gallery`
  - goal: keep `page.js` minimal and generic

- [ ] Clarify and possibly refactor component responsibilities around `theme_widget`, `program_container`, `taskbar`, `action_executor`, `tabbed_editor`, `docs_window`, and graph explorer integration
  - goal: make component boundaries more obvious from their names and responsibilities

### Graph Explorer Integration

- [ ] Improve graph explorer execution integration behavior
- [ ] Finish graph explorer positioning work
  - [ ] use graph explorer as a steps wizard input form
  - [ ] use graph explorer as a `task.json` visualizer
  - [ ] use graph explorer as a standalone program in its own tab
- [ ] Implement tab icon click feature for showing `task.json`
- [ ] Fix the `variables` object access issue
- [ ] Refine console history and docs display behavior
- [ ] Add communication between `tabs`, `task_manager`, `tabbed_editor`, and `graph_explorer`
- [ ] Finish touch gestures and graph form work

### Manual Cleanup

- [ ] Check compatibility of the current action / docs work with related contributor work so the projects do not drift apart
- [ ] Do a manual cleanup pass for LLM-style regressions and review noise
- [ ] remove unnecessary boilerplate wrappers introduced during refactors
- [ ] keep obvious one-liners simple when that improves readability
- [ ] make sure helper functions live in the expected location in files
- [ ] verify no cleanup refactor accidentally changed behavior or parameters
