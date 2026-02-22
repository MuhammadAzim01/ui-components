# Theme Widget Hierarchy

## Theme Widget
Theme Widget is a application level component that is used to change/modify the theme of some other applications.

## Dependency Tree
The following tree provides a high level overview of the dependencies of theme widget. You can click on any node to view the source code of that component and it will lead you to the component's drive section. You can then check the drive section to view the detasets you might modify and need to map to parent component's datasets.

- [`theme_widget`](../src/node_modules/theme_widget/theme_widget.js#L214)
  - [`program_container`](../src/node_modules/program_container/program_container.js#L430)
    - [`console_history`](../src/node_modules/console_history/console_history.js#L180)
    - [`actions`](../src/node_modules/actions/actions.js#L194)
    - [`tabbed_editor`](../src/node_modules/tabbed_editor/tabbed_editor.js#L236)
    - [`graph_explorer_wrapper`](../src/node_modules/graph_explorer_wrapper/graph_explorer_wrapper.js#L279) (Utilizing External Module - Graph Explorer)
    - [`docs_window`](../src/node_modules/docs_window/docs_window.js#L90)
  - [`taskbar`](../src/node_modules/taskbar/taskbar.js#L228)
    - [`action_executor`](../src/node_modules/action_executor/action_executor.js#L409)
      - [`program`](../src/node_modules/program/program.js#L106)
      - [`steps_wizard`](../src/node_modules/steps_wizard/steps_wizard.js#L198)
      - [`form_input`](../src/node_modules/form_input/form_input.js#L167)
      - [`input_test`](../src/node_modules/input_test/input_test.js#L171)
    - [`action_bar`](../src/node_modules/action_bar/action_bar.js#L244)
      - [`quick_actions`](../src/node_modules/quick_actions/quick_actions.js#L410)
    - [`tabsbar`](../src/node_modules/tabsbar/tabsbar.js#L204)
      - [`tabs`](../src/node_modules/tabs/tabs.js#L231)
      - [`task_manager`](../src/node_modules/task_manager/task_manager.js#L112)
