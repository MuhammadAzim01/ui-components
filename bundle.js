(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = graph_explorer

async function graph_explorer (opts, protocol) {
  /******************************************************************************
  COMPONENT INITIALIZATION
    - This sets up the initial state, variables, and the basic DOM structure.
    - It also initializes the IntersectionObserver for virtual scrolling and
      sets up the watcher for state changes.
  ******************************************************************************/
  const { sdb } = await get(opts.sid)
  const { drive } = sdb

  let vertical_scroll_value = 0
  let horizontal_scroll_value = 0
  let selected_instance_paths = []
  let confirmed_instance_paths = []
  let db = null // Database for entries
  let instance_states = {} // Holds expansion state {expanded_subs, expanded_hubs} for each node instance.
  let search_state_instances = {}
  let search_entry_states = {} // Holds expansion state for search mode interactions separately
  let view = [] // A flat array representing the visible nodes in the graph.
  let mode // Current mode of the graph explorer, can be set to 'default', 'menubar' or 'search'. Its value should be set by the `mode` file in the drive.
  let previous_mode
  let search_query = ''
  let hubs_flag = 'default' // Flag for hubs behavior: 'default' (prevent duplication), 'true' (no duplication prevention), 'false' (disable hubs)
  let selection_flag = 'default' // Flag for selection behavior: 'default' (enable selection), 'false' (disable selection)
  let recursive_collapse_flag = false // Flag for recursive collapse: true (recursive), false (parent level only)
  let drive_updated_by_scroll = false // Flag to prevent `onbatch` from re-rendering on scroll updates.
  let drive_updated_by_toggle = false // Flag to prevent `onbatch` from re-rendering on toggle updates.
  let drive_updated_by_search = false // Flag to prevent `onbatch` from re-rendering on search updates.
  let drive_updated_by_last_clicked = false // Flag to prevent `onbatch` from re-rendering on last clicked node updates.
  let ignore_drive_updated_by_scroll = false // Prevent scroll flag.
  let drive_updated_by_match = false // Flag to prevent `onbatch` from re-rendering on matching entry updates.
  let drive_updated_by_tracking = false // Flag to prevent `onbatch` from re-rendering on view order tracking updates.
  let drive_updated_by_undo = false // Flag to prevent onbatch from re-rendering on undo updates
  let is_loading_from_drive = false // Flag to prevent saving to drive during initial load
  let multi_select_enabled = false // Flag to enable multi-select mode without ctrl key
  let select_between_enabled = false // Flag to enable select between mode
  let select_between_first_node = null // First node selected in select between mode
  let duplicate_entries_map = {}
  let view_order_tracking = {} // Tracks instance paths by base path in real time as they are added into the view through toggle expand/collapse actions.
  let is_rendering = false // Flag to prevent concurrent rendering operations in virtual scrolling.
  let spacer_element = null // DOM element used to manage scroll position when hubs are toggled.
  let spacer_initial_height = 0
  let hub_num = 0 // Counter for expanded hubs.
  let last_clicked_node = null // Track the last clicked node instance path for highlighting.
  let root_wand_state = null // Store original root wand state when replaced with jump button
  const manipulated_inside_search = {}
  let keybinds = {} // Store keyboard navigation bindings
  let undo_stack = [] // Stack to track drive state changes for undo functionality

  // Protocol system for message-based communication
  let send = null
  let graph_explorer_mid = 0 // Message ID counter for graph_explorer.js -> page.js messages
  if (protocol) {
    send = protocol(msg => onmessage(msg))
  }

  // Create db object that communicates via protocol messages
  db = create_db()

  const el = document.createElement('div')
  el.className = 'graph-explorer-wrapper'
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <div class="graph-container"></div>
    <div class="searchbar"></div>
    <div class="menubar"></div>
  `
  const searchbar = shadow.querySelector('.searchbar')
  const menubar = shadow.querySelector('.menubar')
  const container = shadow.querySelector('.graph-container')

  document.body.style.margin = 0

  let scroll_update_pending = false
  container.onscroll = onscroll

  let start_index = 0
  let end_index = 0
  const chunk_size = 50
  const max_rendered_nodes = chunk_size * 3
  let node_height

  const top_sentinel = document.createElement('div')
  const bottom_sentinel = document.createElement('div')

  const observer = new IntersectionObserver(handle_sentinel_intersection, {
    root: container,
    rootMargin: '500px 0px',
    threshold: 0
  })

  // Define handlers for different data types from the drive, called by `onbatch`.
  const on = {
    style: inject_style,
    runtime: on_runtime,
    mode: on_mode,
    flags: on_flags,
    keybinds: on_keybinds,
    undo: on_undo
  }
  // Start watching for state changes. This is the main trigger for all updates.
  await sdb.watch(onbatch)

  document.onkeydown = handle_keyboard_navigation

  return el

  /******************************************************************************
  ESSAGE HANDLING
    - Handles incoming messages and sends outgoing messages.
    - Messages follow standardized format: { head: [by, to, mid], refs, type, data }
  ******************************************************************************/
  function onmessage (msg) {
    const { type, data } = msg
    const on_message_types = {
      set_mode: handle_set_mode,
      set_search_query: handle_set_search_query,
      select_nodes: handle_select_nodes,
      expand_node: handle_expand_node,
      collapse_node: handle_collapse_node,
      toggle_node: handle_toggle_node,
      get_selected: handle_get_selected,
      get_confirmed: handle_get_confirmed,
      clear_selection: handle_clear_selection,
      set_flag: handle_set_flag,
      scroll_to_node: handle_scroll_to_node,
      db_response: handle_db_response,
      db_initialized: handle_db_initialized
    }

    const handler = on_message_types[type]
    if (handler) handler(data)
    else console.warn(`[graph_explorer-protocol] Unknown message type: ${type}`, msg)

    function handle_db_response () {
      db.handle_response(msg)
    }

    function handle_set_mode (data) {
      const { mode: new_mode } = data
      if (new_mode && ['default', 'menubar', 'search'].includes(new_mode)) {
        update_drive_state({ type: 'mode/current_mode', message: new_mode })
        send_message({ type: 'mode_changed', data: { mode: new_mode } })
      }
    }

    function handle_set_search_query (data) {
      const { query } = data
      if (typeof query === 'string') {
        search_query = query
        drive_updated_by_search = true
        update_drive_state({ type: 'mode/search_query', message: query })
        if (mode === 'search') perform_search(query)
        send_message({ type: 'search_query_changed', data: { query } })
      }
    }

    function handle_select_nodes (data) {
      const { instance_paths } = data
      if (Array.isArray(instance_paths)) {
        update_drive_state({ type: 'runtime/selected_instance_paths', message: instance_paths })
        send_message({ type: 'selection_changed', data: { selected: instance_paths } })
      }
    }

    function handle_expand_node (data) {
      const { instance_path, expand_subs = true, expand_hubs = false } = data
      if (instance_path && instance_states[instance_path]) {
        instance_states[instance_path].expanded_subs = expand_subs
        instance_states[instance_path].expanded_hubs = expand_hubs
        drive_updated_by_toggle = true
        update_drive_state({ type: 'runtime/instance_states', message: instance_states })
        send_message({ type: 'node_expanded', data: { instance_path, expand_subs, expand_hubs } })
      }
    }

    function handle_collapse_node (data) {
      const { instance_path } = data
      if (instance_path && instance_states[instance_path]) {
        instance_states[instance_path].expanded_subs = false
        instance_states[instance_path].expanded_hubs = false
        drive_updated_by_toggle = true
        update_drive_state({ type: 'runtime/instance_states', message: instance_states })
        send_message({ type: 'node_collapsed', data: { instance_path } })
      }
    }

    async function handle_toggle_node (data) {
      const { instance_path, toggle_type = 'subs' } = data
      if (instance_path && instance_states[instance_path]) {
        if (toggle_type === 'subs') {
          await toggle_subs(instance_path)
        } else if (toggle_type === 'hubs') {
          await toggle_hubs(instance_path)
        }
        send_message({ type: 'node_toggled', data: { instance_path, toggle_type } })
      }
    }

    function handle_get_selected (data) {
      send_message({ type: 'selected_nodes', data: { selected: selected_instance_paths } })
    }

    function handle_get_confirmed (data) {
      send_message({ type: 'confirmed_nodes', data: { confirmed: confirmed_instance_paths } })
    }

    function handle_clear_selection (data) {
      update_drive_state({ type: 'runtime/selected_instance_paths', message: [] })
      update_drive_state({ type: 'runtime/confirmed_selected', message: [] })
      send_message({ type: 'selection_cleared', data: {} })
    }

    function handle_set_flag (data) {
      const { flag_type, value } = data
      if (flag_type === 'hubs' && ['default', 'true', 'false'].includes(value)) {
        update_drive_state({ type: 'flags/hubs', message: value })
      } else if (flag_type === 'selection') {
        update_drive_state({ type: 'flags/selection', message: value })
      } else if (flag_type === 'recursive_collapse') {
        update_drive_state({ type: 'flags/recursive_collapse', message: value })
      }
      send_message({ type: 'flag_changed', data: { flag_type, value } })
    }

    function handle_scroll_to_node (data) {
      const { instance_path } = data
      const node_index = view.findIndex(n => n.instance_path === instance_path)
      if (node_index !== -1) {
        const scroll_position = node_index * node_height
        container.scrollTop = scroll_position
        send_message({ type: 'scrolled_to_node', data: { instance_path, scroll_position } })
      }
    }
  }
  async function handle_db_initialized (data) {
    // Page.js, trigger initial render
    // After receiving entries, ensure the root node state is initialized and trigger the first render.
    const root_path = '/'
    if (await db.has(root_path)) {
      const root_instance_path = '|/'
      if (!instance_states[root_instance_path]) {
        instance_states[root_instance_path] = {
          expanded_subs: true,
          expanded_hubs: false
        }
      }
      // don't rebuild view if we're in search mode with active query
      if (mode === 'search' && search_query) {
        console.log('[SEARCH DEBUG] on_entries: skipping build_and_render_view in Search Mode with query:', search_query)
        perform_search(search_query)
      } else {
        // tracking will be initialized later if drive data is empty
        build_and_render_view()
      }
    } else {
      console.warn('Root path "/" not found in entries. Clearing view.')
      view = []
      if (container) container.replaceChildren()
    }
  }
  function send_message (msg) {
    if (send) {
      send(msg)
    }
  }

  function create_db () {
    // Pending requests map: key is message head [by, to, mid], value is {resolve, reject}
    const pending_requests = new Map()

    return {
      // All operations are async via protocol messages
      get: (path) => send_db_request('db_get', { path }),
      has: (path) => send_db_request('db_has', { path }),
      is_empty: () => send_db_request('db_is_empty', {}),
      root: () => send_db_request('db_root', {}),
      keys: () => send_db_request('db_keys', {}),
      raw: () => send_db_request('db_raw', {}),
      // Handle responses from page.js
      handle_response: (msg) => {
        if (!msg.refs || !msg.refs.cause) {
          console.warn('[graph_explorer] Response missing refs.cause:', msg)
          return
        }
        const request_head_key = JSON.stringify(msg.refs.cause)
        const pending = pending_requests.get(request_head_key)
        if (pending) {
          pending.resolve(msg.data.result)
          pending_requests.delete(request_head_key)
        } else {
          console.warn('[graph_explorer] No pending request for response:', msg.refs.cause)
        }
      }
    }

    function send_db_request (operation, params) {
      return new Promise((resolve, reject) => {
        const head = ['graph_explorer', 'page_js', graph_explorer_mid++]
        const head_key = JSON.stringify(head)
        pending_requests.set(head_key, { resolve, reject })

        send_message({
          head,
          refs: null, // New request has no references
          type: operation,
          data: params
        })
      })
    }
  }

  /******************************************************************************
  STATE AND DATA HANDLING
    - These functions process incoming data from the STATE module's `sdb.watch`.
    - `onbatch` is the primary entry point.
  ******************************************************************************/
  async function onbatch (batch) {
    console.log('[SEARCH DEBUG] onbatch caled:', {
      mode,
      search_query,
      last_clicked_node,
      feedback_flags: {
        scroll: drive_updated_by_scroll,
        toggle: drive_updated_by_toggle,
        search: drive_updated_by_search,
        match: drive_updated_by_match,
        tracking: drive_updated_by_tracking
      }
    })

    // Prevent feedback loops from scroll or toggle actions.
    if (check_and_reset_feedback_flags()) {
      console.log('[SEARCH DEBUG] onbatch prevented by feedback flags')
      return
    }

    for (const { type, paths } of batch) {
      if (!paths || !paths.length) continue
      const data = await Promise.all(
        paths.map(path => batch_get(path))
      )
      // Call the appropriate handler based on `type`.
      const func = on[type]
      func ? await func({ data, paths }) : fail(data, type)
    }

    function batch_get (path) {
      return drive
        .get(path)
        .then(file => (file ? file.raw : null))
        .catch(e => {
          console.error(`Error getting file from drive: ${path}`, e)
          return null
        })
    }
  }

  function fail (data, type) {
    throw new Error(`Invalid message type: ${type}`, { cause: { data, type } })
  }

  async function on_runtime ({ data, paths }) {
    const on_runtime_paths = {
      'node_height.json': handle_node_height,
      'vertical_scroll_value.json': handle_vertical_scroll,
      'horizontal_scroll_value.json': handle_horizontal_scroll,
      'selected_instance_paths.json': handle_selected_paths,
      'confirmed_selected.json': handle_confirmed_paths,
      'instance_states.json': handle_instance_states,
      'search_entry_states.json': handle_search_entry_states,
      'last_clicked_node.json': handle_last_clicked_node,
      'view_order_tracking.json': handle_view_order_tracking
    }
    let needs_render = false
    const render_nodes_needed = new Set()

    paths.forEach((path, i) => runtime_handler(path, data[i]))

    if (needs_render) {
      if (mode === 'search' && search_query) {
        console.log('[SEARCH DEBUG] on_runtime: Skipping build_and_render_view in search mode with query:', search_query)
        await perform_search(search_query)
      } else {
        await build_and_render_view()
      }
    } else if (render_nodes_needed.size > 0) {
      render_nodes_needed.forEach(re_render_node)
    }

    function runtime_handler (path, data) {
      if (data === null) return
      const value = parse_json_data(data, path)
      if (value === null) return

      // Extract filename from path and use handler if available
      const filename = path.split('/').pop()
      const handler = on_runtime_paths[filename]
      if (handler) {
        const result = handler({ value, render_nodes_needed })
        if (result?.needs_render) needs_render = true
      }
    }

    function handle_node_height ({ value }) {
      node_height = value
    }

    function handle_vertical_scroll ({ value }) {
      if (typeof value === 'number') vertical_scroll_value = value
    }

    function handle_horizontal_scroll ({ value }) {
      if (typeof value === 'number') horizontal_scroll_value = value
    }

    function handle_selected_paths ({ value, render_nodes_needed }) {
      selected_instance_paths = process_path_array_update({
        current_paths: selected_instance_paths,
        value,
        render_set: render_nodes_needed,
        name: 'selected_instance_paths'
      })
    }

    function handle_confirmed_paths ({ value, render_nodes_needed }) {
      confirmed_instance_paths = process_path_array_update({
        current_paths: confirmed_instance_paths,
        value,
        render_set: render_nodes_needed,
        name: 'confirmed_selected'
      })
    }

    function handle_instance_states ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        instance_states = value
        return { needs_render: true }
      } else {
        console.warn('instance_states is not a valid object, ignoring.', value)
      }
    }

    function handle_search_entry_states ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        search_entry_states = value
        if (mode === 'search') return { needs_render: true }
      } else {
        console.warn('search_entry_states is not a valid object, ignoring.', value)
      }
    }

    function handle_last_clicked_node ({ value, render_nodes_needed }) {
      const old_last_clicked = last_clicked_node
      last_clicked_node = typeof value === 'string' ? value : null
      if (old_last_clicked) render_nodes_needed.add(old_last_clicked)
      if (last_clicked_node) render_nodes_needed.add(last_clicked_node)
    }

    function handle_view_order_tracking ({ value }) {
      if (typeof value === 'object' && value && !Array.isArray(value)) {
        is_loading_from_drive = true
        view_order_tracking = value
        is_loading_from_drive = false
        if (Object.keys(view_order_tracking).length === 0) {
          initialize_tracking_from_current_state()
        }
        return { needs_render: true }
      } else {
        console.warn('view_order_tracking is not a valid object, ignoring.', value)
      }
    }
  }

  async function on_mode ({ data, paths }) {
    const on_mode_paths = {
      'current_mode.json': handle_current_mode,
      'previous_mode.json': handle_previous_mode,
      'search_query.json': handle_search_query,
      'multi_select_enabled.json': handle_multi_select_enabled,
      'select_between_enabled.json': handle_select_between_enabled
    }
    let new_current_mode, new_previous_mode, new_search_query, new_multi_select_enabled, new_select_between_enabled

    paths.forEach((path, i) => mode_handler(path, data[i]))

    if (typeof new_search_query === 'string') search_query = new_search_query
    if (new_previous_mode) previous_mode = new_previous_mode
    if (typeof new_multi_select_enabled === 'boolean') {
      multi_select_enabled = new_multi_select_enabled
      render_menubar() // Re-render menubar to update button text
    }
    if (typeof new_select_between_enabled === 'boolean') {
      select_between_enabled = new_select_between_enabled
      if (!select_between_enabled) select_between_first_node = null
      render_menubar()
    }

    if (
      new_current_mode &&
      !['default', 'menubar', 'search'].includes(new_current_mode)
    ) {
      console.warn(`Invalid mode "${new_current_mode}" provided. Ignoring update.`)
      return
    }

    if (new_current_mode === 'search' && !search_query) {
      search_state_instances = instance_states
    }
    if (!new_current_mode || mode === new_current_mode) return

    if (mode && new_current_mode === 'search') update_drive_state({ type: 'mode/previous_mode', message: mode })
    mode = new_current_mode
    render_menubar()
    render_searchbar()
    await handle_mode_change()
    if (mode === 'search' && search_query) await perform_search(search_query)

    function mode_handler (path, data) {
      const value = parse_json_data(data, path)
      if (value === null) return

      const filename = path.split('/').pop()
      const handler = on_mode_paths[filename]
      if (handler) {
        const result = handler({ value })
        if (result?.current_mode !== undefined) new_current_mode = result.current_mode
        if (result?.previous_mode !== undefined) new_previous_mode = result.previous_mode
        if (result?.search_query !== undefined) new_search_query = result.search_query
        if (result?.multi_select_enabled !== undefined) new_multi_select_enabled = result.multi_select_enabled
        if (result?.select_between_enabled !== undefined) new_select_between_enabled = result.select_between_enabled
      }
    }
    function handle_current_mode ({ value }) {
      return { current_mode: value }
    }

    function handle_previous_mode ({ value }) {
      return { previous_mode: value }
    }

    function handle_search_query ({ value }) {
      return { search_query: value }
    }

    function handle_multi_select_enabled ({ value }) {
      return { multi_select_enabled: value }
    }

    function handle_select_between_enabled ({ value }) {
      return { select_between_enabled: value }
    }
  }

  function on_flags ({ data, paths }) {
    const on_flags_paths = {
      'hubs.json': handle_hubs_flag,
      'selection.json': handle_selection_flag,
      'recursive_collapse.json': handle_recursive_collapse_flag
    }

    paths.forEach((path, i) => flags_handler(path, data[i]))

    function flags_handler (path, data) {
      const value = parse_json_data(data, path)
      if (value === null) return

      const filename = path.split('/').pop()
      const handler = on_flags_paths[filename]
      if (handler) {
        const result = handler(value)
        if (result && result.needs_render) {
          if (mode === 'search' && search_query) {
            console.log('[SEARCH DEBUG] on_flags: Skipping build_and_render_view in search mode with query:', search_query)
            perform_search(search_query)
          } else {
            build_and_render_view()
          }
        }
      }
    }

    function handle_hubs_flag (value) {
      if (typeof value === 'string' && ['default', 'true', 'false'].includes(value)) {
        hubs_flag = value
        return { needs_render: true }
      } else {
        console.warn('hubs flag must be one of: "default", "true", "false", ignoring.', value)
      }
    }

    function handle_selection_flag (value) {
      selection_flag = value
      return { needs_render: true }
    }

    function handle_recursive_collapse_flag (value) {
      recursive_collapse_flag = value
      return { needs_render: false }
    }
  }

  function inject_style ({ data }) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  function on_keybinds ({ data }) {
    if (!data || data[0] == null) {
      console.error('Keybinds data is missing or empty.')
      return
    }
    const parsed_data = parse_json_data(data[0])
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed keybinds data is not a valid object.')
      return
    }
    keybinds = parsed_data
  }

  function on_undo ({ data }) {
    if (!data || data[0] == null) {
      console.error('Undo stack data is missing or empty.')
      return
    }
    const parsed_data = parse_json_data(data[0])
    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed undo stack data is not a valid Object.')
      return
    }
    undo_stack = parsed_data
  }

  // Helper to persist component state to the drive.
  async function update_drive_state ({ type, message }) {
    // Save current state to undo stack before updating (except for some)
    const should_track = (
      !drive_updated_by_undo &&
      !type.includes('scroll') &&
      !type.includes('last_clicked') &&
      !type.includes('view_order_tracking') &&
      !type.includes('select_between') &&
      type !== 'undo/stack'
    )
    if (should_track) {
      await save_to_undo_stack(type)
    }

    try {
      await drive.put(`${type}.json`, JSON.stringify(message))
    } catch (e) {
      const [dataset, name] = type.split('/')
      console.error(`Failed to update ${dataset} state for ${name}:`, e)
    }
    if (should_track) {
      render_menubar()
    }
  }

  async function save_to_undo_stack (type) {
    try {
      const current_file = await drive.get(`${type}.json`)
      if (current_file && current_file.raw) {
        const snapshot = {
          type,
          value: current_file.raw,
          timestamp: Date.now()
        }

        // Add to stack (limit to 50 items to prevent memory issues)
        undo_stack.push(snapshot)
        if (undo_stack.length > 50) {
          undo_stack.shift()
        }
        drive_updated_by_undo = true
        await drive.put('undo/stack.json', JSON.stringify(undo_stack))
      }
    } catch (e) {
      console.error('Failed to save to undo stack:', e)
    }
  }

  function get_or_create_state (states, instance_path) {
    if (!states[instance_path]) {
      states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    if (states[instance_path].expanded_subs === null) {
      states[instance_path].expanded_subs = true
    }

    return states[instance_path]
  }

  async function calculate_children_pipe_trail ({
    depth,
    is_hub,
    is_last_sub,
    is_first_hub = false,
    parent_pipe_trail,
    parent_base_path,
    base_path,
    db
  }) {
    const children_pipe_trail = [...parent_pipe_trail]
    const parent_entry = await db.get(parent_base_path)
    const is_hub_on_top = base_path === parent_entry?.hubs?.[0] || base_path === '/'

    if (depth > 0) {
      if (is_hub) {
        if (is_last_sub) {
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
        }
        if (is_hub_on_top && !is_last_sub) {
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
        }
        if (is_first_hub) {
          children_pipe_trail.pop()
          children_pipe_trail.push(false)
        }
      }
      children_pipe_trail.push(is_hub || !is_last_sub)
    }
    return { children_pipe_trail, is_hub_on_top }
  }

  // Extracted pipe logic for reuse in both default and search modes
  async function calculate_pipe_trail ({
    depth,
    is_hub,
    is_last_sub,
    is_first_hub = false,
    is_hub_on_top,
    parent_pipe_trail,
    parent_base_path,
    base_path,
    db
  }) {
    let last_pipe = null
    const parent_entry = await db.get(parent_base_path)
    const calculated_is_hub_on_top = base_path === parent_entry?.hubs?.[0] || base_path === '/'
    const final_is_hub_on_top = is_hub_on_top !== undefined ? is_hub_on_top : calculated_is_hub_on_top

    if (depth > 0) {
      if (is_hub) {
        last_pipe = [...parent_pipe_trail]
        if (is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
          if (is_first_hub) {
            last_pipe.pop()
            last_pipe.push(false)
          }
        }
        if (final_is_hub_on_top && !is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
        }
      }
    }

    const pipe_trail = (is_hub && is_last_sub) || (is_hub && final_is_hub_on_top) ? last_pipe : parent_pipe_trail
    const product = { pipe_trail, is_hub_on_top: final_is_hub_on_top }
    return product
  }

  /******************************************************************************
  VIEW AND RENDERING LOGIC AND SCALING
    - These functions build the `view` array and render the DOM.
    - `build_and_render_view` is the main orchestrator.
    - `build_view_recursive` creates the flat `view` array from the hierarchical data.
    - `calculate_mobile_scale` calculates the scale factor for mobile devices.
  ******************************************************************************/
  async function build_and_render_view (focal_instance_path, hub_toggle = false) {
    console.log('[SEARCH DEBUG] build_and_render_view called:', {
      focal_instance_path,
      hub_toggle,
      current_mode: mode,
      search_query,
      last_clicked_node,
      stack_trace: new Error().stack.split('\n').slice(1, 4).map(line => line.trim())
    })

    // This fuction should'nt be called in search mode for search
    if (mode === 'search' && search_query && !hub_toggle) {
      console.error('[SEARCH DEBUG] build_and_render_view called inappropriately in search mode!', {
        mode,
        search_query,
        focal_instance_path,
        stack_trace: new Error().stack.split('\n').slice(1, 6).map(line => line.trim())
      })
    }

    const is_empty = await db.is_empty()
    if (!db || is_empty) {
      console.warn('No entries available to render.')
      return
    }

    const old_view = [...view]
    const old_scroll_top = vertical_scroll_value
    const old_scroll_left = horizontal_scroll_value
    let existing_spacer_height = 0
    if (spacer_element && spacer_element.parentNode) existing_spacer_height = parseFloat(spacer_element.style.height) || 0

    // Recursively build the new `view` array from the graph data.
    view = await build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      db
    })

    // Recalculate duplicates after view is built
    collect_all_duplicate_entries()

    const new_scroll_top = calculate_new_scroll_top({
      old_scroll_top,
      old_view,
      focal_path: focal_instance_path
    })
    const render_anchor_index = Math.max(0, Math.floor(new_scroll_top / node_height))
    start_index = Math.max(0, render_anchor_index - chunk_size)
    end_index = Math.min(view.length, render_anchor_index + chunk_size)

    const fragment = document.createDocumentFragment()
    for (let i = start_index; i < end_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
    }

    container.replaceChildren(top_sentinel, fragment, bottom_sentinel)
    top_sentinel.style.height = `${start_index * node_height}px`
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`

    observer.observe(top_sentinel)
    observer.observe(bottom_sentinel)

    // Handle the spacer element used for keep entries static wrt cursor by scrolling when hubs are toggled.
    handle_spacer_element({
      hub_toggle,
      existing_height: existing_spacer_height,
      new_scroll_top,
      sync_fn: set_scroll_and_sync
    })

    function set_scroll_and_sync () {
      drive_updated_by_scroll = true
      container.scrollTop = new_scroll_top
      container.scrollLeft = old_scroll_left
      vertical_scroll_value = container.scrollTop
    }
  }

  // Traverses the hierarchical entries data and builds a flat `view` array for rendering.
  async function build_view_recursive ({
    base_path,
    parent_instance_path,
    parent_base_path = null,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub = false,
    parent_pipe_trail,
    instance_states,
    db
  }) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return []

    const state = get_or_create_state(instance_states, instance_path)

    const { children_pipe_trail, is_hub_on_top } = await calculate_children_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      db
    })

    const current_view = []
    // If hubs are expanded, recursively add them to the view first (they appear above the node).
    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      for (let i = 0; i < entry.hubs.length; i++) {
        const hub_path = entry.hubs[i]
        const hub_view = await build_view_recursive({
          base_path: hub_path,
          parent_instance_path: instance_path,
          parent_base_path: base_path,
          depth: depth + 1,
          is_last_sub: i === entry.hubs.length - 1,
          is_hub: true,
          is_first_hub: is_hub ? is_hub_on_top : false,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          db
        })
        current_view.push(...hub_view)
      }
    }

    // Calculate pipe_trail for this node
    const { pipe_trail, is_hub_on_top: calculated_is_hub_on_top } = await calculate_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      is_hub_on_top,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      db
    })

    current_view.push({
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      entry, // Include entry data in view to avoid async lookups during rendering
      pipe_trail, // Pre-calculated pipe trail
      is_hub_on_top: calculated_is_hub_on_top // Pre-calculated hub position
    })

    // If subs are expanded, recursively add them to the view (they appear below the node).
    if (state.expanded_subs && Array.isArray(entry.subs)) {
      for (let i = 0; i < entry.subs.length; i++) {
        const sub_path = entry.subs[i]
        const sub_view = await build_view_recursive({
          base_path: sub_path,
          parent_instance_path: instance_path,
          parent_base_path: base_path,
          depth: depth + 1,
          is_last_sub: i === entry.subs.length - 1,
          is_hub: false,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          db
        })
        current_view.push(...sub_view)
      }
    }
    return current_view
  }

  /******************************************************************************
 4. NODE CREATION AND EVENT HANDLING
   - `create_node` generates the DOM element for a single node.
   - It sets up event handlers for user interactions like selecting or toggling.
  ******************************************************************************/

  function create_node ({
    base_path,
    instance_path,
    depth,
    is_last_sub,
    is_hub,
    is_search_match,
    is_direct_match,
    is_in_original_view,
    query,
    entry, // Entry data is now passed from view
    pipe_trail, // Pre-calculated pipe trail
    is_hub_on_top // Pre-calculated hub position
  }) {
    if (!entry) {
      const err_el = document.createElement('div')
      err_el.className = 'node error'
      err_el.textContent = `Error: Missing entry for ${base_path}`
      return err_el
    }

    let states
    if (mode === 'search') {
      if (manipulated_inside_search[instance_path]) {
        search_entry_states[instance_path] = manipulated_inside_search[instance_path]
        states = search_entry_states
      } else {
        states = search_state_instances
      }
    } else {
      states = instance_states
    }
    const state = get_or_create_state(states, instance_path)

    const el = document.createElement('div')
    el.className = `node type-${entry.type || 'unknown'}`
    el.dataset.instance_path = instance_path
    if (is_search_match) {
      el.classList.add('search-result')
      if (is_direct_match) el.classList.add('direct-match')
      if (!is_in_original_view) el.classList.add('new-entry')
    }

    if (selected_instance_paths.includes(instance_path)) el.classList.add('selected')
    if (confirmed_instance_paths.includes(instance_path)) el.classList.add('confirmed')
    if (last_clicked_node === instance_path) {
      mode === 'search' ? el.classList.add('search-last-clicked') : el.classList.add('last-clicked')
    }

    const has_hubs = hubs_flag === 'false' ? false : Array.isArray(entry.hubs) && entry.hubs.length > 0
    const has_subs = Array.isArray(entry.subs) && entry.subs.length > 0

    if (depth) {
      el.classList.add('left-indent')
    }

    if (base_path === '/' && instance_path === '|/') return create_root_node({ state, has_subs, instance_path })
    const prefix_class_name = get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top })
    // Use pre-calculated pipe_trail
    const pipe_html = pipe_trail.map(p => `<span class="${p ? 'pipe' : 'blank'}"></span>`).join('')
    const prefix_class = has_subs ? 'prefix clickable' : 'prefix'
    const icon_class = has_hubs && base_path !== '/' ? 'icon clickable' : 'icon'
    const entry_name = entry.name || base_path
    const name_html = (is_direct_match && query)
      ? get_highlighted_name(entry_name, query)
      : entry_name

    // Check if this entry appears elsewhere in the view (any duplicate)
    let has_duplicate_entries = false
    let is_first_occurrence = false
    if (hubs_flag !== 'true') {
      has_duplicate_entries = has_duplicates(base_path)

      // coloring class for duplicates
      if (has_duplicate_entries) {
        is_first_occurrence = is_first_duplicate(base_path, instance_path)
        if (is_first_occurrence) {
          el.classList.add('first-matching-entry')
        } else {
          el.classList.add('matching-entry')
        }
      }
    }

    el.innerHTML = `
      <span class="indent">${pipe_html}</span>
      <span class="${prefix_class} ${prefix_class_name}"></span>
      <span class="${icon_class}"></span>
      <span class="name ${has_duplicate_entries && !is_first_occurrence ? '' : 'clickable'}">${name_html}</span>
    `

    // For matching entries, disable normal event listener and add handler to whole entry to create button for jump to next duplicate
    if (has_duplicate_entries && !is_first_occurrence && hubs_flag !== 'true') {
      el.onclick = jump_out_to_next_duplicate
    } else {
      const icon_el = el.querySelector('.icon')
      if (icon_el && has_hubs && base_path !== '/') {
        icon_el.onclick = (mode === 'search' && search_query)
          ? () => toggle_search_hubs(instance_path)
          : () => toggle_hubs(instance_path)
      }

      // Add click event to the whole first part (indent + prefix) for expanding/collapsing subs
      if (has_subs) {
        const indent_el = el.querySelector('.indent')
        const prefix_el = el.querySelector('.prefix')

        const toggle_subs_handler = (mode === 'search' && search_query)
          ? () => toggle_search_subs(instance_path)
          : () => toggle_subs(instance_path)

        if (indent_el) indent_el.onclick = toggle_subs_handler
        if (prefix_el) prefix_el.onclick = toggle_subs_handler
      }

      // Special handling for first duplicate entry - it should have normal select behavior but also show jump button
      const name_el = el.querySelector('.name')
      if (selection_flag !== false) {
        if (has_duplicate_entries && is_first_occurrence && hubs_flag !== 'true') {
          name_el.onclick = ev => jump_and_select_matching_entry(ev, instance_path)
        } else {
          name_el.onclick = ev => mode === 'search' ? handle_search_name_click(ev, instance_path) : select_node(ev, instance_path)
        }
      } else {
        name_el.onclick = () => handle_last_clicked_node(instance_path)
      }

      function handle_last_clicked_node (instance_path) {
        last_clicked_node = instance_path
        drive_updated_by_last_clicked = true
        update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })
        update_last_clicked_styling(instance_path)
      }
    }

    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) el.appendChild(create_confirm_checkbox(instance_path))

    return el
    function jump_and_select_matching_entry (ev, instance_path) {
      if (mode === 'search') {
        handle_search_name_click(ev, instance_path)
      } else {
        select_node(ev, instance_path)
      }
      // Also add jump button functionality for first occurrence
      setTimeout(() => add_jump_button_to_matching_entry(el, base_path, instance_path), 10)
    }
    function jump_out_to_next_duplicate () {
      last_clicked_node = instance_path
      drive_updated_by_match = true
      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })
      update_last_clicked_styling(instance_path)
      add_jump_button_to_matching_entry(el, base_path, instance_path)
    }
  }

  // `re_render_node` updates a single node in the DOM, used when only its selection state changes.
  function re_render_node (instance_path) {
    const node_data = view.find(n => n.instance_path === instance_path)
    if (node_data) {
      const old_node_el = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
      if (old_node_el) old_node_el.replaceWith(create_node(node_data))
    }
  }

  // `get_prefix` determines which box-drawing character to use for the node's prefix. It gives the name of a specific CSS class.
  function get_prefix ({ is_last_sub, has_subs, state, is_hub, is_hub_on_top }) {
    if (!state) {
      console.error('get_prefix called with invalid state.')
      return 'middle-line'
    }

    // Define handlers for different prefix types based on node position
    const on_prefix_types = {
      hub_on_top: get_hub_on_top_prefix,
      hub_not_on_top: get_hub_not_on_top_prefix,
      last_sub: get_last_sub_prefix,
      middle_sub: get_middle_sub_prefix
    }
    // Determine the prefix type based on node position
    let prefix_type
    if (is_hub && is_hub_on_top) prefix_type = 'hub_on_top'
    else if (is_hub && !is_hub_on_top) prefix_type = 'hub_not_on_top'
    else if (is_last_sub) prefix_type = 'last_sub'
    else prefix_type = 'middle_sub'

    const handler = on_prefix_types[prefix_type]

    return handler ? handler({ state, has_subs }) : 'middle-line'

    function get_hub_on_top_prefix ({ state }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'top-cross'
      if (expanded_subs) return 'top-tee-down'
      if (expanded_hubs) return 'top-tee-up'
      return 'top-line'
    }

    function get_hub_not_on_top_prefix ({ state }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return 'middle-tee-up'
      return 'middle-line'
    }

    function get_last_sub_prefix ({ state, has_subs }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'bottom-cross'
      if (expanded_subs) return 'bottom-tee-down'
      if (expanded_hubs) return has_subs ? 'bottom-tee-up' : 'bottom-light-tee-up'
      return has_subs ? 'bottom-line' : 'bottom-light-line'
    }

    function get_middle_sub_prefix ({ state, has_subs }) {
      const { expanded_subs, expanded_hubs } = state
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return has_subs ? 'middle-tee-up' : 'middle-light-tee-up'
      return has_subs ? 'middle-line' : 'middle-light-line'
    }
  }

  /******************************************************************************
  MENUBAR AND SEARCH
  ******************************************************************************/
  function render_menubar () {
    const search_button = document.createElement('button')
    search_button.textContent = 'Search'
    search_button.onclick = toggle_search_mode

    const undo_button = document.createElement('button')
    undo_button.textContent = `Undo (${undo_stack.length})`
    undo_button.onclick = () => undo(1)
    undo_button.disabled = undo_stack.length === 0

    const multi_select_button = document.createElement('button')
    multi_select_button.textContent = `Multi Select: ${multi_select_enabled}`
    multi_select_button.onclick = toggle_multi_select

    const select_between_button = document.createElement('button')
    select_between_button.textContent = `Select Between: ${select_between_enabled}`
    select_between_button.onclick = toggle_select_between

    const hubs_button = document.createElement('button')
    hubs_button.textContent = `Hubs: ${hubs_flag}`
    hubs_button.onclick = toggle_hubs_flag

    const selection_button = document.createElement('button')
    selection_button.textContent = `Selection: ${selection_flag}`
    selection_button.onclick = toggle_selection_flag

    const recursive_collapse_button = document.createElement('button')
    recursive_collapse_button.textContent = `Recursive Collapse: ${recursive_collapse_flag}`
    recursive_collapse_button.onclick = toggle_recursive_collapse_flag

    menubar.replaceChildren(search_button, undo_button, multi_select_button, select_between_button, hubs_button, selection_button, recursive_collapse_button)
  }

  function render_searchbar () {
    if (mode !== 'search') {
      searchbar.style.display = 'none'
      searchbar.replaceChildren()
      return
    }

    const search_opts = {
      type: 'text',
      placeholder: 'Search entries...',
      className: 'search-input',
      value: search_query,
      oninput: on_search_input
    }
    searchbar.style.display = 'flex'
    const search_input = Object.assign(document.createElement('input'), search_opts)

    searchbar.replaceChildren(search_input)
    requestAnimationFrame(() => search_input.focus())
  }

  async function handle_mode_change () {
    menubar.style.display = mode === 'default' ? 'none' : 'flex'
    render_searchbar()
    await build_and_render_view()
  }

  async function toggle_search_mode () {
    const target_mode = mode === 'search' ? previous_mode : 'search'
    console.log('[SEARCH DEBUG] Switching mode from', mode, 'to', target_mode)
    send_message({ type: 'mode_toggling', data: { from: mode, to: target_mode } })
    if (mode === 'search') {
      // When switching from search to default mode, expand selected entries
      if (selected_instance_paths.length > 0) {
        console.log('[SEARCH DEBUG] Expanding selected entries in default mode:', selected_instance_paths)
        await expand_selected_entries_in_default(selected_instance_paths)
        drive_updated_by_toggle = true
        update_drive_state({ type: 'runtime/instance_states', message: instance_states })
      }
      // Reset select-between mode when leaving search mode
      if (select_between_enabled) {
        select_between_enabled = false
        select_between_first_node = null
        update_drive_state({ type: 'mode/select_between_enabled', message: false })
        console.log('[SEARCH DEBUG] Reset select-between mode when leaving search')
      }
      search_query = ''
      update_drive_state({ type: 'mode/search_query', message: '' })
    }
    ignore_drive_updated_by_scroll = true
    update_drive_state({ type: 'mode/current_mode', message: target_mode })
    search_state_instances = instance_states
    send_message({ type: 'mode_changed', data: { mode: target_mode } })
  }

  function toggle_multi_select () {
    multi_select_enabled = !multi_select_enabled
    // Disable select between when enabling multi select
    if (multi_select_enabled && select_between_enabled) {
      select_between_enabled = false
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: false })
    }
    update_drive_state({ type: 'mode/multi_select_enabled', message: multi_select_enabled })
    render_menubar() // Re-render to update button text
  }

  function toggle_select_between () {
    select_between_enabled = !select_between_enabled
    select_between_first_node = null // Reset first node selection
    // Disable multi select when enabling select between
    if (select_between_enabled && multi_select_enabled) {
      multi_select_enabled = false
      update_drive_state({ type: 'mode/multi_select_enabled', message: false })
    }
    update_drive_state({ type: 'mode/select_between_enabled', message: select_between_enabled })
    render_menubar() // Re-render to update button text
  }

  function toggle_hubs_flag () {
    const values = ['default', 'true', 'false']
    const current_index = values.indexOf(hubs_flag)
    const next_index = (current_index + 1) % values.length
    hubs_flag = values[next_index]
    update_drive_state({ type: 'flags/hubs', message: hubs_flag })
    render_menubar()
  }

  function toggle_selection_flag () {
    selection_flag = !selection_flag
    update_drive_state({ type: 'flags/selection', message: selection_flag })
    render_menubar()
  }

  function toggle_recursive_collapse_flag () {
    recursive_collapse_flag = !recursive_collapse_flag
    update_drive_state({ type: 'flags/recursive_collapse', message: recursive_collapse_flag })
    render_menubar()
  }

  function on_search_input (event) {
    search_query = event.target.value.trim()
    drive_updated_by_search = true
    update_drive_state({ type: 'mode/search_query', message: search_query })
    if (search_query === '') search_state_instances = instance_states
    perform_search(search_query)
  }

  async function perform_search (query) {
    console.log('[SEARCH DEBUG] perform_search called:', {
      query,
      current_mode: mode,
      search_query_var: search_query,
      has_search_entry_states: Object.keys(search_entry_states).length > 0,
      last_clicked_node
    })
    if (!query) {
      console.log('[SEARCH DEBUG] No query provided, building default view')
      return build_and_render_view()
    }

    const original_view = await build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      db
    })
    const original_view_paths = original_view.map(n => n.instance_path)
    search_state_instances = {}
    const search_tracking = {}
    const search_view = await build_search_view_recursive({
      query,
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub: true,
      is_hub: false,
      is_first_hub: false,
      parent_pipe_trail: [],
      instance_states: search_state_instances,
      db,
      original_view_paths,
      is_expanded_child: false,
      search_tracking
    })
    console.log('[SEARCH DEBUG] Search view built:', search_view.length)
    render_search_results(search_view, query)
  }

  async function build_search_view_recursive ({
    query,
    base_path,
    parent_instance_path,
    parent_base_path = null,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub = false,
    parent_pipe_trail,
    instance_states,
    db,
    original_view_paths,
    is_expanded_child = false,
    search_tracking = {}
  }) {
    const entry = await db.get(base_path)
    if (!entry) return []

    const instance_path = `${parent_instance_path}|${base_path}`
    const is_direct_match = entry.name && entry.name.toLowerCase().includes(query.toLowerCase())

    // track instance for duplicate detection
    if (!search_tracking[base_path]) search_tracking[base_path] = []
    const is_first_occurrence_in_search = !search_tracking[base_path].length
    search_tracking[base_path].push(instance_path)

    // Use extracted pipe logic for consistent rendering
    const { children_pipe_trail, is_hub_on_top } = await calculate_children_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      db
    })

    // Process hubs if they should be expanded
    const search_state = search_entry_states[instance_path]
    const should_expand_hubs = search_state ? search_state.expanded_hubs : false
    const should_expand_subs = search_state ? search_state.expanded_subs : false

    // Process hubs: if manually expanded, show ALL hubs regardless of search match
    const hub_results = []
    if (should_expand_hubs && entry.hubs) {
      for (let i = 0; i < entry.hubs.length; i++) {
        const hub_path = entry.hubs[i]
        const hub_view = await build_search_view_recursive({
          query,
          base_path: hub_path,
          parent_instance_path: instance_path,
          parent_base_path: base_path,
          depth: depth + 1,
          is_last_sub: i === entry.hubs.length - 1,
          is_hub: true,
          is_first_hub: is_hub_on_top,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          db,
          original_view_paths,
          is_expanded_child: true,
          search_tracking
        })
        hub_results.push(...hub_view)
      }
    }

    // Handle subs: if manually expanded, show ALL children; otherwise, search through them
    const sub_results = []
    if (should_expand_subs) {
      // Show ALL subs when manually expanded
      if (entry.subs) {
        for (let i = 0; i < entry.subs.length; i++) {
          const sub_path = entry.subs[i]
          const sub_view = await build_search_view_recursive({
            query,
            base_path: sub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
            depth: depth + 1,
            is_last_sub: i === entry.subs.length - 1,
            is_hub: false,
            is_first_hub: false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            db,
            original_view_paths,
            is_expanded_child: true,
            search_tracking
          })
          sub_results.push(...sub_view)
        }
      }
    } else if (!is_expanded_child && is_first_occurrence_in_search) {
      // Only search through subs for the first occurrence of this base_path
      if (entry.subs) {
        for (let i = 0; i < entry.subs.length; i++) {
          const sub_path = entry.subs[i]
          const sub_view = await build_search_view_recursive({
            query,
            base_path: sub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
            depth: depth + 1,
            is_last_sub: i === entry.subs.length - 1,
            is_hub: false,
            is_first_hub: false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            db,
            original_view_paths,
            is_expanded_child: false,
            search_tracking
          })
          sub_results.push(...sub_view)
        }
      }
    }

    const has_matching_descendant = sub_results.length > 0

    // If this is an expanded child, always include it regardless of search match
    // only include if it's the first occurrence OR if a dirct match
    if (!is_expanded_child && !is_direct_match && !has_matching_descendant) return []
    if (!is_expanded_child && !is_first_occurrence_in_search && !is_direct_match) return []

    const final_expand_subs = search_state ? search_state.expanded_subs : (has_matching_descendant && is_first_occurrence_in_search)
    const final_expand_hubs = search_state ? search_state.expanded_hubs : false

    instance_states[instance_path] = { expanded_subs: final_expand_subs, expanded_hubs: final_expand_hubs }
    const is_in_original_view = original_view_paths.includes(instance_path)

    // Calculate pipe_trail for this search node
    const { pipe_trail, is_hub_on_top: calculated_is_hub_on_top } = await calculate_pipe_trail({
      depth,
      is_hub,
      is_last_sub,
      is_first_hub,
      is_hub_on_top,
      parent_pipe_trail,
      parent_base_path,
      base_path,
      db
    })

    const current_node_view = {
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      is_first_hub,
      parent_pipe_trail,
      parent_base_path,
      is_search_match: true,
      is_direct_match,
      is_in_original_view,
      entry, // Include entry data
      pipe_trail, // Pre-calculated pipe trail
      is_hub_on_top: calculated_is_hub_on_top // Pre-calculated hub position
    }

    return [...hub_results, current_node_view, ...sub_results]
  }

  function render_search_results (search_view, query) {
    view = search_view
    if (search_view.length === 0) {
      const no_results_el = document.createElement('div')
      no_results_el.className = 'no-results'
      no_results_el.textContent = `No results for "${query}"`
      return container.replaceChildren(no_results_el)
    }

    // temporary tracking map for search results to detect duplicates
    const search_tracking = {}
    search_view.forEach(node => set_search_tracking(node))

    const original_tracking = view_order_tracking
    view_order_tracking = search_tracking
    collect_all_duplicate_entries()

    const fragment = document.createDocumentFragment()
    search_view.forEach(node_data => fragment.appendChild(create_node({ ...node_data, query })))
    container.replaceChildren(fragment)

    view_order_tracking = original_tracking

    function set_search_tracking (node) {
      const { base_path, instance_path } = node
      if (!search_tracking[base_path]) search_tracking[base_path] = []
      search_tracking[base_path].push(instance_path)
    }
  }

  /******************************************************************************
  VIEW MANIPULATION & USER ACTIONS
      - These functions handle user interactions like selecting, confirming,
        toggling, and resetting the graph.
  ******************************************************************************/
  function select_node (ev, instance_path) {
    last_clicked_node = instance_path
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })
    send_message({ type: 'node_clicked', data: { instance_path } })

    // Handle shift+click to enable select between mode temporarily
    if (ev.shiftKey && !select_between_enabled) {
      select_between_enabled = true
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: true })
      render_menubar()
    }

    const new_selected = new Set(selected_instance_paths)

    if (select_between_enabled) {
      handle_select_between(instance_path, new_selected)
    } else if (ev.ctrlKey || multi_select_enabled) {
      new_selected.has(instance_path) ? new_selected.delete(instance_path) : new_selected.add(instance_path)
      update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
      send_message({ type: 'selection_changed', data: { selected: [...new_selected] } })
    } else {
      update_drive_state({ type: 'runtime/selected_instance_paths', message: [instance_path] })
      send_message({ type: 'selection_changed', data: { selected: [instance_path] } })
    }
  }

  function handle_select_between (instance_path, new_selected) {
    if (!select_between_first_node) {
      select_between_first_node = instance_path
    } else {
      const first_index = view.findIndex(n => n.instance_path === select_between_first_node)
      const second_index = view.findIndex(n => n.instance_path === instance_path)

      if (first_index !== -1 && second_index !== -1) {
        const start_index = Math.min(first_index, second_index)
        const end_index = Math.max(first_index, second_index)

        // Toggle selection for all nodes in the range
        for (let i = start_index; i <= end_index; i++) {
          const node_instance_path = view[i].instance_path
          new_selected.has(node_instance_path) ? new_selected.delete(node_instance_path) : new_selected.add(node_instance_path)
        }

        update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
      }

      // Reset select between mode after second click
      select_between_enabled = false
      select_between_first_node = null
      update_drive_state({ type: 'mode/select_between_enabled', message: false })
      render_menubar()
    }
  }

  // Add the clicked entry and all its parents in the default tree
  async function expand_entry_path_in_default (target_instance_path) {
    console.log('[SEARCH DEBUG] search_expand_into_default called:', {
      target_instance_path,
      current_mode: mode,
      search_query,
      previous_mode,
      current_search_entry_states: Object.keys(search_entry_states).length,
      current_instance_states: Object.keys(instance_states).length
    })

    if (!target_instance_path) {
      console.warn('[SEARCH DEBUG] No target_instance_path provided')
      return
    }

    const parts = target_instance_path.split('|').filter(Boolean)
    if (parts.length === 0) {
      console.warn('[SEARCH DEBUG] No valid parts found in instance path:', target_instance_path)
      return
    }

    console.log('[SEARCH DEBUG] Parsed instance path parts:', parts)

    const root_state = get_or_create_state(instance_states, '|/')
    root_state.expanded_subs = true

    // Walk from root to target, expanding the path relative to already expanded entries
    for (let i = 0; i < parts.length - 1; i++) {
      const parent_base = parts[i]
      const child_base = parts[i + 1]
      const parent_instance_path = parts.slice(0, i + 1).map(p => '|' + p).join('')
      const parent_state = get_or_create_state(instance_states, parent_instance_path)
      const parent_entry = await db.get(parent_base)

      console.log('[SEARCH DEBUG] Processing parent-child relationship:', {
        parent_base,
        child_base,
        parent_instance_path,
        has_parent_entry: !!parent_entry
      })

      if (!parent_entry) continue
      if (Array.isArray(parent_entry.subs) && parent_entry.subs.includes(child_base)) {
        parent_state.expanded_subs = true
        console.log('[SEARCH DEBUG] Expanded subs for:', parent_instance_path)
      }
      if (Array.isArray(parent_entry.hubs) && parent_entry.hubs.includes(child_base)) {
        parent_state.expanded_hubs = true
        console.log('[SEARCH DEBUG] Expanded hubs for:', parent_instance_path)
      }
    }
  }

  // expand multiple selected entry in the default tree
  async function expand_selected_entries_in_default (selected_paths) {
    console.log('[SEARCH DEBUG] expand_selected_entries_in_default called:', {
      selected_paths,
      current_mode: mode,
      search_query,
      previous_mode
    })

    if (!Array.isArray(selected_paths) || selected_paths.length === 0) {
      console.warn('[SEARCH DEBUG] No valid selected paths provided')
      return
    }

    // expand foreach selected path
    for (const path of selected_paths) {
      await expand_entry_path_in_default(path)
    }

    console.log('[SEARCH DEBUG] All selected entries expanded in default mode')
  }

  // Add the clicked entry and all its parents in the default tree
  async function search_expand_into_default (target_instance_path) {
    if (!target_instance_path) {
      return
    }

    handle_search_node_click(target_instance_path)
    await expand_entry_path_in_default(target_instance_path)

    console.log('[SEARCH DEBUG] Current mode before switch:', mode)
    console.log('[SEARCH DEBUG] Target previous_mode:', previous_mode)

    // Persist selection and expansion state
    update_drive_state({ type: 'runtime/selected_instance_paths', message: [target_instance_path] })
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
    search_query = ''
    update_drive_state({ type: 'mode/search_query', message: '' })

    console.log('[SEARCH DEBUG] About to switch from search mode to:', previous_mode)
    update_drive_state({ type: 'mode/current_mode', message: previous_mode })
  }

  function handle_confirm (ev, instance_path) {
    if (!ev.target) return
    const is_checked = ev.target.checked
    const new_selected = new Set(selected_instance_paths)
    const new_confirmed = new Set(confirmed_instance_paths)

    // use specific logic for mode
    if (mode === 'search') {
      handle_search_node_click(instance_path)
    } else {
      last_clicked_node = instance_path
      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })
    }

    if (is_checked) {
      new_selected.delete(instance_path)
      new_confirmed.add(instance_path)
    } else {
      new_selected.add(instance_path)
      new_confirmed.delete(instance_path)
    }

    update_drive_state({ type: 'runtime/selected_instance_paths', message: [...new_selected] })
    update_drive_state({ type: 'runtime/confirmed_selected', message: [...new_confirmed] })
  }

  async function toggle_subs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    const was_expanded = state.expanded_subs
    state.expanded_subs = !state.expanded_subs

    // Update view order tracking for the toggled subs
    const base_path = instance_path.split('|').pop()
    const entry = await db.get(base_path)

    if (entry && Array.isArray(entry.subs)) {
      if (was_expanded && recursive_collapse_flag === true) {
        for (const sub_path of entry.subs) {
          await collapse_and_remove_instance(sub_path, instance_path, instance_states, db)
        }
      } else {
        for (const sub_path of entry.subs) {
          await toggle_subs_instance(sub_path, instance_path, instance_states, db)
        }
      }
    }

    last_clicked_node = instance_path
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    build_and_render_view(instance_path)
    // Set a flag to prevent the subsequent `onbatch` call from causing a render loop.
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
    send_message({ type: 'subs_toggled', data: { instance_path, expanded: state.expanded_subs } })

    async function toggle_subs_instance (sub_path, instance_path, instance_states, db) {
      if (was_expanded) {
        // Collapsing so
        await remove_instances_recursively(sub_path, instance_path, instance_states, db)
      } else {
        // Expanding so
        await add_instances_recursively(sub_path, instance_path, instance_states, db)
      }
    }

    async function collapse_and_remove_instance (sub_path, instance_path, instance_states, db) {
      await collapse_subs_recursively(sub_path, instance_path, instance_states, db)
      await remove_instances_recursively(sub_path, instance_path, instance_states, db)
    }
  }

  async function toggle_hubs (instance_path) {
    const state = get_or_create_state(instance_states, instance_path)
    const was_expanded = state.expanded_hubs
    state.expanded_hubs ? hub_num-- : hub_num++
    state.expanded_hubs = !state.expanded_hubs

    // Update view order tracking for the toggled hubs
    const base_path = instance_path.split('|').pop()
    const entry = await db.get(base_path)

    if (entry && Array.isArray(entry.hubs)) {
      if (was_expanded && recursive_collapse_flag === true) {
        // collapse all hub descendants
        for (const hub_path of entry.hubs) {
          await collapse_and_remove_instance(hub_path, instance_path, instance_states, db)
        }
      } else {
        // only toggle direct hubs
        for (const hub_path of entry.hubs) {
          await toggle_hubs_instance(hub_path, instance_path, instance_states, db)
        }
      }

      async function collapse_and_remove_instance (hub_path, instance_path, instance_states, db) {
        await collapse_hubs_recursively(hub_path, instance_path, instance_states, db)
        await remove_instances_recursively(hub_path, instance_path, instance_states, db)
      }
    }

    last_clicked_node = instance_path
    drive_updated_by_scroll = true // Prevent onbatch interference with hub spacer
    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    build_and_render_view(instance_path, true)
    drive_updated_by_toggle = true
    update_drive_state({ type: 'runtime/instance_states', message: instance_states })
    send_message({ type: 'hubs_toggled', data: { instance_path, expanded: state.expanded_hubs } })

    async function toggle_hubs_instance (hub_path, instance_path, instance_states, db) {
      if (was_expanded) {
        // Collapsing so
        await remove_instances_recursively(hub_path, instance_path, instance_states, db)
      } else {
        // Expanding so
        await add_instances_recursively(hub_path, instance_path, instance_states, db)
      }
    }
  }

  async function toggle_search_subs (instance_path) {
    console.log('[SEARCH DEBUG] toggle_search_subs called:', {
      instance_path,
      mode,
      search_query,
      current_state: search_entry_states[instance_path]?.expanded_subs || false,
      recursive_collapse_flag
    })

    const state = get_or_create_state(search_entry_states, instance_path)
    const old_expanded = state.expanded_subs
    state.expanded_subs = !state.expanded_subs

    if (old_expanded && recursive_collapse_flag === true) {
      const base_path = instance_path.split('|').pop()
      const entry = await db.get(base_path)
      if (entry && Array.isArray(entry.subs)) entry.subs.forEach(sub_path => collapse_search_subs_recursively(sub_path, instance_path, search_entry_states, db))
    }

    const has_matching_descendant = search_state_instances[instance_path]?.expanded_subs ? null : true
    const has_matching_parents = manipulated_inside_search[instance_path] ? search_entry_states[instance_path]?.expanded_hubs : search_state_instances[instance_path]?.expanded_hubs
    manipulated_inside_search[instance_path] = { expanded_hubs: has_matching_parents, expanded_subs: has_matching_descendant }
    console.log('[SEARCH DEBUG] Toggled subs state:', {
      instance_path,
      old_expanded,
      new_expanded: state.expanded_subs,
      recursive_state: old_expanded && recursive_collapse_flag === true
    })

    handle_search_node_click(instance_path)

    perform_search(search_query)
    drive_updated_by_search = true
    update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
  }

  async function toggle_search_hubs (instance_path) {
    console.log('[SEARCH DEBUG] toggle_search_hubs called:', {
      instance_path,
      mode,
      search_query,
      current_state: search_entry_states[instance_path]?.expanded_hubs || false,
      recursive_collapse_flag
    })

    const state = get_or_create_state(search_entry_states, instance_path)
    const old_expanded = state.expanded_hubs
    state.expanded_hubs = !state.expanded_hubs

    if (old_expanded && recursive_collapse_flag === true) {
      const base_path = instance_path.split('|').pop()
      const entry = await db.get(base_path)
      if (entry && Array.isArray(entry.hubs)) entry.hubs.forEach(hub_path => collapse_search_hubs_recursively(hub_path, instance_path, search_entry_states, db))
    }

    const has_matching_descendant = search_state_instances[instance_path]?.expanded_subs
    manipulated_inside_search[instance_path] = { expanded_hubs: state.expanded_hubs, expanded_subs: has_matching_descendant }
    console.log('[SEARCH DEBUG] Toggled hubs state:', {
      instance_path,
      old_expanded,
      new_expanded: state.expanded_hubs,
      recursive_state: old_expanded && recursive_collapse_flag === true
    })

    handle_search_node_click(instance_path)

    console.log('[SEARCH DEBUG] About to perform_search after toggle_search_hubs')
    perform_search(search_query)
    drive_updated_by_search = true
    update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
    console.log('[SEARCH DEBUG] toggle_search_hubs completed')
  }

  function handle_search_node_click (instance_path) {
    console.log('[SEARCH DEBUG] handle_search_node_click called:', {
      instance_path,
      current_mode: mode,
      search_query,
      previous_last_clicked: last_clicked_node
    })

    if (mode !== 'search') {
      console.warn('[SEARCH DEBUG] handle_search_node_click called but not in search mode!', {
        current_mode: mode,
        instance_path
      })
      return
    }

    // we need to handle last_clicked_node differently
    const old_last_clicked = last_clicked_node
    last_clicked_node = instance_path

    console.log('[SEARCH DEBUG] Updating last_clicked_node:', {
      old_value: old_last_clicked,
      new_value: last_clicked_node,
      mode,
      search_query
    })

    update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

    // Update visual styling for search mode nodes
    update_search_last_clicked_styling(instance_path)
  }

  function update_search_last_clicked_styling (target_instance_path) {
    console.log('[SEARCH DEBUG] update_search_last_clicked_styling called:', {
      target_instance_path,
      mode,
      search_query
    })

    // Remove `last-clicked` class from all search result nodes
    const search_nodes = container.querySelectorAll('.node.search-result')
    console.log('[SEARCH DEBUG] Found search result nodes:', search_nodes.length)
    search_nodes.forEach(node => remove_last_clicked_styling(node))

    // Add last-clicked class to the target node if it exists in search results
    const target_node = container.querySelector(`[data-instance_path="${target_instance_path}"].search-result`)
    if (target_node) {
      mode === 'search' ? target_node.classList.add('search-last-clicked') : target_node.classList.add('last-clicked')
      console.log('[SEARCH DEBUG] Added last-clicked to target node:', target_instance_path)
    } else {
      console.warn('[SEARCH DEBUG] Target node not found in search results:', {
        target_instance_path,
        available_search_nodes: Array.from(search_nodes).map(n => n.dataset.instance_path)
      })
    }

    function remove_last_clicked_styling (node) {
      const was_last_clicked = node.classList.contains('last-clicked')
      mode === 'search' ? node.classList.remove('search-last-clicked') : node.classList.remove('last-clicked')
      if (was_last_clicked) {
        console.log('[SEARCH DEBUG] Removed last-clicked from:', node.dataset.instance_path)
      }
    }
  }

  function handle_search_name_click (ev, instance_path) {
    console.log('[SEARCH DEBUG] handle_search_name_click called:', {
      instance_path,
      mode,
      search_query,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      shiftKey: ev.shiftKey,
      multi_select_enabled,
      current_selected: selected_instance_paths.length
    })

    if (mode !== 'search') {
      console.error('[SEARCH DEBUG] handle_search_name_click called but not in search mode!', {
        current_mode: mode,
        instance_path
      })
      return
    }

    handle_search_node_click(instance_path)

    if (ev.ctrlKey || ev.metaKey || multi_select_enabled) {
      search_select_node(ev, instance_path)
    } else if (ev.shiftKey) {
      search_select_node(ev, instance_path)
    } else if (select_between_enabled) {
      // Handle select-between mode when button is enabled
      search_select_node(ev, instance_path)
    } else {
      // Regular click
      search_expand_into_default(instance_path)
    }
  }

  function search_select_node (ev, instance_path) {
    console.log('[SEARCH DEBUG] search_select_node called:', {
      instance_path,
      mode,
      search_query,
      shiftKey: ev.shiftKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      multi_select_enabled,
      select_between_enabled,
      select_between_first_node,
      current_selected: selected_instance_paths
    })

    const new_selected = new Set(selected_instance_paths)

    if (select_between_enabled) {
      if (!select_between_first_node) {
        select_between_first_node = instance_path
        console.log('[SEARCH DEBUG] Set first node for select between:', instance_path)
      } else {
        console.log('[SEARCH DEBUG] Completing select between range:', {
          first: select_between_first_node,
          second: instance_path
        })
        const first_index = view.findIndex(n => n.instance_path === select_between_first_node)
        const second_index = view.findIndex(n => n.instance_path === instance_path)

        if (first_index !== -1 && second_index !== -1) {
          const start_index = Math.min(first_index, second_index)
          const end_index = Math.max(first_index, second_index)

          // Toggle selection for all nodes in between
          for (let i = start_index; i <= end_index; i++) {
            const node_instance_path = view[i].instance_path
            if (new_selected.has(node_instance_path)) {
              new_selected.delete(node_instance_path)
            } else {
              new_selected.add(node_instance_path)
            }
          }
        }

        // Reset select between mode after completing the selection
        select_between_enabled = false
        select_between_first_node = null
        update_drive_state({ type: 'mode/select_between_enabled', message: false })
        render_menubar()
        console.log('[SEARCH DEBUG] Reset select between mode')
      }
    } else if (ev.shiftKey) {
      // Enable select between mode on shift click
      select_between_enabled = true
      select_between_first_node = instance_path
      update_drive_state({ type: 'mode/select_between_enabled', message: true })
      render_menubar()
      console.log('[SEARCH DEBUG] Enabled select between mode with first node:', instance_path)
      return
    } else if (multi_select_enabled || ev.ctrlKey || ev.metaKey) {
      if (new_selected.has(instance_path)) {
        console.log('[SEARCH DEBUG] Deselecting node:', instance_path)
        new_selected.delete(instance_path)
      } else {
        console.log('[SEARCH DEBUG] Selecting node:', instance_path)
        new_selected.add(instance_path)
      }
    } else {
      // Single selection mode
      new_selected.clear()
      new_selected.add(instance_path)
      console.log('[SEARCH DEBUG] Single selecting node:', instance_path)
    }

    const new_selection_array = [...new_selected]
    update_drive_state({ type: 'runtime/selected_instance_paths', message: new_selection_array })
    console.log('[SEARCH DEBUG] search_select_node completed, new selection:', new_selection_array)
  }

  function reset () {
    // reset all of the manual expansions made
    instance_states = {}
    view_order_tracking = {} // Clear view order tracking on reset
    drive_updated_by_tracking = true
    update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
    if (mode === 'search') {
      search_entry_states = {}
      drive_updated_by_toggle = true
      update_drive_state({ type: 'runtime/search_entry_states', message: search_entry_states })
      perform_search(search_query)
      return
    }
    const root_instance_path = '|/'
    const new_instance_states = {
      [root_instance_path]: { expanded_subs: true, expanded_hubs: false }
    }
    update_drive_state({ type: 'runtime/vertical_scroll_value', message: 0 })
    update_drive_state({ type: 'runtime/horizontal_scroll_value', message: 0 })
    update_drive_state({ type: 'runtime/selected_instance_paths', message: [] })
    update_drive_state({ type: 'runtime/confirmed_selected', message: [] })
    update_drive_state({ type: 'runtime/instance_states', message: new_instance_states })
  }

  /******************************************************************************
  VIRTUAL SCROLLING
    - These functions implement virtual scrolling to handle large graphs
      efficiently using an IntersectionObserver.
  ******************************************************************************/
  function onscroll () {
    if (scroll_update_pending) return
    scroll_update_pending = true
    requestAnimationFrame(scroll_frames)
    function scroll_frames () {
      const scroll_delta = vertical_scroll_value - container.scrollTop
      // Handle removal of the scroll spacer.
      if (spacer_element && scroll_delta > 0 && container.scrollTop === 0) {
        spacer_element.remove()
        spacer_element = null
        spacer_initial_height = 0
        hub_num = 0
      }

      vertical_scroll_value = update_scroll_state({ current_value: vertical_scroll_value, new_value: container.scrollTop, name: 'vertical_scroll_value' })
      horizontal_scroll_value = update_scroll_state({ current_value: horizontal_scroll_value, new_value: container.scrollLeft, name: 'horizontal_scroll_value' })
      scroll_update_pending = false
    }
  }

  async function fill_viewport_downwards () {
    if (is_rendering || end_index >= view.length) return
    is_rendering = true
    const container_rect = container.getBoundingClientRect()
    let sentinel_rect = bottom_sentinel.getBoundingClientRect()
    while (end_index < view.length && sentinel_rect.top < container_rect.bottom + 500) {
      render_next_chunk()
      await new Promise(resolve => requestAnimationFrame(resolve))
      sentinel_rect = bottom_sentinel.getBoundingClientRect()
    }
    is_rendering = false
  }

  async function fill_viewport_upwards () {
    if (is_rendering || start_index <= 0) return
    is_rendering = true
    const container_rect = container.getBoundingClientRect()
    let sentinel_rect = top_sentinel.getBoundingClientRect()
    while (start_index > 0 && sentinel_rect.bottom > container_rect.top - 500) {
      render_prev_chunk()
      await new Promise(resolve => requestAnimationFrame(resolve))
      sentinel_rect = top_sentinel.getBoundingClientRect()
    }
    is_rendering = false
  }

  function handle_sentinel_intersection (entries) {
    entries.forEach(entry => fill_downwards_or_upwards(entry))
  }

  function fill_downwards_or_upwards (entry) {
    if (entry.isIntersecting) {
      if (entry.target === top_sentinel) fill_viewport_upwards()
      else if (entry.target === bottom_sentinel) fill_viewport_downwards()
    }
  }

  function render_next_chunk () {
    if (end_index >= view.length) return
    const fragment = document.createDocumentFragment()
    const next_end = Math.min(view.length, end_index + chunk_size)
    for (let i = end_index; i < next_end; i++) { if (view[i]) fragment.appendChild(create_node(view[i])) }
    container.insertBefore(fragment, bottom_sentinel)
    end_index = next_end
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    cleanup_dom(false)
  }

  function render_prev_chunk () {
    if (start_index <= 0) return
    const fragment = document.createDocumentFragment()
    const prev_start = Math.max(0, start_index - chunk_size)
    for (let i = prev_start; i < start_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
    }
    container.insertBefore(fragment, top_sentinel.nextSibling)
    start_index = prev_start
    top_sentinel.style.height = `${start_index * node_height}px`
    cleanup_dom(true)
  }

  // Removes nodes from the DOM that are far outside the viewport.
  function cleanup_dom (is_scrolling_up) {
    const rendered_count = end_index - start_index
    if (rendered_count <= max_rendered_nodes) return

    const to_remove_count = rendered_count - max_rendered_nodes
    if (is_scrolling_up) {
      // If scrolling up, remove nodes from the bottom.
      remove_dom_nodes({ count: to_remove_count, start_el: bottom_sentinel, next_prop: 'previousElementSibling', boundary_el: top_sentinel })
      end_index -= to_remove_count
      bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    } else {
      // If scrolling down, remove nodes from the top.
      remove_dom_nodes({ count: to_remove_count, start_el: top_sentinel, next_prop: 'nextElementSibling', boundary_el: bottom_sentinel })
      start_index += to_remove_count
      top_sentinel.style.height = `${start_index * node_height}px`
    }
  }

  /******************************************************************************
  ENTRY DUPLICATION PREVENTION
  ******************************************************************************/

  function collect_all_duplicate_entries () {
    duplicate_entries_map = {}
    // Use view_order_tracking for duplicate detection
    for (const [base_path, instance_paths] of Object.entries(view_order_tracking)) {
      if (instance_paths.length > 1) {
        duplicate_entries_map[base_path] = {
          instances: instance_paths,
          first_instance: instance_paths[0] // First occurrence in view order
        }
      }
    }
  }

  async function initialize_tracking_from_current_state () {
    const root_path = '/'
    const root_instance_path = '|/'
    if (await db.has(root_path)) {
      add_instance_to_view_tracking(root_path, root_instance_path)
      // Add initially expanded subs if any
      const root_entry = await db.get(root_path)
      if (root_entry && Array.isArray(root_entry.subs)) {
        for (const sub_path of root_entry.subs) {
          await add_instances_recursively(sub_path, root_instance_path, instance_states, db)
        }
      }
    }
  }

  function add_instance_to_view_tracking (base_path, instance_path) {
    if (!view_order_tracking[base_path]) view_order_tracking[base_path] = []
    if (!view_order_tracking[base_path].includes(instance_path)) {
      view_order_tracking[base_path].push(instance_path)

      // Only save to drive if not currently loading from drive
      if (!is_loading_from_drive) {
        drive_updated_by_tracking = true
        update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
      }
    }
  }

  function remove_instance_from_view_tracking (base_path, instance_path) {
    if (view_order_tracking[base_path]) {
      const index = view_order_tracking[base_path].indexOf(instance_path)
      if (index !== -1) {
        view_order_tracking[base_path].splice(index, 1)
        // Clean up empty arrays
        if (view_order_tracking[base_path].length === 0) {
          delete view_order_tracking[base_path]
        }

        // Only save to drive if not currently loading from drive
        if (!is_loading_from_drive) {
          drive_updated_by_tracking = true
          update_drive_state({ type: 'runtime/view_order_tracking', message: view_order_tracking })
        }
      }
    }
  }

  // Recursively add instances to tracking when expanding
  async function add_instances_recursively (base_path, parent_instance_path, instance_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      for (const hub_path of entry.hubs) {
        await add_instances_recursively(hub_path, instance_path, instance_states, db)
      }
    }

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      for (const sub_path of entry.subs) {
        await add_instances_recursively(sub_path, instance_path, instance_states, db)
      }
    }

    // Add the instance itself
    add_instance_to_view_tracking(base_path, instance_path)
  }

  // Recursively remove instances from tracking when collapsing
  async function remove_instances_recursively (base_path, parent_instance_path, instance_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      for (const hub_path of entry.hubs) {
        await remove_instances_recursively(hub_path, instance_path, instance_states, db)
      }
    }
    if (state.expanded_subs && Array.isArray(entry.subs)) {
      for (const sub_path of entry.subs) {
        await remove_instances_recursively(sub_path, instance_path, instance_states, db)
      }
    }

    // Remove the instance itself
    remove_instance_from_view_tracking(base_path, instance_path)
  }

  // Recursively hubs all subs in default mode
  async function collapse_subs_recursively (base_path, parent_instance_path, instance_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_and_remove_instance(sub_path, instance_path, instance_states, db)
      }
    }

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      hub_num = Math.max(0, hub_num - 1) // Decrement hub counter
      for (const hub_path of entry.hubs) {
        await collapse_and_remove_instance(hub_path, instance_path, instance_states, db)
      }
    }
    async function collapse_and_remove_instance (base_path, instance_path, instance_states, db) {
      await collapse_subs_recursively(base_path, instance_path, instance_states, db)
      await remove_instances_recursively(base_path, instance_path, instance_states, db)
    }
  }

  // Recursively hubs all hubs in default mode
  async function collapse_hubs_recursively (base_path, parent_instance_path, instance_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      hub_num = Math.max(0, hub_num - 1)
      for (const hub_path of entry.hubs) {
        await collapse_and_remove_instance(hub_path, instance_path, instance_states, db)
      }
    }

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_and_remove_instance(sub_path, instance_path, instance_states, db)
      }
    }
    async function collapse_and_remove_instance (base_path, instance_path, instance_states, db) {
      await collapse_all_recursively(base_path, instance_path, instance_states, db)
      await remove_instances_recursively(base_path, instance_path, instance_states, db)
    }
  }

  // Recursively collapse in default mode
  async function collapse_all_recursively (base_path, parent_instance_path, instance_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(instance_states, instance_path)

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_and_remove_instance_recursively(sub_path, instance_path, instance_states, db)
      }
    }

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      hub_num = Math.max(0, hub_num - 1)
      for (const hub_path of entry.hubs) {
        await collapse_and_remove_instance_recursively(hub_path, instance_path, instance_states, db)
      }
    }

    async function collapse_and_remove_instance_recursively (base_path, instance_path, instance_states, db) {
      await collapse_all_recursively(base_path, instance_path, instance_states, db)
      await remove_instances_recursively(base_path, instance_path, instance_states, db)
    }
  }

  // Recursively subs all hubs in search mode
  async function collapse_search_subs_recursively (base_path, parent_instance_path, search_entry_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(search_entry_states, instance_path)

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_search_all_recursively(sub_path, instance_path, search_entry_states, db)
      }
    }

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      for (const hub_path of entry.hubs) {
        await collapse_search_all_recursively(hub_path, instance_path, search_entry_states, db)
      }
    }
  }

  // Recursively hubs all hubs in search mode
  async function collapse_search_hubs_recursively (base_path, parent_instance_path, search_entry_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(search_entry_states, instance_path)

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      for (const hub_path of entry.hubs) {
        await collapse_search_all_recursively(hub_path, instance_path, search_entry_states, db)
      }
    }

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_search_all_recursively(sub_path, instance_path, search_entry_states, db)
      }
    }
  }

  // Recursively collapse in search mode
  async function collapse_search_all_recursively (base_path, parent_instance_path, search_entry_states, db) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = await db.get(base_path)
    if (!entry) return

    const state = get_or_create_state(search_entry_states, instance_path)

    if (state.expanded_subs && Array.isArray(entry.subs)) {
      state.expanded_subs = false
      for (const sub_path of entry.subs) {
        await collapse_search_all_recursively(sub_path, instance_path, search_entry_states, db)
      }
    }

    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      state.expanded_hubs = false
      for (const hub_path of entry.hubs) {
        await collapse_search_all_recursively(hub_path, instance_path, search_entry_states, db)
      }
    }
  }

  function get_next_duplicate_instance (base_path, current_instance_path) {
    const duplicates = duplicate_entries_map[base_path]
    if (!duplicates || duplicates.instances.length <= 1) return null

    const current_index = duplicates.instances.indexOf(current_instance_path)
    if (current_index === -1) return duplicates.instances[0]

    const next_index = (current_index + 1) % duplicates.instances.length
    return duplicates.instances[next_index]
  }

  function has_duplicates (base_path) {
    return duplicate_entries_map[base_path] && duplicate_entries_map[base_path].instances.length > 1
  }

  function is_first_duplicate (base_path, instance_path) {
    const duplicates = duplicate_entries_map[base_path]
    return duplicates && duplicates.first_instance === instance_path
  }

  function cycle_to_next_duplicate (base_path, current_instance_path) {
    const next_instance_path = get_next_duplicate_instance(base_path, current_instance_path)
    if (next_instance_path) {
      remove_jump_button_from_entry(current_instance_path)

      // First, handle the scroll and DOM updates without drive state changes
      scroll_to_and_highlight_instance(next_instance_path, current_instance_path)

      // Manually update DOM styling
      update_last_clicked_styling(next_instance_path)
      last_clicked_node = next_instance_path
      drive_updated_by_scroll = true // Prevent onbatch from interfering with scroll
      drive_updated_by_match = true
      update_drive_state({ type: 'runtime/last_clicked_node', message: next_instance_path })

      // Add jump button to the target entry (with a small delay to ensure DOM is ready)
      setTimeout(jump_out, 10)
      function jump_out () {
        const target_element = shadow.querySelector(`[data-instance_path="${CSS.escape(next_instance_path)}"]`)
        if (target_element) {
          add_jump_button_to_matching_entry(target_element, base_path, next_instance_path)
        }
      }
    }
  }

  function update_last_clicked_styling (new_instance_path) {
    // Remove last-clicked class from all elements
    const all_nodes = mode === 'search' ? shadow.querySelectorAll('.node.search-last-clicked') : shadow.querySelectorAll('.node.last-clicked')
    console.log('Removing last-clicked class from all nodes', all_nodes)
    all_nodes.forEach(node => (mode === 'search' ? node.classList.remove('search-last-clicked') : node.classList.remove('last-clicked')))
    // Add last-clicked class to the new element
    if (new_instance_path) {
      const new_element = shadow.querySelector(`[data-instance_path="${CSS.escape(new_instance_path)}"]`)
      if (new_element) {
        mode === 'search' ? new_element.classList.add('search-last-clicked') : new_element.classList.add('last-clicked')
      }
    }
  }

  function remove_jump_button_from_entry (instance_path) {
    const current_element = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
    if (current_element) {
      // restore the wand icon
      const node_data = view.find(n => n.instance_path === instance_path)
      if (node_data && node_data.base_path === '/' && instance_path === '|/') {
        const wand_el = current_element.querySelector('.wand.navigate-to-hub')
        if (wand_el && root_wand_state) {
          wand_el.textContent = root_wand_state.content
          wand_el.className = root_wand_state.className
          wand_el.onclick = root_wand_state.onclick

          root_wand_state = null
        }
        return
      }

      // Regular behavior for non-root nodes
      const button_container = current_element.querySelector('.indent-btn-container')
      if (button_container) {
        button_container.remove()
        // Restore left-indent class
        if (node_data && node_data.depth > 0) {
          current_element.classList.add('left-indent')
        }
      }
    }
  }

  function add_jump_button_to_matching_entry (el, base_path, instance_path) {
    // Check if jump button already exists
    if (el.querySelector('.navigate-to-hub')) return

    // replace the wand icon temporarily
    if (base_path === '/' && instance_path === '|/') {
      const wand_el = el.querySelector('.wand')
      if (wand_el) {
        // Store original wand state in JavaScript variable
        root_wand_state = {
          content: wand_el.textContent,
          className: wand_el.className,
          onclick: wand_el.onclick
        }

        // Replace with jump button
        wand_el.textContent = '^'
        wand_el.className = 'wand navigate-to-hub clickable'
        wand_el.onclick = (ev) => handle_jump_button_click(ev, instance_path)
      }
      return

      function handle_jump_button_click (ev, instance_path) {
        ev.stopPropagation()
        last_clicked_node = instance_path
        drive_updated_by_match = true
        update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

        update_last_clicked_styling(instance_path)

        cycle_to_next_duplicate(base_path, instance_path)
      }
    }

    const indent_button_div = document.createElement('div')
    indent_button_div.className = 'indent-btn-container'

    const navigate_button = document.createElement('span')
    navigate_button.className = 'navigate-to-hub clickable'
    navigate_button.textContent = '^'
    navigate_button.onclick = (ev) => handle_navigate_button_click(ev, instance_path)

    indent_button_div.appendChild(navigate_button)

    // Remove left padding
    el.classList.remove('left-indent')
    el.insertBefore(indent_button_div, el.firstChild)

    function handle_navigate_button_click (ev, instance_path) {
      ev.stopPropagation() // Prevent triggering the whole entry click again
      // Manually update last clicked node for jump button
      last_clicked_node = instance_path
      drive_updated_by_match = true
      update_drive_state({ type: 'runtime/last_clicked_node', message: instance_path })

      // Manually update DOM classes for last-clicked styling
      update_last_clicked_styling(instance_path)

      cycle_to_next_duplicate(base_path, instance_path)
    }
  }

  function scroll_to_and_highlight_instance (target_instance_path, source_instance_path = null) {
    const target_index = view.findIndex(n => n.instance_path === target_instance_path)
    if (target_index === -1) return

    // Calculate scroll position
    let target_scroll_top = target_index * node_height

    if (source_instance_path) {
      const source_index = view.findIndex(n => n.instance_path === source_instance_path)
      if (source_index !== -1) {
        const source_scroll_top = source_index * node_height
        const current_scroll_top = container.scrollTop
        const source_visible_offset = source_scroll_top - current_scroll_top
        target_scroll_top = target_scroll_top - source_visible_offset
      }
    }

    container.scrollTop = target_scroll_top
  }

  /******************************************************************************
  HELPER FUNCTIONS
  ******************************************************************************/
  function get_highlighted_name (name, query) {
  // Creates a new regular expression.
  // `escape_regex(query)` sanitizes the query string to treat special regex characters literally.
  // `(...)` creates a capturing group for the escaped query.
  // 'gi' flags: 'g' for global (all occurrences), 'i' for case-insensitive.
    const regex = new RegExp(`(${escape_regex(query)})`, 'gi')
    // Replaces all matches of the regex in 'name' with the matched text wrapped in search-match class.
    // '$1' refers to the content of the first capturing group (the matched query).
    return name.replace(regex, '<span class="search-match">$1</span>')
  }

  function escape_regex (string) {
  // Escapes special regular expression characters in a string.
  // It replaces characters like -, /, \, ^, $, *, +, ?, ., (, ), |, [, ], {, }
  // with their escaped versions (e.g., '.' becomes '\.').
  // This prevents them from being interpreted as regex metacharacters.
    return string.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') // Corrected: should be \\$& to escape the found char
  }

  function check_and_reset_feedback_flags () {
    if (drive_updated_by_scroll && !ignore_drive_updated_by_scroll) {
      drive_updated_by_scroll = false
      return true
    } else ignore_drive_updated_by_scroll = false
    if (drive_updated_by_toggle) {
      drive_updated_by_toggle = false
      return true
    }
    if (drive_updated_by_search) {
      drive_updated_by_search = false
      return true
    }
    if (drive_updated_by_match) {
      drive_updated_by_match = false
      return true
    }
    if (drive_updated_by_tracking) {
      drive_updated_by_tracking = false
      return true
    }
    if (drive_updated_by_last_clicked) {
      drive_updated_by_last_clicked = false
      return true
    }
    if (drive_updated_by_undo) {
      drive_updated_by_undo = false
      return true
    }
    console.log('[SEARCH DEBUG] No feedback flags set, allowing onbatch')
    return false
  }

  function parse_json_data (data, path) {
    if (data === null) return null
    try {
      return typeof data === 'string' ? JSON.parse(data) : data
    } catch (e) {
      console.error(`Failed to parse JSON for ${path}:`, e)
      return null
    }
  }

  function process_path_array_update ({ current_paths, value, render_set, name }) {
    const old_paths = [...current_paths]
    const new_paths = Array.isArray(value)
      ? value
      : (console.warn(`${name} is not an array, defaulting to empty.`, value), [])
    ;[...new Set([...old_paths, ...new_paths])].forEach(p => render_set.add(p))
    return new_paths
  }

  function calculate_new_scroll_top ({ old_scroll_top, old_view, focal_path }) {
    // Calculate the new scroll position to maintain the user's viewport.
    if (focal_path) {
      // If an action was focused on a specific node (like a toggle), try to keep it in the same position.
      const old_idx = old_view.findIndex(n => n.instance_path === focal_path)
      const new_idx = view.findIndex(n => n.instance_path === focal_path)
      if (old_idx !== -1 && new_idx !== -1) {
        return old_scroll_top + (new_idx - old_idx) * node_height
      }
    } else if (old_view.length > 0) {
      // Otherwise, try to keep the topmost visible node in the same position.
      const old_top_idx = Math.floor(old_scroll_top / node_height)
      const old_top_node = old_view[old_top_idx]
      if (old_top_node) {
        const new_top_idx = view.findIndex(n => n.instance_path === old_top_node.instance_path)
        if (new_top_idx !== -1) {
          return new_top_idx * node_height + (old_scroll_top % node_height)
        }
      }
    }
    return old_scroll_top
  }

  function handle_spacer_element ({ hub_toggle, existing_height, new_scroll_top, sync_fn }) {
    if (hub_toggle || hub_num > 0) {
      spacer_element = document.createElement('div')
      spacer_element.className = 'spacer'
      container.appendChild(spacer_element)

      if (hub_toggle) {
        requestAnimationFrame(spacer_frames)
      } else {
        spacer_element.style.height = `${existing_height}px`
        requestAnimationFrame(sync_fn)
      }
    } else {
      spacer_element = null
      spacer_initial_height = 0
      requestAnimationFrame(sync_fn)
    }
    function spacer_frames () {
      const container_height = container.clientHeight
      const content_height = view.length * node_height
      const max_scroll_top = content_height - container_height

      if (new_scroll_top > max_scroll_top) {
        spacer_initial_height = new_scroll_top - max_scroll_top
        spacer_element.style.height = `${spacer_initial_height}px`
      }
      sync_fn()
    }
  }

  function create_root_node ({ state, has_subs, instance_path }) {
    // Handle the special case for the root node since its a bit different.
    const el = document.createElement('div')
    el.className = 'node type-root'
    el.dataset.instance_path = instance_path
    const prefix_class = has_subs || (mode === 'search' && search_query) ? 'prefix clickable' : 'prefix'
    const prefix_name = state.expanded_subs ? 'tee-down' : 'line-h'
    el.innerHTML = `<div class="wand clickable">🪄</div><span class="${prefix_class} ${prefix_name}"></span><span class="name ${(mode === 'search' && search_query) ? '' : 'clickable'}">/🌐</span>`

    el.querySelector('.wand').onclick = reset
    if (has_subs) {
      const prefix_el = el.querySelector('.prefix')
      if (prefix_el) {
        prefix_el.onclick = (mode === 'search' && search_query) ? null : () => toggle_subs(instance_path)
      }
    }
    el.querySelector('.name').onclick = ev => (mode === 'search' && search_query) ? null : select_node(ev, instance_path)
    return el
  }

  function create_confirm_checkbox (instance_path) {
    const checkbox_div = document.createElement('div')
    checkbox_div.className = 'confirm-wrapper'
    const is_confirmed = confirmed_instance_paths.includes(instance_path)
    checkbox_div.innerHTML = `<input type="checkbox" ${is_confirmed ? 'checked' : ''}>`
    const checkbox_input = checkbox_div.querySelector('input')
    if (checkbox_input) checkbox_input.onchange = ev => handle_confirm(ev, instance_path)
    return checkbox_div
  }

  function update_scroll_state ({ current_value, new_value, name }) {
    if (current_value !== new_value) {
      drive_updated_by_scroll = true // Set flag to prevent render loop.
      update_drive_state({ type: `runtime/${name}`, message: new_value })
      return new_value
    }
    return current_value
  }

  function remove_dom_nodes ({ count, start_el, next_prop, boundary_el }) {
    for (let i = 0; i < count; i++) {
      const temp = start_el[next_prop]
      if (temp && temp !== boundary_el) temp.remove()
      else break
    }
  }

  /******************************************************************************
  KEYBOARD NAVIGATION
    - Handles keyboard-based navigation for the graph explorer
    - Navigate up/down around last_clicked node
  ******************************************************************************/
  function handle_keyboard_navigation (event) {
    // Don't handle keyboard events if focus is on input elements
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return
    }
    const on_bind = {
      navigate_up_current_node,
      navigate_down_current_node,
      toggle_subs_for_current_node,
      toggle_hubs_for_current_node,
      multiselect_current_node,
      select_between_current_node,
      toggle_search_mode,
      jump_to_next_duplicate

    }
    let key_combination = ''
    if (event.ctrlKey) key_combination += 'Control+'
    if (event.altKey) key_combination += 'Alt+'
    if (event.shiftKey) key_combination += 'Shift+'
    key_combination += event.key

    const action = keybinds[key_combination] || keybinds[event.key]
    if (!action) return

    // Prevent default behavior for handled keys
    event.preventDefault()
    const base_path = last_clicked_node.split('|').pop()
    const current_instance_path = last_clicked_node
    // Execute the appropriate action
    on_bind[action]({ base_path, current_instance_path })
  }
  function navigate_up_current_node () {
    navigate_to_adjacent_node(-1)
  }
  function navigate_down_current_node () {
    navigate_to_adjacent_node(1)
  }
  function navigate_to_adjacent_node (direction) {
    if (view.length === 0) return
    if (!last_clicked_node) last_clicked_node = view[0].instance_path
    const current_index = view.findIndex(node => node.instance_path === last_clicked_node)
    if (current_index === -1) return

    const new_index = current_index + direction
    if (new_index < 0 || new_index >= view.length) return

    const new_node = view[new_index]
    last_clicked_node = new_node.instance_path
    drive_updated_by_last_clicked = true
    update_drive_state({ type: 'runtime/last_clicked_node', message: last_clicked_node })

    // Update visual styling
    if (mode === 'search' && search_query) {
      update_search_last_clicked_styling(last_clicked_node)
    } else {
      update_last_clicked_styling(last_clicked_node)
    }
    const base_path = last_clicked_node.split('|').pop()
    const has_duplicate_entries = has_duplicates(base_path)
    const is_first_occurrence = is_first_duplicate(base_path, last_clicked_node)
    if (has_duplicate_entries && !is_first_occurrence) {
      const el = shadow.querySelector(`[data-instance_path="${CSS.escape(last_clicked_node)}"]`)
      add_jump_button_to_matching_entry(el, base_path, last_clicked_node)
    }
    scroll_to_node(new_node.instance_path)
  }

  async function toggle_subs_for_current_node () {
    if (!last_clicked_node) return

    const base_path = last_clicked_node.split('|').pop()
    const entry = await db.get(base_path)
    const has_subs = Array.isArray(entry?.subs) && entry.subs.length > 0
    if (!has_subs) return

    if (hubs_flag === 'default') {
      const has_duplicate_entries = has_duplicates(base_path)
      const is_first_occurrence = is_first_duplicate(base_path, last_clicked_node)
      if (has_duplicate_entries && !is_first_occurrence) return
    }

    if (mode === 'search' && search_query) {
      await toggle_search_subs(last_clicked_node)
    } else {
      await toggle_subs(last_clicked_node)
    }
  }

  async function toggle_hubs_for_current_node () {
    if (!last_clicked_node) return

    const base_path = last_clicked_node.split('|').pop()
    const entry = await db.get(base_path)
    const has_hubs = hubs_flag === 'false' ? false : Array.isArray(entry?.hubs) && entry.hubs.length > 0
    if (!has_hubs || base_path === '/') return

    if (hubs_flag === 'default') {
      const has_duplicate_entries = has_duplicates(base_path)
      const is_first_occurrence = is_first_duplicate(base_path, last_clicked_node)

      if (has_duplicate_entries && !is_first_occurrence) return
    }

    if (mode === 'search' && search_query) {
      await toggle_search_hubs(last_clicked_node)
    } else {
      await toggle_hubs(last_clicked_node)
    }
  }

  function multiselect_current_node () {
    if (!last_clicked_node || selection_flag === false) return

    // IMPORTANT FIX!!!!! : synthetic event object for compatibility with existing functions
    const synthetic_event = { ctrlKey: true, metaKey: false, shiftKey: false }

    if (mode === 'search' && search_query) {
      search_select_node(synthetic_event, last_clicked_node)
    } else {
      select_node(synthetic_event, last_clicked_node)
    }
  }

  function select_between_current_node () {
    if (!last_clicked_node || selection_flag === false) return

    if (!select_between_enabled) {
      // Enable select between mode and set first node
      select_between_enabled = true
      select_between_first_node = last_clicked_node
      update_drive_state({ type: 'mode/select_between_enabled', message: true })
      render_menubar()
    } else {
      // Complete the select between operation
      const synthetic_event = { ctrlKey: false, metaKey: false, shiftKey: true }

      if (mode === 'search' && search_query) {
        search_select_node(synthetic_event, last_clicked_node)
      } else {
        select_node(synthetic_event, last_clicked_node)
      }
    }
  }

  function scroll_to_node (instance_path) {
    const node_index = view.findIndex(node => node.instance_path === instance_path)
    if (node_index === -1 || !node_height) return

    const target_scroll_top = node_index * node_height
    const container_height = container.clientHeight
    const current_scroll_top = container.scrollTop

    // Only scroll if the node is not fully visible
    if (target_scroll_top < current_scroll_top || target_scroll_top + node_height > current_scroll_top + container_height) {
      const centered_scroll_top = target_scroll_top - (container_height / 2) + (node_height / 2)
      container.scrollTop = Math.max(0, centered_scroll_top)

      vertical_scroll_value = container.scrollTop
      drive_updated_by_scroll = true
      update_drive_state({ type: 'runtime/vertical_scroll_value', message: vertical_scroll_value })
    }
  }

  function jump_to_next_duplicate ({ base_path, current_instance_path }) {
    if (hubs_flag === 'default') {
      cycle_to_next_duplicate(base_path, current_instance_path)
    }
  }

  /******************************************************************************
  UNDO FUNCTIONALITY
    - Implements undo functionality to revert drive state changes
  ******************************************************************************/
  async function undo (steps = 1) {
    if (undo_stack.length === 0) {
      console.warn('No actions to undo')
      return
    }

    const actions_to_undo = Math.min(steps, undo_stack.length)
    console.log(`Undoing ${actions_to_undo} action(s)`)

    // Pop the specified number of actions from the stack
    const snapshots_to_restore = []
    for (let i = 0; i < actions_to_undo; i++) {
      const snapshot = undo_stack.pop()
      if (snapshot) snapshots_to_restore.push(snapshot)
    }

    // Restore the last snapshot's state
    if (snapshots_to_restore.length > 0) {
      const snapshot = snapshots_to_restore[snapshots_to_restore.length - 1]

      try {
        // Restore the state WITHOUT setting drive_updated_by_undo flag
        // This allows onbatch to process the change and update the UI
        await drive.put(`${snapshot.type}.json`, snapshot.value)

        // Update the undo stack in drive (with flag to prevent tracking this update)
        // drive_updated_by_undo = true
        await drive.put('undo/stack.json', JSON.stringify(undo_stack))

        console.log(`Undo completed: restored ${snapshot.type} to previous state`)

        // Re-render menubar to update undo button count
        render_menubar()
      } catch (e) {
        console.error('Failed to undo action:', e)
      }
    }
  }
}

/******************************************************************************
  FALLBACK CONFIGURATION
    - This provides the default data and API configuration for the component,
      following the pattern described in `instructions.md`.
    - It defines the default datasets (`entries`, `style`, `runtime`) and their
      initial values.
  ******************************************************************************/
function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'style/': {
          'theme.css': {
            $ref: 'theme.css'
          }
        },
        'runtime/': {
          'node_height.json': { raw: '16' },
          'vertical_scroll_value.json': { raw: '0' },
          'horizontal_scroll_value.json': { raw: '0' },
          'selected_instance_paths.json': { raw: '[]' },
          'confirmed_selected.json': { raw: '[]' },
          'instance_states.json': { raw: '{}' },
          'search_entry_states.json': { raw: '{}' },
          'last_clicked_node.json': { raw: 'null' },
          'view_order_tracking.json': { raw: '{}' }
        },
        'mode/': {
          'current_mode.json': { raw: '"menubar"' },
          'previous_mode.json': { raw: '"menubar"' },
          'search_query.json': { raw: '""' },
          'multi_select_enabled.json': { raw: 'false' },
          'select_between_enabled.json': { raw: 'false' }
        },
        'flags/': {
          'hubs.json': { raw: '"default"' },
          'selection.json': { raw: 'true' },
          'recursive_collapse.json': { raw: 'true' }
        },
        'keybinds/': {
          'navigation.json': {
            raw: JSON.stringify({
              ArrowUp: 'navigate_up_current_node',
              ArrowDown: 'navigate_down_current_node',
              'Control+ArrowDown': 'toggle_subs_for_current_node',
              'Control+ArrowUp': 'toggle_hubs_for_current_node',
              'Alt+s': 'multiselect_current_node',
              'Alt+b': 'select_between_current_node',
              'Control+m': 'toggle_search_mode',
              'Alt+j': 'jump_to_next_duplicate'
            })
          }
        },
        'undo/': {
          'stack.json': { raw: '[]' }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/node_modules/graph-explorer/lib/graph_explorer.js")
},{"STATE":1}],3:[function(require,module,exports){
(function (global){(function (){
// --- Main Export ---
// Usage: const docs = DOCS(__filename)(opts.sid)
//        docs.wrap(handler, docContent)

module.exports = function DOCS (filename) {
  return function (sid) {
    return create_context(filename, sid)
  }
}

const scope = typeof window !== 'undefined' ? window : global

if (!scope.__DOCS_GLOBAL_STATE__) {
  scope.__DOCS_GLOBAL_STATE__ = {
    docs_mode_active: false,
    docs_mode_listeners: [],
    doc_display_callback: null,
    admin_available: true,
    message_handlers: []
  }
}

const state = scope.__DOCS_GLOBAL_STATE__

// --- Static Methods (called as DOCS.method()) ---
// Exported via DOCS.Admin API ( which is only available to the first module calling const docs = DOCS(__filename)().admin())
function set_docs_mode (active) {
  state.docs_mode_active = active
  state.docs_mode_listeners.forEach(listener => listener(active))
}

function get_docs_mode () {
  return state.docs_mode_active
}

function on_docs_mode_change (listener) {
  state.docs_mode_listeners.push(listener)
  return () => {
    state.docs_mode_listeners = state.docs_mode_listeners.filter(l => l !== listener)
  }
}

function set_doc_display_handler (callback) {
  state.doc_display_callback = callback
}

// --- Messaging System for Admin API Calls ---

function send_message (type, data) {
  state.message_handlers.forEach(handler => {
    try {
      handler({ type, data })
    } catch (err) {
      console.error('DOCS: Failed to send the message to handler', err)
    }
  })
}

function on_message (handler) {
  state.message_handlers.push(handler)
  return () => {
    state.message_handlers = state.message_handlers.filter(h => h !== handler)
  }
}

// --- Internal Helpers ---

async function display_doc (content, sid) {
  let resolved_content = content
  if (typeof content === 'function') {
    resolved_content = await content()
  } else if (content && typeof content.then === 'function') {
    resolved_content = await content
  }
  
  if (state.doc_display_callback) {
    state.doc_display_callback({ content: resolved_content || 'No documentation available', sid })
  }
}

function create_sys_api (meta) {
  return {
    is_docs_mode: () => state.docs_mode_active,
    get_doc: () => meta.doc || 'No documentation available',
    get_meta: () => ({ ...meta }),
    show_doc: () => display_doc(meta.doc || 'No documentation available', meta.sid)
  }
}

// --- Instance Methods (called as docs.method()) ---

function wrap (handler, meta = {}, make_sys = create_sys_api) {
  const sys = make_sys(meta)
  
  return async function wrapped_handler (event) {
    if (sys.is_docs_mode()) {
      if (event && event.preventDefault) {
        event.preventDefault()
        event.stopPropagation()
      }
      sys.show_doc()
      return
    }
    return handler.call(this, event, sys)
  }
}

function wrap_isolated (handler_string, meta = {}) {
  try {
    const params = 'meta, make_sys'
    const source = `(${wrap.toString()})(${handler_string}, ${params})`
    const isolated_fn = new Function(params, source)(meta, create_sys_api)
    return isolated_fn
  } catch (err) {
    console.error('handler function is not allowed to access closure scope', err)
    return wrap(() => {}, meta)
  }
}

function hook (dom, meta = {}) {
  if (!dom) return dom
  
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(dom))
  if (!proto) return dom
  
  Object.keys(proto).forEach(key => {
    if (key.startsWith('on') && typeof dom[key] === 'function') {
      const original = dom[key]
      dom[key] = wrap(original, { ...meta, event_type: key })
    }
  })
  
  return dom
}

// --- Context Factory (creates instance with component scope) ---

function create_context (filename, sid) {
  const api = {
    wrap: (handler, doc) => wrap(handler, { doc, sid, component: filename }),
    wrap_isolated: (handler_string, doc) => wrap_isolated(handler_string, { doc, sid, component: filename }),
    hook: (dom, doc) => hook(dom, { doc, sid, component: filename }),
    get_docs_mode,
    on_docs_mode_change,
    message: {
      set_docs_mode: (active) => send_message('set_docs_mode', { active }),
      set_doc_display_handler: () => send_message('set_doc_display_handler', {})
    },
    admin: function (handler) {
      if (!state.admin_available) {
        console.error('DOCS.admin() can only be called once by the root module')
        return null
      }
      state.admin_available = false
      const api = {
        set_docs_mode,
        set_doc_display_handler
      }
      const unsubscribe = on_message(({ type, data }) => handler({ type, data }, api))
      api.unsubscribe = unsubscribe
      return api
    }
  }
  
  return api
}


}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],4:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

const quick_actions = require('quick_actions')
const actions = require('actions')
const steps_wizard = require('steps_wizard')

module.exports = action_bar

async function action_bar (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    icons: iconject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="container">
    <div class="actions">
      <actions></actions>
    </div>
    <div class="steps-wizard">
      <steps-wizard></steps-wizard>
    </div>
    <div class="action-bar-container main">
      <div class="command-history">
        <button class="icon-btn"></button>
      </div>
      <div class="quick-actions">
        <quick-actions></quick-actions>
      </div>
    </div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const history_icon = shadow.querySelector('.icon-btn')
  const quick_placeholder = shadow.querySelector('quick-actions')
  const actions_placeholder = shadow.querySelector('actions')
  const steps_wizard_placeholder = shadow.querySelector('steps-wizard')

  let console_icon = {}
  const docs = DOCS(__filename)(opts.sid)
  const subs = await sdb.watch(onbatch)

  const _ = {
    up: null,
    send_quick_actions: null,
    send_actions: null,
    send_steps_wizard: null
  }
  let actions_data = null
  let selected_action = null

  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _.up = send
  }

  let mid = 0

  const quick_actions_sid = subs[0].sid
  const actions_sid = subs[1].sid
  const steps_wizard_sid = subs[2].sid

  history_icon.innerHTML = console_icon
  history_icon.onclick = docs.wrap(onhistory, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })
  const element = protocol ? await quick_actions({ ...subs[0], ids: { up: id } }, quick_actions_protocol) : await quick_actions({ ...subs[0], ids: { up: id } })
  quick_placeholder.replaceWith(element)

  const actions_el = protocol ? await actions({ ...subs[1], ids: { up: id } }, actions_protocol) : await actions({ ...subs[1], ids: { up: id } })
  actions_el.classList.add('hide')
  actions_placeholder.replaceWith(actions_el)

  const steps_wizard_el = protocol ? await steps_wizard({ ...subs[2], ids: { up: id } }, steps_wizard_protocol) : await steps_wizard({ ...subs[2], ids: { up: id } })
  steps_wizard_el.classList.add('hide')
  steps_wizard_placeholder.replaceWith(steps_wizard_el)

  const parent_handler = {
    load_actions,
    selected_action: parent__selected_action,
    show_submit_btn,
    hide_submit_btn,
    form_data,
    update_actions_for_app,
    update_quick_actions_for_app
  }

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('Unknown message type:', type, data) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function iconject (data) {
    console_icon = data[0]
  }
  async function onhistory () {
    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'console_history_toggle', data: null })
    const head2 = [by, to, mid++]
    _.up({ head: head2, refs, type: 'ui_focus', data: 'command_history' })
  }

  // --- Toggle Views ---
  function toggle_view (el, show) {
    el.classList.toggle('hide', !show)
  }

  function actions_toggle_view (display) {
    toggle_view(actions_el, display === 'block')
  }

  function steps_toggle_view (display) {
    toggle_view(steps_wizard_el, display === 'block')
  }

  // -------------------------------
  // Protocol: actions
  // -------------------------------

  function actions_protocol (send) {
    _.send_actions = send

    const actions_handlers = {
      selected_action: update_quick_actions_input,
      ui_focus_docs
    }

    return function on (msg) {
      if (msg.type === 'ui_focus') {
        _.up(msg)
        return
      }
      const { type } = msg
      const handler = actions_handlers[type] || fail
      handler(msg)
    }
  }

  // -------------------------------
  // Protocol: quick actions
  // -------------------------------

  function quick_actions_protocol (send) {
    _.send_quick_actions = send

    const quick_handlers = {
      display_actions: quick_actions__display_actions,
      action_submitted: quick_actions__action_submitted,
      filter_actions,
      update_quick_actions_input,
      activate_steps_wizard,
      ui_focus_docs
    }

    return on
    function on (msg) {
      const { type } = msg
      const handler = quick_handlers[type] || fail
      handler(msg)
    }
  }

  function quick_actions__display_actions (msg) {
    const { data } = msg
    actions_toggle_view(data)
    if (data === 'none') {
      steps_toggle_view('none')
      const head = [by, to, mid++]
      const refs = msg.head ? { cause: msg.head } : undefined
      _.up?.({ head, refs, type: 'clean_up', data: selected_action })
    }
  }

  function quick_actions__action_submitted (msg) {
    const result = JSON.stringify(actions_data[selected_action].map(step => step.data), null, 2)
    const head_to_quick = [by, quick_actions_sid, mid++]
    const refs_to_quick = msg.head ? { cause: msg.head } : undefined
    _.send_quick_actions?.({ head: head_to_quick, refs: refs_to_quick, type: 'deactivate_input_field', data: null })
    const head = [by, to, mid++]
    const refs = msg.head ? { cause: msg.head } : undefined
    _.up?.({ head, refs, type: 'action_submitted', data: { result, selected_action } })
  }

  // -------------------------------
  // Protocol: steps wizard
  // -------------------------------

  function steps_wizard_protocol (send) {
    _.send_steps_wizard = send

    const steps_handlers = {
      step_clicked: steps_wizard__step_clicked,
      ui_focus_docs
    }

    return function on (msg) {
      const { type } = msg
      const handler = steps_handlers[type]
      handler(msg)
    }
  }

  function steps_wizard__step_clicked (msg) {
    const { data } = msg
    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({ head: head_to_quick, type: 'update_current_step', data })
    const head = [by, to, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.up?.({ head, refs, type: 'render_form', data })
  }

  function onmessage (msg) {
    const { type } = msg
    if (type === 'docs_toggle') {
      // Broadcast to subcomponents (for backward compatibility during migration)
      _.send_quick_actions?.(msg)
      _.send_actions?.(msg)
      _.send_steps_wizard?.(msg)
    } else {
      parent_handler[type]?.(msg)
    }
  }

  function load_actions (msg) {
    const { data, type } = msg
    actions_data = data
    const head_to_actions = [by, actions_sid, mid++]
    _.send_actions?.({ head: head_to_actions, type, data })
  }
  function parent__selected_action (msg) {
    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({ head: head_to_quick, ...msg })
  }
  function show_submit_btn (msg) {
    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({ head: head_to_quick, type: 'show_submit_btn' })
  }
  function hide_submit_btn (msg) {
    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({ head: head_to_quick, type: 'hide_submit_btn' })
  }
  function form_data (msg) {
    const head_to_steps = [by, steps_wizard_sid, mid++]
    _.send_steps_wizard?.({ head: head_to_steps, type: 'init_data', data: actions_data[selected_action] })
  }

  function update_actions_for_app (msg) {
    const { data, type } = msg
    console.log('Action Bar: Updating actions for focused app:', data?.focused_app)

    // Forward update_actions_for_app to actions and quick_actions submodules
    const refs = msg.head ? { cause: msg.head } : {}

    const head_to_actions = [by, actions_sid, mid++]
    _.send_actions?.({ head: head_to_actions, refs, type, data })

    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({ head: head_to_quick, refs, type, data })
  }

  function update_quick_actions_for_app (msg) {
    const { data, type } = msg
    const head_to_quick_actions = [by, quick_actions_sid, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.send_quick_actions?.({ head: head_to_quick_actions, refs, type, data })
  }

  function filter_actions (msg) {
    const { data, type } = msg
    const head_to_actions = [by, actions_sid, mid++]
    _.send_actions?.({ head: head_to_actions, cause: msg.head ? { cause: msg.head } : {}, type, data })
  }

  function update_quick_actions_input (msg) {
    const { data } = msg
    selected_action = data || null
    const head_to_quick = [by, quick_actions_sid, mid++]
    _.send_quick_actions?.({
      head: head_to_quick,
      type: 'update_input_command',
      data,
      refs: msg.head ? { cause: msg.head } : {}
    })
  }

  function activate_steps_wizard (msg) {
    // Show the steps wizard
    steps_toggle_view('block')

    const head_to_steps = [by, steps_wizard_sid, mid++]
    _.send_steps_wizard?.({
      head: head_to_steps,
      type: 'init_data',
      data: selected_action,
      refs: msg.head ? { cause: msg.head } : {}
    })

    actions_toggle_view('none')
  }

  function ui_focus_docs (msg) {
    _.up(msg)
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      quick_actions: { $: '' },
      actions: { $: '' },
      steps_wizard: { $: '' },
      DOCS: { $: '' }
    }
  }
  function fallback_instance () {
    return {
      _: {
        quick_actions: {
          0: '',
          mapping: {
            style: 'style',
            icons: 'icons',
            actions: 'actions',
            hardcons: 'hardcons',
            prefs: 'prefs',
            docs: 'docs'
          }
        },
        actions: {
          0: '',
          mapping: {
            style: 'style',
            icons: 'icons',
            actions: 'actions',
            hardcons: 'hardcons',
            docs: 'docs'
          }
        },
        steps_wizard: {
          0: '',
          mapping: {
            style: 'style',
            variables: 'variables',
            docs: 'docs'
          }
        },
        DOCS: {
          0: ''
        }
      },
      drive: {
        'icons/': {
          'console.svg': {
            $ref: 'console.svg'
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            raw: `
              .container {
                display: flex;
                flex-direction: column;
              }
              .action-bar-container {
                display: flex;
                flex-direction: row;
                flex-wrap: nowrap;
                align-items: center;
                background: #131315;
                padding: 8px;
                gap: 12px;
              }
              .command-history {
                display: flex;
                align-items: center;
              }
              .quick-actions {
                display: flex;
                flex: auto;
                flex-direction: row;
                flex-wrap: nowrap;
                align-items: center;
                min-width: 300px;
              }
              .hide {
                display: none;
              }
              
              .icon-btn {
                display: flex;
                min-width: 32px;
                height: 32px;
                border: none;
                background: transparent;
                cursor: pointer;
                flex-direction: row;
                justify-content: center;
                align-items: center;
                padding: 6px;
                border-radius: 6px;
                color: #a6a6a6;
              }
              .icon-btn:hover {
                background: rgba(255, 255, 255, 0.1);
              }
              svg {
                width: 20px;
                height: 20px;
              }
            `
          }
        },
        'actions/': {},
        'hardcons/': {},
        'prefs/': {},
        'variables/': {}
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/action_bar/action_bar.js")
},{"DOCS":3,"STATE":1,"actions":5,"quick_actions":18,"steps_wizard":21}],5:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = actions

async function actions (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    actions: onactions,
    icons: iconject,
    hardcons: onhardcons
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="actions-container main">
    <div class="actions-menu"></div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const actions_menu = shadow.querySelector('.actions-menu')

  let init = false
  let mid = 0
  let actions = []
  let icons = {}
  let hardcons = {}
  const docs = DOCS(__filename)(opts.sid)

  await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  return el

  function onmessage (msg) {
    const { type, data } = msg
    switch (type) {
    case 'filter_actions':
      filter(data)
      break
    case 'send_selected_action':
      send_selected_action(msg)
      break
    case 'load_actions':
      // Handle the new data format from program_protocol
      handleLoadActions(data)
      break
    case 'update_actions_for_app':
      update_actions_for_app(data)
      break
    default:
      fail(data, type)
    }
  }

  function handleLoadActions (data) {
    const converted_actions = Object.keys(data).map(actionKey => ({
      action: actionKey,
      pinned: false,
      default: true,
      icon: 'file'
    }))

    actions = converted_actions
    create_actions_menu()
  }

  function send_selected_action (msg) {
    const action_data = msg.type === 'send_selected_action' ? msg.data.data : msg.data

    const head = [by, to, mid++]
    const refs = msg.head ? { cause: msg.head } : {}

    _.up({
      head,
      refs,
      type: 'selected_action',
      data: action_data
    })
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      create_actions_menu()
      init = true
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function iconject (data) {
    icons = data
  }

  function onhardcons (data) {
    console.log('Hardcons data:', opts.sid, data)
    hardcons = {
      pin: data[0],
      unpin: data[1],
      default: data[2],
      undefault: data[3]
    }
  }

  function onactions (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    actions = vars
    create_actions_menu()
  }

  function create_actions_menu () {
    actions_menu.replaceChildren()
    actions.forEach(create_action_item)
  }

  function create_action_item (action_data, index) {
    const action_item = document.createElement('div')
    action_item.classList.add('action-item')

    const this_icon = icons[index] || icons[0]
    action_item.innerHTML = `
    <div class="action-icon">${this_icon}</div>
    <div class="action-name">${action_data.action}</div>
    <div class="action-pin">${action_data.pin ? hardcons.pin : hardcons.unpin}</div>
    <div class="action-default">${action_data.default ? hardcons.default : hardcons.undefault}</div>`
    action_item.onclick = docs.wrap(() => {
      send_selected_action({ data: action_data })
    }, async () => {
      const doc_file = await drive.get('docs/README.md')
      return doc_file?.raw || 'No documentation available'
    })
    actions_menu.appendChild(action_item)
  }

  function filter (search_term) {
    const items = shadow.querySelectorAll('.action-item')
    items.forEach(item => {
      const action_name = item.children[1].textContent.toLowerCase()
      const matches = action_name.includes(search_term.toLowerCase())
      item.style.display = matches ? 'flex' : 'none'
    })
  }

  async function update_actions_for_app (data) {
    console.log('Focused actions data:', data)
    const focused_app = data?.focused_app
    const temp_actions = data?.temp_actions
    if (temp_actions) {
      drive.put('actions/commands.json', temp_actions)
      console.log('Actions updated for focused app:', focused_app)
    } else {
      console.log('Actions unchanged for focused app:', temp_actions)
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'actions/': {
          'commands.json': {
            raw: JSON.stringify([
              {
                action: 'New File',
                pinned: true,
                default: true,
                icon: 'file'
              },
              {
                action: 'Open File',
                pinned: false,
                default: true,
                icon: 'folder'
              },
              {
                action: 'Save File',
                pinned: true,
                default: false,
                icon: 'save'
              },
              {
                action: 'Settings',
                pinned: false,
                default: true,
                icon: 'gear'
              },
              {
                action: 'Help',
                pinned: false,
                default: false,
                icon: 'help'
              },
              {
                action: 'Terminal',
                pinned: true,
                default: true,
                icon: 'terminal'
              },
              {
                action: 'Search',
                pinned: false,
                default: true,
                icon: 'search'
              }
            ])
          }
        },
        'icons/': {
          'file.svg': {
            $ref: 'icon.svg'
          },
          'folder.svg': {
            $ref: 'icon.svg'
          },
          'save.svg': {
            $ref: 'icon.svg'
          },
          'gear.svg': {
            $ref: 'icon.svg'
          },
          'help.svg': {
            $ref: 'icon.svg'
          },
          'terminal.svg': {
            $ref: 'icon.svg'
          },
          'search.svg': {
            $ref: 'icon.svg'
          }
        },
        'hardcons/': {
          'pin.svg': {
            $ref: 'pin.svg'
          },
          'unpin.svg': {
            $ref: 'unpin.svg'
          },
          'default.svg': {
            $ref: 'default.svg'
          },
          'undefault.svg': {
            $ref: 'undefault.svg'
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            raw: `
              .actions-container {
                position: relative;
                top: 0;
                left: 0;
                right: 0;
                background: #202124;
                border: 1px solid #3c3c3c;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                z-index: 1;
                max-height: 400px;
                overflow-y: auto;
                color: #e8eaed;
              }
              
              .actions-menu {
                padding: 8px 0;
              }
              
              .action-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 16px;
                cursor: pointer;
                border-bottom: 1px solid #3c3c3c;
                transition: background-color 0.2s ease;
              }
              
              .action-item:hover {
                background-color: #2d2f31;
              }
              
              .action-item:last-child {
                border-bottom: none;
              }
              
              .action-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                color: #a6a6a6;
              }
              
              .action-name {
                flex: 1;
                font-size: 14px;
                color: #e8eaed;
              }
              
              .action-pin .action-default{
                display: flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                font-size: 12px;
                opacity: 0.7;
                color: #a6a6a6;
              }
              
              svg {
                width: 16px;
                height: 16px;
              }
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/actions/actions.js")
},{"DOCS":3,"STATE":1}],6:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = console_history

async function console_history (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    commands: oncommands,
    icons: iconject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="console-history-container main">
    <div class="console-menu">
      <console-commands></console-commands>
    </div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const commands_placeholder = shadow.querySelector('console-commands')

  let init = false
  let mid = 0
  let commands = []
  let dricons = []
  const docs = DOCS(__filename)(opts.sid)

  await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }
  return el

  function onmessage (msg) {
    // Temp placeholder
  }

  function create_command_item (command_data) {
    const command_el = document.createElement('div')
    command_el.className = 'command-item'

    const icon_html = dricons[command_data.icon_type] || ''
    const linked_icon_html = command_data.linked.is ? (dricons[command_data.linked.icon_type] || '') : ''

    let action_html = ''
    action_html += command_data.can_restore ? '<div class="action-icon">' + (dricons.restore || '') + '</div>' : ''
    action_html += command_data.can_delete ? '<div class="action-icon">' + (dricons.delete || '') + '</div>' : ''
    action_html += command_data.action ? '<div class="action-text">' + command_data.action + '</div>' : ''

    command_el.innerHTML = `
    <div class="command-content">
    <div class="command-icon">${icon_html}</div>
    <div class="command-info">
      <div class="command-path">${command_data.name_path}</div>
    </div>
    ${command_data.linked.is
    ? `<div class="linked-info">
          <span class="command-separator">---&gt;</span>
          <div class="linked-icon">${linked_icon_html}</div>
          <div class="linked-name">${command_data.linked.name}</div>
        </div>`
    : ''}
      ${action_html
    ? `<div class="command-actions">${action_html}</div>`
    : ''}
        <div class="command-name">${command_data.command}</div>
      </div>`

    command_el.onclick = docs.wrap(async function () {
      const head = [by, to, mid++]
      const refs = {}
      _.up({ head, refs, type: 'ui_focus', data: 'command_history' })
      const head2 = [by, to, mid++]
      _.up({ head: head2, refs, type: 'command_clicked', data: command_data })
    }, async () => {
      const doc_file = await drive.get('docs/README.md')
      return doc_file?.raw || 'No documentation available'
    })

    return command_el
  }
  function render_commands () {
    const commands_container = document.createElement('div')
    commands_container.className = 'commands-list'

    commands.forEach((command, index) => {
      const command_item = create_command_item(command, index)
      commands_container.appendChild(command_item)
    })

    commands_placeholder.replaceWith(commands_container)
    init = true
  }
  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init && commands.length > 0) {
      render_commands()
    }
  }

  function fail (data, type) {
    console.warn('invalid message', { cause: { data, type } })
  }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function oncommands (data) {
    const commands_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    commands = commands_data
  }

  function iconject (data) {
    dricons = {
      file: data[0] || '',
      bulb: data[1] || '',
      restore: data[2] || '',
      delete: data[3] || ''
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'commands/': {
          'list.json': {
            $ref: 'commands.json'
          }
        },
        'icons/': {
          'file.svg': {
            raw: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9.5 1H3.5C3.10218 1 2.72064 1.15804 2.43934 1.43934C2.15804 1.72064 2 2.10218 2 2.5V13.5C2 13.8978 2.15804 14.2794 2.43934 14.5607C2.72064 14.8420 3.10218 15 3.5 15H12.5C12.8978 15 13.2794 14.8420 13.5607 14.5607C13.8420 14.2794 14 13.8978 14 13.5V5.5L9.5 1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9.5 1V5.5H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`
          },
          'bulb.svg': {
            raw: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 1C6.4087 1 4.88258 1.63214 3.75736 2.75736C2.63214 3.88258 2 5.4087 2 7C2 8.5913 2.63214 10.1174 3.75736 11.2426C4.88258 12.3679 6.4087 13 8 13C9.5913 13 11.1174 12.3679 12.2426 11.2426C13.3679 10.1174 14 8.5913 14 7C14 5.4087 13.3679 3.88258 12.2426 2.75736C11.1174 1.63214 9.5913 1 8 1Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M6.5 14H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`
          },
          'restore.svg': {
            raw: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-counterclockwise" viewBox="0 0 16 16">
              <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
              <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
            </svg>`
          },
          'delete.svg': {
            raw: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash3" viewBox="0 0 16 16">
              <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.58.58 0 0 0-.01 0H1.5a.5.5 0 0 0 0 1h.538l.853 10.66A2 2 0 0 0 4.885 16h6.23a2 2 0 0 0 1.994-1.84l.853-10.66h.538a.5.5 0 0 0 0-1h-.995a.59.59 0 0 0-.01 0H11Zm1.958 1-.846 10.58a1 1 0 0 1-.997.92H4.885a1 1 0 0 1-.997-.92L3.042 3.5h9.916Zm-7.487 1a.5.5 0 0 1 .528.47l.5 8.5a.5.5 0 0 1-.998.06L5 5.03a.5.5 0 0 1 .47-.528ZM8 4.5a.5.5 0 0 1 .5.5v8.5a.5.5 0 0 1-1 0V5a.5.5 0 0 1 .5-.5Zm2.522.47a.5.5 0 0 1 .528.47l-.5 8.5a.5.5 0 1 1-.998-.06l.5-8.5a.5.5 0 0 1 .47-.528Z"/>
            </svg>`
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            raw: `
              .console-history-container {
                position: relative;
                width: 100%; /* Or a specific width based on images */
                background: #202124;
                border: 1px solid #3c3c3c;
                Set box-sizing property to border-box:
                box-sizing: border-box;
                -moz-box-sizing: border-box;
                -webkit-box-sizing: border-box;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                z-index: 1;
                max-height: 400px;
                overflow-y: auto;
                color: #e8eaed;
              }

              .console-menu {
                padding: 0px;
              }

              .commands-list {
                display: flex;
                flex-direction: column;
                gap: 0px;
              }

              .command-item {
                display: flex;
                align-items: center;
                padding: 10px 16px;
                background: transparent;
                border-bottom: 1px solid #3c3c3c;
                cursor: pointer;
                transition: background-color 0.2s ease;
              }

              .command-item:last-child {
                border-bottom: none;
              }

              .command-item:hover {
                background: #282a2d;
              }

              .command-content {
                display: flex;
                align-items: center;
                width: 100%;
                gap: 10px; /* Adjusted gap */
              }

              .command-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                color: #969ba1;
              }

              .command-icon svg {
                width: 16px;
                height: 16px;
              }

              .command-info {
                display: flex; /* Use flex to align name and path */
                align-items: center; /* Vertically align items if they wrap */
                gap: 8px; /* Gap between name and path */
                min-width: 0; /* Prevent overflow issues with flex items */
              }

              .command-name {
                font-size: 13px;
                font-weight: 400;
                color: #e8eaed;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }

              .command-path {
                font-size: 13px;
                color: #969ba1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              
              .command-separator {
                color: #969ba1;
                margin: 0 4px;
                font-size: 13px;
              }

              .linked-info {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-grow: 1; /* Allow info to take available space */

              }

              .linked-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                color: #fbbc04; 
              }

              .linked-icon svg {
                width: 14px;
                height: 14px;
              }

              .linked-name {
                font-size: 13px;
                color: #fbbc04;
                font-weight: 400;
                white-space: nowrap;
              }

              .command-actions {
                display: flex;
                align-items: center;
                gap: 10px; /* Adjusted gap */
                margin-left: auto; /* Pushes actions to the right */
              }

              .action-text {
                font-size: 13px;
                color: #969ba1;
                white-space: nowrap;
              }

              .action-icon {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                color: #969ba1;
                cursor: pointer;
              }

              .action-icon:hover {
                color: #e8eaed;
              }

              .action-icon svg {
                width: 16px;
                height: 16px;
              }
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/console_history/console_history.js")
},{"DOCS":3,"STATE":1}],7:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = control_unit

async function control_unit (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  let send = null
  let _ = null
  let mid = 0

  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  await sdb.watch(() => {})

  async function onmessage (msg) {
    const { type, data } = msg

    if (type === 'focused_app_changed') {
      if (_.up) {
        const focused_app = data?.focused_app
        let actions_data = null

        if (focused_app) {
          const file = `temp_actions/${focused_app}.json`
          const temp_actions_file = await drive.get(file)
          if (temp_actions_file) {
            actions_data = typeof temp_actions_file.raw === 'string' ? JSON.parse(temp_actions_file.raw) : temp_actions_file.raw
          }
        }

        const message_data = {
          ...data,
          temp_actions: actions_data
        }
        const head = [by, to, mid++]
        const refs = msg.head ? { cause: msg.head } : {}
        _.up({ head, refs, type: 'update_actions_for_app', data: message_data })

        let quick_actions_data = null

        if (focused_app) {
          const file = `temp_quick_actions/${focused_app}.json`
          const temp_quick_actions_file = await drive.get(file)
          if (temp_quick_actions_file) {
            quick_actions_data = typeof temp_quick_actions_file.raw === 'string' ? JSON.parse(temp_quick_actions_file.raw) : temp_quick_actions_file.raw
          }
        }

        const quick_actions_message_data = {
          ...data,
          temp_quick_actions: quick_actions_data
        }
        const quick_actions_head = [by, to, mid++]
        const quick_actions_refs = msg.head ? { cause: msg.head } : {}
        _.up({ head: quick_actions_head, refs: quick_actions_refs, type: 'update_quick_actions_for_app', data: quick_actions_message_data })
      }
    }
  }

}

function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'temp_actions/': {
          'command_history.json': {
            raw: JSON.stringify([
              {
                action: 'Clear History',
                pinned: false,
                default: true,
                icon: 'trash'
              },
              {
                action: 'Export History',
                pinned: true,
                default: false,
                icon: 'download'
              },
              {
                action: 'Search History',
                pinned: false,
                default: true,
                icon: 'search'
              }
            ])
          },
          'task_manager.json': {
            raw: JSON.stringify([
              {
                action: 'Kill Process',
                pinned: false,
                default: true,
                icon: 'stop'
              },
              {
                action: 'Restart Task',
                pinned: true,
                default: false,
                icon: 'refresh'
              },
              {
                action: 'Task Details',
                pinned: false,
                default: true,
                icon: 'info'
              }
            ])
          },
          'tab.json': {
            raw: JSON.stringify([
              {
                action: 'New Tab',
                pinned: true,
                default: true,
                icon: 'plus'
              },
              {
                action: 'Duplicate Tab',
                pinned: false,
                default: false,
                icon: 'copy'
              },
              {
                action: 'Close Tab',
                pinned: false,
                default: true,
                icon: 'close'
              }
            ])
          },
          'wizard_hat.json': {
            raw: JSON.stringify([
              {
                action: 'New File',
                pinned: true,
                default: true,
                icon: 'file'
              },
              {
                action: 'Open File',
                pinned: false,
                default: true,
                icon: 'folder'
              },
              {
                action: 'Save File',
                pinned: true,
                default: false,
                icon: 'save'
              },
              {
                action: 'Settings',
                pinned: false,
                default: true,
                icon: 'gear'
              },
              {
                action: 'Help',
                pinned: false,
                default: false,
                icon: 'help'
              },
              {
                action: 'Terminal',
                pinned: true,
                default: true,
                icon: 'terminal'
              },
              {
                action: 'Search',
                pinned: false,
                default: true,
                icon: 'search'
              }
            ])
          },
          'help_button.json': {
            raw: JSON.stringify([
              {
                action: 'Get Help',
                pinned: true,
                default: true,
                icon: 'help'
              },
              {
                action: 'Documentation',
                pinned: false,
                default: true,
                icon: 'book'
              },
              {
                action: 'Tutorial',
                pinned: false,
                default: false,
                icon: 'graduation-cap'
              },
              {
                action: 'Contact Support',
                pinned: true,
                default: false,
                icon: 'support'
              }
            ])
          }
        },
        'temp_quick_actions/': {
          'command_history.json': {
            raw: JSON.stringify([
              {
                name: 'Clear History',
                icon: '0',
                action: 'clear_history'
              },
              {
                name: 'Export History',
                icon: '1',
                action: 'export_history'
              },
              {
                name: 'Search History',
                icon: '2',
                action: 'search_history'
              }
            ])
          },
          'task_manager.json': {
            raw: JSON.stringify([
              {
                name: 'Kill Process',
                icon: '0',
                action: 'kill_process'
              },
              {
                name: 'Restart Task',
                icon: '1',
                action: 'restart_task'
              },
              {
                name: 'Task Details',
                icon: '2',
                action: 'task_details'
              }
            ])
          },
          'tab.json': {
            raw: JSON.stringify([
              {
                name: 'New Tab',
                icon: '0',
                action: 'new_tab'
              },
              {
                name: 'Duplicate Tab',
                icon: '1',
                action: 'duplicate_tab'
              },
              {
                name: 'Close Tab',
                icon: '2',
                action: 'close_tab'
              }
            ])
          },
          'wizard_hat.json': {
            raw: JSON.stringify([
              {
                name: 'New File',
                icon: '0',
                action: 'new_file'
              },
              {
                name: 'Open File',
                icon: '1',
                action: 'open_file'
              },
              {
                name: 'Save File',
                icon: '2',
                action: 'save_file'
              },
              {
                name: 'Settings',
                icon: '3',
                action: 'settings'
              },
              {
                name: 'Help',
                icon: '4',
                action: 'help'
              },
              {
                name: 'Terminal',
                icon: '0',
                action: 'terminal'
              },
              {
                name: 'Search',
                icon: '2',
                action: 'search'
              }
            ])
          },
          'help_button.json': {
            raw: JSON.stringify([
              {
                name: 'Get Help',
                icon: '0',
                action: 'get_help'
              },
              {
                name: 'Documentation',
                icon: '1',
                action: 'documentation'
              },
              {
                name: 'Tutorial',
                icon: '2',
                action: 'tutorial'
              },
              {
                name: 'Contact Support',
                icon: '3',
                action: 'contact_support'
              }
            ])
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/control_unit/control_unit.js")
},{"STATE":1}],8:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = docs_window

async function docs_window (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject
  }

  let mid = 0
  let _ = { up: null }
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="docs-window main">
    <button class="close-btn">✕</button>
    <div class="docs-content">
      <pre class="docs-text">No documentation available</pre>
    </div>
  </div>
  <style></style>`

  const style = shadow.querySelector('style')
  const close_btn = shadow.querySelector('.close-btn')
  const docs_text = shadow.querySelector('.docs-text')

  close_btn.onclick = onclose

  await sdb.watch(onbatch)

  return el

  function onclose () {
    const head = [by, to, mid++]
    const refs = {}
    _.up?.({ head, refs, type: 'close_docs', data: null })
  }

  function onmessage (msg) {
    const { type, data } = msg
    if (type === 'display_doc') {
      display_content(data)
    }
  }

  function display_content (data) {
    const content = data?.content
    docs_text.textContent = content || 'No documentation available'
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }
}

function fallback_module () {
  return {
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .docs-window {
                position: relative;
                background: #1e1e2e;
                border: 1px solid #3c3c3c;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                color: #e8eaed;
                overflow: hidden;
                display: flex;
                justify-content: space-between;
                flex-direction: row-reverse;
                flex-wrap: nowrap;
                align-items: flex-start;
              }
              .close-btn {
                background: transparent;
                border: none;
                color: #a6a6a6;
                cursor: pointer;
                font-size: 16px;
                padding: 4px 8px;
                border-radius: 4px;
                transition: background 0.2s, color 0.2s;
              }
              .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #e8eaed;
              }
              .docs-content {
                padding: 16px;
                max-height: 200px;
                overflow-y: auto;
              }
              .docs-text {
                font-size: 13px;
                line-height: 1.6;
                color: #c9d1d9;
                margin: 0;
                white-space: pre-wrap;
                word-wrap: break-word;
              }
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/docs_window/docs_window.js")
},{"STATE":1}],9:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = focus_tracker

async function focus_tracker (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    focused
  }
  // Keep track of the last focused element
  let last_focused = null
  let mid = 0
  let _ = null

  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  function onmessage (msg) {
    if (msg.type === 'ui_focus') {
      drive.put('focused/current.json', { value: msg.data })
    }
  }

  await sdb.watch(onbatch)

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
  function focused (data) {
    const tmp = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    if (_ && last_focused !== tmp.value) {
      const head = [by, to, mid++]
      const refs = {}
      _.up({ head, refs, type: 'focused_app_changed', data: { focused_app: tmp.value } })
    }

    last_focused = tmp.value
  }
}

function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'focused/': {
          'current.json': {
            raw: { value: 'default' }
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/focus_tracker/focus_tracker.js")
},{"STATE":1}],10:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = form_input
async function form_input (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    data: ondata
  }

  let current_step = null
  let input_accessible = true
  let mid = 0

  let _ = { up: null }
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="input-display">
    <div class='test'>
      <input class="input-field" type="text" placeholder="Type to submit">
    </div>
    <div class="overlay-lock" hidden></div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')

  const input_field_el = shadow.querySelector('.input-field')
  const overlay_el = shadow.querySelector('.overlay-lock')

  input_field_el.oninput = async function () {
    if (!input_accessible) return
    await drive.put('data/form_input.json', {
      input_field: this.value
    })
    if (this.value.length >= 10) {
      const head = [by, to, mid++]
      const refs = {}
      _.up({
        head,
        refs,
        type: 'action_submitted',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
      console.log('mark_as_complete')
    } else {
      const head = [by, to, mid++]
      const refs = {}
      _.up({
        head,
        refs,
        type: 'action_incomplete',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
    }
  }

  await sdb.watch(onbatch)
  const parent_handler = {
    step_data,
    reset_data
  }

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }

  function ondata (data) {
    if (data && data.length > 0) {
      const input_data = data[0]
      if (input_data && input_data.input_field) {
        input_field_el.value = input_data.input_field
      }
    } else {
      input_field_el.value = ''
    }
  }

  function onmessage ({ type, data }) {
    console.log('message from form_input', type, data)
    parent_handler[type]?.(data, type)
  }

  function step_data (data, type) {
    current_step = data

    input_accessible = data?.is_accessible !== false

    overlay_el.hidden = input_accessible

    input_field_el.placeholder = input_accessible
      ? 'Type to submit'
      : 'Input disabled for this step'
  }

  function reset_data (data, type) {
    input_field_el.value = ''
    drive.put('data/form_input.json', {
      input_field: ''
    })
  }
}
function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }
  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
            .input-display {
              position: relative;
              background: #131315;
              border-radius: 16px;
              border: 1px solid #3c3c3c;
              display: flex;
              flex: 1;
              align-items: center;
              padding: 0 12px;
              min-height: 32px;
            }
            .input-display:focus-within {
              border-color: #4285f4;
              background: #1a1a1c;
            }
            .input-field {
              flex: 1;
              min-height: 32px;
              background: transparent;
              border: none;
              color: #e8eaed;
              padding: 0 12px;
              font-size: 14px;
              outline: none;
            }
            .input-field::placeholder {
              color: #a6a6a6;
            }
            .overlay-lock {
              position: absolute;
              inset: 0;
              background: transparent;
              z-index: 10;
              cursor: not-allowed;
            }`
          }
        },
        'data/': {
          'form_input.json': {
            raw: {
              input_field: ''
            }
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/form_input/form_input.js")
},{"DOCS":3,"STATE":1}],11:[function(require,module,exports){
module.exports = graphdb

function graphdb (entries) {
  // Validate entries
  if (!entries || typeof entries !== 'object') {
    console.warn('[graphdb] Invalid entries provided, using empty object')
    entries = {}
  }

  const api = {
    get,
    has,
    keys,
    is_empty,
    root,
    raw
  }

  return api

  function get (path) {
    return entries[path] || null
  }

  function has (path) {
    return path in entries
  }
  function keys () {
    return Object.keys(entries)
  }

  function is_empty () {
    return Object.keys(entries).length === 0
  }

  function root () {
    return entries['/'] || null
  }

  function raw () {
    return entries
  }
}

},{}],12:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const graph_explorer = require('graph-explorer')
const graphdb = require('./graphdb')

module.exports = graph_explorer_wrapper

async function graph_explorer_wrapper (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  // const to = ids.up

  let db = null
  // Protocol
  let send_to_graph_explorer = null
  let mid = 0

  const on = {
    theme: inject,
    entries: on_entries
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  const sheet = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [sheet]

  const subs = await sdb.watch(onbatch)
  const graph_explorer_sid = subs[0].sid

  const explorer_el = await graph_explorer(subs[0], graph_explorer_protocol)
  shadow.append(explorer_el)

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      on[type] && on[type](data)
    }
  }

  function inject (data) {
    sheet.replaceSync(data.join('\n'))
  }

  function on_entries (data) {
    if (!data || !data[0]) {
      console.error('Entries data is missing or empty.')
      db = graphdb({})
      notify_db_initialized({})
      return
    }

    let parsed_data
    try {
      parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    } catch (e) {
      console.error('Failed to parse entries data:', e)
      parsed_data = {}
    }

    if (typeof parsed_data !== 'object' || !parsed_data) {
      console.error('Parsed entries data is not a valid object.')
      parsed_data = {}
    }

    db = graphdb(parsed_data)
    notify_db_initialized(parsed_data)
  }

  function notify_db_initialized (entries) {
    if (send_to_graph_explorer) {
      const head = [by, graph_explorer_sid, mid++]
      send_to_graph_explorer({
        head,
        type: 'db_initialized',
        data: { entries }
      })
    }
  }

  // ---------------------------------------------------------
  // PROTOCOL
  // ---------------------------------------------------------

  function graph_explorer_protocol (send) {
    send_to_graph_explorer = send
    return on_graph_explorer_message

    function on_graph_explorer_message (msg) {
      const { type } = msg

      if (type === 'docs_toggle') {
        // docs_toggle received
      } else if (type.startsWith('db_')) {
        handle_db_request(msg, send)
      }
    }

    function handle_db_request (request_msg, send) {
      const { head: request_head, type: operation, data: params } = request_msg
      let result

      if (!db) {
        console.error('[graph_explorer_wrapper] Database not initialized yet')
        send_response(request_head, null)
        return
      }

      if (operation === 'db_get') {
        result = db.get(params.path)
      } else if (operation === 'db_has') {
        result = db.has(params.path)
      } else if (operation === 'db_is_empty') {
        result = db.is_empty()
      } else if (operation === 'db_root') {
        result = db.root()
      } else if (operation === 'db_keys') {
        result = db.keys()
      } else if (operation === 'db_raw') {
        result = db.raw()
      } else {
        console.warn('[graph_explorer_wrapper] Unknown db operation:', operation)
        result = null
      }

      send_response(request_head, result)

      function send_response (request_head, result) {
        // Standardized response message
        // head: [by, to, mid]
        const response_head = [by, graph_explorer_sid, mid++]
        send({
          head: response_head,
          refs: { cause: request_head }, // Reference original request
          type: 'db_response',
          data: { result }
        })
      }
    }
  }
}
function fallback_module () {
  return {
    _: {
      'graph-explorer': {
        $: ''
      },
      './graphdb': {
        $: ''
      }
    },
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      _: {
        'graph-explorer': {
          $: '',
          0: '',
          mapping: {
            style: 'theme',
            runtime: 'runtime',
            mode: 'mode',
            flags: 'flags',
            keybinds: 'keybinds',
            undo: 'undo',
            docs: 'docs'
          }
        },
        './graphdb': {
          $: ''
        }
      },
      drive: {
        'theme/': {
          'style.css': {
            raw: `
              :host {
              display: block;
              height: 100%;
              width: 100%;
              }
            `
          }
        },
        'entries/': {
          'entries.json': {
            $ref: 'entries.json'
          }
        },
        'runtime/': {},
        'mode/': {},
        'flags/': {},
        'keybinds/': {},
        'undo/': {},
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/graph_explorer_wrapper/index.js")
},{"./graphdb":11,"STATE":1,"graph-explorer":2}],13:[function(require,module,exports){
module.exports = { resource }

function resource (timeout = 1000) {
  const states = {}
  return { set, get }
  function load (pid) { return states[pid] || (states[pid] = { item: null, pending: [] }) }
  function set (pid, item) {
    const state = load(pid)
    state.item = item
    const { pending } = state
    state.pending = []
    pending.map(wait => wait.resolve(item))
  }
  function get (pid) {
    return new Promise(on)
    function on (resolve, reject) {
      const { item, pending } = load(pid)
      if (item) return resolve(item)
      pending.push({ resolve, reject })
    }
  }
}

},{}],14:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = input_test
async function input_test (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    data: ondata
  }

  let current_step = null
  let input_accessible = true
  let mid = 0
  let _ = { up: null }
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class='title'> Testing 2nd Type </div>
  <div class="input-display">
    <input class="input-field" type="text" placeholder="Type to submit">
    <div class="overlay-lock" hidden></div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')

  const input_field_el = shadow.querySelector('.input-field')
  const overlay_el = shadow.querySelector('.overlay-lock')

  input_field_el.oninput = async function () {
    if (!input_accessible) return

    await drive.put('data/input_test.json', {
      input_field: this.value
    })

    if (this.value.length >= 10) {
      const head = [by, to, mid++]
      const refs = {}
      _.up({
        head,
        refs,
        type: 'action_submitted',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
      console.log('mark_as_complete')
    } else {
      const head = [by, to, mid++]
      const refs = {}
      _.up({
        head,
        refs,
        type: 'action_incomplete',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
    }
  }

  await sdb.watch(onbatch)

  const parent_handler = {
    step_data,
    reset_data
  }

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }

  function ondata (data) {
    if (data && data.length > 0) {
      const input_data = data[0]
      if (input_data && input_data.input_field) {
        input_field_el.value = input_data.input_field
      }
    } else {
      input_field_el.value = ''
    }
  }

  // ------------------
  // Parent Observer
  // ------------------

  function onmessage ({ type, data }) {
    console.log('message from input_test', type, data)
    parent_handler[type]?.(data, type)
  }

  function step_data (data, type) {
    current_step = data

    input_accessible = data?.is_accessible !== false

    overlay_el.hidden = input_accessible

    input_field_el.placeholder = input_accessible
      ? 'Type to submit'
      : 'Input disabled for this step'
  }

  function reset_data (data, type) {
    input_field_el.value = ''
    drive.put('data/input_test.json', {
      input_field: ''
    })
  }
}
function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }
  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
            .title {
              color: #e8eaed;
              font-size: 18px;
            }
            .input-display {
              position: relative;
              background: #131315;
              border-radius: 16px;
              border: 1px solid #3c3c3c;
              display: flex;
              flex: 1;
              align-items: center;
              padding: 0 12px;
              min-height: 32px;
            }
            .input-display:focus-within {
              border-color: #4285f4;
              background: #1a1a1c;
            }
            .input-field {
              flex: 1;
              min-height: 32px;
              background: transparent;
              border: none;
              color: #e8eaed;
              padding: 0 12px;
              font-size: 14px;
              outline: none;
            }
            .input-field::placeholder {
              color: #a6a6a6;
            }
            .overlay-lock {
              position: absolute;
              inset: 0;
              background: transparent;
              z-index: 10;
              cursor: not-allowed;
            }`
          }
        },
        'data/': {
          'input_test.json': {
            raw: {
              input_field: ''
            }
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/input_test/input_test.js")
},{"DOCS":3,"STATE":1}],15:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

const program = require('program')
const action_bar = require('action_bar')

const { form_input, input_test } = program

const component_modules = {
  form_input,
  input_test
  // Add more form input components here if needed
}

module.exports = manager

async function manager (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  // const to = ids.up

  const on = {
    style: inject
  }

  let variables = []
  let selected_action = null
  let mid = 0

  let _ = null
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send, send_actions_bar: null, send_form_input: {}, send_program: null }
  } else {
    _ = { send_actions_bar: null, send_form_input: {}, send_program: null }
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <div class="main">
      <form-input></form-input>
      <action-bar></action-bar>
      <program></program>
    </div>
    <style></style>
  `

  const style = shadow.querySelector('style')
  const form_input_placeholder = shadow.querySelector('form-input')
  const program_placeholder = shadow.querySelector('program')
  const action_bar_placeholder = shadow.querySelector('action-bar')

  const subs = await sdb.watch(onbatch)

  const action_bar_sid = subs[0].sid
  const program_sid = subs[1].sid
  const form_input_sids = {}

  // dynamic form input component SIDs
  for (const [index, [component_name]] of Object.entries(component_modules).entries()) {
    const final_index = index + 2
    form_input_sids[component_name] = subs[final_index].sid
  }

  const action_bar_el = await action_bar({ ...subs[0], ids: { up: id } }, actions_bar_protocol)
  action_bar_placeholder.replaceWith(action_bar_el)

  const program_el = await program({ ...subs[1], ids: { up: id } }, program_protocol)
  program_el.classList.add('hide')
  program_placeholder.replaceWith(program_el)

  const form_input_elements = {}

  console.log('subs', subs)

  for (const [index, [component_name, component_fn]] of Object.entries(component_modules).entries()) {
    const final_index = index + 2

    console.log('final_index', final_index, component_name, subs[final_index])

    const el = await component_fn({ ...subs[final_index], ids: { up: id } }, form_input_protocol(component_name))
    el.classList.add('hide')
    form_input_elements[component_name] = el
    form_input_placeholder.parentNode.insertBefore(el, form_input_placeholder)
  }

  form_input_placeholder.remove()

  return el

  function onmessage (msg) {
    const { type } = msg
    switch (type) {
    case 'docs_toggle':
      _.send_actions_bar(msg)
      for (const name in _.send_form_input) {
        _.send_form_input[name](msg)
      }
      break
    case 'update_actions_for_app':
      const head_to_action_bar = [by, action_bar_sid, mid++]
      const refs = msg.head ? { cause: msg.head } : {}
      _.send_actions_bar?.({ head: head_to_action_bar, refs, type, data: msg.data })
    case 'update_quick_actions_for_app':
      const head_to_quick_actions = [by, action_bar_sid, mid++]
      const quick_refs = msg.head ? { cause: msg.head } : {}
      _.send_actions_bar?.({ head: head_to_quick_actions, quick_refs, type, data: msg.data })
      break
    default: // @TODO Handle message types
    }
  }

  // --- Internal Functions ---
  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) {
    console.warn('invalid message', { cause: { data, type } })
  }

  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }

  function toggle_view (el, show) {
    el.classList.toggle('hide', !show)
  }

  function render_form_component (component_name) {
    for (const name in form_input_elements) {
      toggle_view(form_input_elements[name], name === component_name)
    }
  }

  // -------------------------------
  // Protocol: form input
  // -------------------------------

  function form_input_protocol (component_name) {
    return function (send) {
      _.send_form_input[component_name] = send

      const form_input_handlers = {
        action_submitted: form__action_submitted,
        action_incomplete: form__action_incomplete
      }

      return on
      function on (msg) {
        const { type, data } = msg
        const handler = form_input_handlers[type] || fail
        handler(data, type, msg)
      }
    }
  }

  function form__action_submitted (data, type, msg) {
    console.log('manager.on_form_submitted', data, variables, selected_action)
    const step = variables[selected_action][data?.index]
    Object.assign(step, {
      is_completed: true,
      status: 'completed',
      data: data?.value
    })
    const head_to_program = [by, program_sid, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.send_program?.({ head: head_to_program, refs, type: 'update_data', data: variables })

    const head_to_action_bar = [by, action_bar_sid, mid++]
    _?.send_actions_bar({ head: head_to_action_bar, refs, type: 'form_data', data: variables[selected_action] })

    if (variables[selected_action][variables[selected_action].length - 1]?.is_completed) {
      const head_to_action_bar_submit = [by, action_bar_sid, mid++]
      _.send_actions_bar({ head: head_to_action_bar_submit, refs, type: 'show_submit_btn' })
    }
  }

  function form__action_incomplete (data, type, msg) {
    console.log('manager.on_form_incomplete', data, variables, selected_action)
    const step = variables[selected_action][data?.index]

    if (!step.is_completed) return

    Object.assign(step, {
      is_completed: false,
      status: 'error',
      data: data?.value
    })
    const head_to_program = [by, program_sid, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.send_program?.({ head: head_to_program, refs, type: 'update_data', data: variables })

    const head_to_action_bar = [by, action_bar_sid, mid++]
    _?.send_actions_bar({ head: head_to_action_bar, refs, type: 'form_data', data: variables[selected_action] })

    const head_to_action_bar_hide = [by, action_bar_sid, mid++]
    _.send_actions_bar({ head: head_to_action_bar_hide, refs, type: 'hide_submit_btn' })
  }

  // -------------------------------
  // Protocol: program
  // -------------------------------

  function program_protocol (send) {
    _.send_program = send

    const program_handlers = {
      load_actions: program__load_actions
    }
    return function on (msg) {
      const { type, data } = msg
      const handler = program_handlers[type] || fail
      handler(data, type, msg)
    }
  }

  function program__load_actions (data, type, msg) {
    variables = data
    const head = [by, action_bar_sid, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.send_actions_bar?.({ head, refs, type, data })
  }

  // -------------------------------
  // Protocol: action bar
  // -------------------------------

  function actions_bar_protocol (send) {
    _.send_actions_bar = send

    const action_bar_handlers = {
      render_form: action_bar__render_form,
      clean_up: action_bar__clean_up,
      action_submitted: action_bar__action_submitted,
      selected_action: action_bar__selected_action
    }

    return function on (msg) {
      if (msg.type === 'console_history_toggle' || msg.type === 'ui_focus') {
        _.up(msg)
        return
      }

      const { type, data } = msg
      const handler = action_bar_handlers[type] || fail
      handler(data, type, msg)
    }
  }

  function action_bar__render_form (data, type, msg) {
    render_form_component(data.component)
    const send = _.send_form_input[data.component]
    if (send) {
      const head = [by, form_input_sids[data.component], mid++]
      const refs = msg.head ? { cause: msg.head } : {}
      send({ head, refs, type: 'step_data', data })
    }
  }

  function action_bar__action_submitted (data, type, msg) {
    const head = [by, program_sid, mid++]
    const refs = msg.head ? { cause: msg.head } : {}
    _.send_program({ head, refs, type: 'display_result', data })
  }

  function action_bar__selected_action (data, type, msg) {
    selected_action = data
  }

  function action_bar__clean_up (data, type, msg) {
    data && cleanup(data, msg)
  }

  function cleanup (selected_action, msg) {
    const cleaned = variables[selected_action].map(step => ({
      ...step,
      is_completed: false,
      data: ''
    }))
    variables[selected_action] = cleaned
    const head_to_program = [by, program_sid, mid++]
    const refs = msg?.head ? { cause: msg.head } : {}
    _.send_program?.({ head: head_to_program, refs, type: 'update_data', data: variables })

    for (const step of variables[selected_action]) {
      if (step.component && _.send_form_input[step.component]) {
        const head_to_input = [by, form_input_sids[step.component], mid++]
        _.send_form_input[step.component]({ head: head_to_input, refs, type: 'reset_data' })
      }
    }

    for (const el of Object.values(form_input_elements)) {
      console.log('toggle_view', el, false)
      toggle_view(el, false)
    }
  }
}

// --- Fallback Module ---
function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      action_bar: { $: '' },
      program: { $: '' },
      DOCS: { $: '' }
    }
  }

  function fallback_instance () {
    return {
      _: {
        action_bar: {
          0: '',
          mapping: {
            icons: 'icons',
            style: 'style',
            actions: 'actions',
            variables: 'variables',
            hardcons: 'hardcons',
            prefs: 'prefs',
            docs: 'docs'
          }
        },
        program: {
          0: '',
          mapping: {
            style: 'style',
            variables: 'variables',
            docs: 'docs'
          }
        },
        'program>form_input': {
          0: '',
          mapping: {
            style: 'style',
            data: 'data',
            docs: 'docs'
          }
        },
        'program>input_test': {
          0: '',
          mapping: {
            style: 'style',
            data: 'data',
            docs: 'docs'
          },
          DOCS: {
            0: ''
          }
        }
      },
      drive: {
        'style/': {
          'manager.css': {
            raw: `
              .main {
                display: flex;
                flex-direction: column;
                width: 100%;
                height: 100%;
                background: #131315;
              }
              .hide {
                display: none;
              }
            `
          }
        },
        'variables/': {},
        'data/': {},
        'actions/': {},
        'hardcons/': {},
        'prefs/': {},
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/manager/manager.js")
},{"DOCS":3,"STATE":1,"action_bar":4,"program":17}],16:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = create_component_menu
async function create_component_menu (opts, names, inicheck, callbacks) {
  const { sdb } = await get(opts.sid)
  const { drive } = sdb
  const on = {
    style: inject
  }
  const {
    on_checkbox_change,
    on_label_click,
    on_select_all_toggle,
    on_resize_toggle
  } = callbacks

  const checkobject = {}
  inicheck.forEach(i => {
    checkobject[i - 1] = true
  })
  const all_checked = inicheck.length === 0 || Object.keys(checkobject).length === names.length

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="nav-bar-container-inner main">
    <div class="nav-bar">
      <button class="menu-toggle-button">☰ MENU</button>
      <div class="menu hidden">
        <div class="menu-header">
          <button class="unselect-all-button">${all_checked ? 'Unselect All' : 'Select All'}</button>
          <button class="resize-toggle-button">Toggle Resize</button>
        </div>
        <ul class="menu-list"></ul>
      </div>
    </div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const menu = shadow.querySelector('.menu')
  const toggle_btn = shadow.querySelector('.menu-toggle-button')
  const unselect_btn = shadow.querySelector('.unselect-all-button')
  const resize_btn = shadow.querySelector('.resize-toggle-button')
  const list = shadow.querySelector('.menu-list')

  names.forEach((name, index) => {
    const is_checked = all_checked || checkobject[index] === true
    const menu_item = document.createElement('li')
    menu_item.className = 'menu-item'
    menu_item.innerHTML = `
      <span data-index="${index}" data-name="${name}">${name}</span>
      <input type="checkbox" data-index="${index}" ${is_checked ? 'checked' : ''}>
    `
    list.appendChild(menu_item)

    const checkbox = menu_item.querySelector('input')
    const label = menu_item.querySelector('span')

    checkbox.onchange = (e) => {
      on_checkbox_change({ index, checked: e.target.checked })
    }

    label.onclick = () => {
      on_label_click({ index, name })
      menu.classList.add('hidden')
    }
  })
  await sdb.watch(onbatch)
  // event listeners
  console.log('resize_btn', resize_btn)
  toggle_btn.onclick = on_toggle_btn
  unselect_btn.onclick = on_unselect_btn
  resize_btn.onclick = on_resize_btn
  document.onclick = handle_document_click

  return el

  function on_toggle_btn (e) {
    e.stopPropagation()
    menu.classList.toggle('hidden')
  }

  function on_unselect_btn () {
    const select_all = unselect_btn.textContent === 'Select All'
    unselect_btn.textContent = select_all ? 'Unselect All' : 'Select All'
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = select_all })
    on_select_all_toggle({ selectAll: select_all })
  }

  function on_resize_btn () {
    console.log('on_resize_btn')
    on_resize_toggle()
  }

  function handle_document_click (e) {
    const path = e.composedPath()
    if (!menu.classList.contains('hidden') && !path.includes(el)) {
      menu.classList.add('hidden')
    }
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.textContent = data.join('\n')
  }
}
function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'style/': {
          'theme.css': {
            raw: `
            :host {
              display: block;
              position: sticky;
              top: 0;
              z-index: 100;
              background-color: #e0e0e0;
            }

            .nav-bar-container-inner {
            }

            .nav-bar {
              display: flex;
              position: relative;
              justify-content: center;
              align-items: center;
              padding: 10px 20px;
              border-bottom: 2px solid #333;
              min-height: 30px;
            }

            .menu-toggle-button {
              padding: 10px;
              background-color: #e0e0e0;
              border: none;
              cursor: pointer;
              border-radius: 5px;
              font-weight: bold;
            }

            .menu-toggle-button:hover {
              background-color: #d0d0d0;
            }

            .menu.hidden {
              display: none;
            }

            .menu {
              display: block;
              position: absolute;
              top: 100%;
              left: 50%;
              transform: translateX(-50%);
              width: 250px;
              max-width: 90%;
              background-color: #f0f0f0;
              padding: 10px;
              border-radius: 0 0 5px 5px;
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
              z-index: 101;
            }

            .menu-header {
              margin-bottom: 10px;
              text-align: center;
            }

            .unselect-all-button {
              padding: 8px 12px;
              border: none;
              background-color: #d0d0d0;
              cursor: pointer;
              border-radius: 5px;
              width: 100%;
              margin-bottom: 5px;
            }

            .unselect-all-button:hover {
              background-color: #c0c0c0;
            }

            .resize-toggle-button {
              padding: 8px 12px;
              border: none;
              background-color: #d0d0d0;
              cursor: pointer;
              border-radius: 5px;
              width: 100%;
            }

            .resize-toggle-button:hover {
              background-color: #c0c0c0;
            }

            .menu-list {
              list-style: none;
              padding: 0;
              margin: 0;
              max-height: 400px;
              overflow-y: auto;
              background-color: #f0f0f0;
            }

            .menu-list::-webkit-scrollbar {
              width: 8px;
            }

            .menu-list::-webkit-scrollbar-track {
              background: #f0f0f0;
            }

            .menu-list::-webkit-scrollbar-thumb {
              background: #ccc;
              border-radius: 4px;
            }

            .menu-list::-webkit-scrollbar-thumb:hover {
              background: #bbb;
            }

            .menu-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 8px 5px;
              border-bottom: 1px solid #ccc;
            }

            .menu-item span {
              cursor: pointer;
              flex-grow: 1;
              margin-right: 10px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .menu-item span:hover {
              color: #007bff;
            }

            .menu-item:last-child {
              border-bottom: none;
            }

            .menu-item input[type="checkbox"] {
              flex-shrink: 0;
            }`
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/menu/menu.js")
},{"STATE":1}],17:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

const form_input = require('form_input')
const input_test = require('input_test')

program.form_input = form_input
program.input_test = input_test

module.exports = program

async function program (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up
  // console.log('program-ids', by, to)
  const on = {
    style: inject,
    variables: onvariables
  }

  const _ = {
    up: null
  }
  let mid = 0

  if (protocol) {
    const send = protocol((msg) => onmessage(msg))
    _.up = send
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style></style>
  `

  const style = shadow.querySelector('style')

  await sdb.watch(onbatch)

  const parent_handler = {
    display_result,
    update_data
  }

  return el

  // --- Internal Functions ---
  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) {
    console.warn('invalid message', { cause: { data, type } })
  }

  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }

  function onvariables (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    const head = [by, to, mid++]
    const refs = {}
    _?.up({
      head,
      refs,
      type: 'load_actions',
      data: vars
    })
  }

  function onmessage ({ type, data }) {
    parent_handler[type]?.(data, type)
  }
  function display_result (data) {
    console.log('Display Result:', data)
    alert(`Result of action(${data?.selected_action}): ${data?.result}`)
  }
  function update_data (data) {
    drive.put('variables/program.json', data)
  }
}

// --- Fallback Module ---
function fallback_module () {
  return {
    api: fallback_instance,
    _: {

      form_input: { $: '' },
      input_test: { $: '' }
    }
  }

  function fallback_instance () {
    return {
      drive: {
        'style/': {
          'program.css': {
            raw: `
              .main {
                display: flex;
                flex-direction: column;
                align-items: center;
              }
            `
          }
        },
        'variables/': {
          'program.json': { $ref: 'program.json' }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/program/program.js")
},{"STATE":1,"form_input":10,"input_test":14}],18:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = quick_actions

async function quick_actions (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    icons: iconject,
    hardcons: onhardcons,
    actions: onactions,
    prefs: onprefs
  }

  const el = document.createElement('div')
  el.style.display = 'flex'
  el.style.flex = 'auto'

  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="quick-actions-container main">
    <div class="default-actions"></div>
    <div class="text-bar" role="button"></div>
    <div class="input-wrapper" style="display: none;">
      <div class="input-display">
        <span class="slash-prefix">/</span>
        <span class="command-text"></span>
        <span class="step-display" style="display: none;">
          <span>steps:</span>
          <span class="current-step">1</span>
          <span class="step-separator">-</span>
          <span class="total-step">1</span>
        </span>
        <input class="input-field" type="text" placeholder="Type to search actions...">
        <div class="input-tooltip" style="display: none;"></div>
      </div>
      <button class="confirm-btn" style="display: none;"></button>
      <button class="submit-btn" style="display: none;"></button>
      <button class="close-btn"></button>
    </div>
    <div class="tooltip hide"></div>
  </div>
  <style>
  </style>`
  const container = shadow.querySelector('.quick-actions-container')
  const default_actions = shadow.querySelector('.default-actions')
  const text_bar = shadow.querySelector('.text-bar')
  const input_wrapper = shadow.querySelector('.input-wrapper')
  const slash_prefix = shadow.querySelector('.slash-prefix')
  const command_text = shadow.querySelector('.command-text')
  const input_field = shadow.querySelector('.input-field')
  const confirm_btn = shadow.querySelector('.confirm-btn')
  const submit_btn = shadow.querySelector('.submit-btn')
  const close_btn = shadow.querySelector('.close-btn')
  const step_display = shadow.querySelector('.step-display')
  const current_step = shadow.querySelector('.current-step')
  const total_steps = shadow.querySelector('.total-step')
  const tooltip = shadow.querySelector('.tooltip')
  const input_tooltip = shadow.querySelector('.input-tooltip')
  const style = shadow.querySelector('style')

  let init = false
  let mid = 0
  let enable_quick_action_tooltips = false
  let enable_input_field_tooltips = false
  let icons = {}
  let hardcons = {}
  let defaults = []
  const docs = DOCS(__filename)(opts.sid)

  let send = null
  const _ = {
    up: null
  }
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _.up = send
  }
  text_bar.onclick = docs.wrap(activate_input_field, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })
  close_btn.onclick = docs.wrap(deactivate_input_field, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })
  confirm_btn.onclick = docs.wrap(onconfirm, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })
  submit_btn.onclick = docs.wrap(onsubmit, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })
  input_field.oninput = oninput

  await sdb.watch(onbatch)

  return el

  async function get_doc_content () {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  }

  function onsubmit () {
    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'action_submitted' })
  }

  function onconfirm () {
    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'activate_steps_wizard' })
  }
  function oninput (e) {
    const value = e.target.value
    if (enable_input_field_tooltips) update_input_tooltip(value)
    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'filter_actions', data: value })
  }

  function update_input_display (selected_action = null) {
    if (selected_action) {
      slash_prefix.style.display = 'inline'
      command_text.style.display = 'inline'
      command_text.textContent = `#${selected_action.action}`
      current_step.textContent = selected_action?.current_step || 1
      total_steps.textContent = selected_action?.total_steps || 1
      step_display.style.display = 'inline-flex'

      input_field.style.display = 'none'
      confirm_btn.style.display = 'flex'
      hide_input_tooltip()
    } else {
      slash_prefix.style.display = 'none'
      command_text.style.display = 'none'
      input_field.style.display = 'block'
      confirm_btn.style.display = 'none'
      submit_btn.style.display = 'none'
      step_display.style.display = 'none'
      input_field.placeholder = 'Type to search actions...'
      hide_input_tooltip()
    }
  }

  function activate_input_field () {
    console.log('activate_input_field')
    default_actions.style.display = 'none'
    text_bar.style.display = 'none'

    input_wrapper.style.display = 'flex'
    input_field.focus()

    if (enable_input_field_tooltips) update_input_tooltip('')

    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'display_actions', data: 'block' })
  }

  function onmessage (msg) {
    const { type, data } = msg
    // No need to handle docs_toggle - DOCS module handles it globally
    const message_map = {
      deactivate_input_field,
      show_submit_btn,
      update_current_step,
      hide_submit_btn,
      update_actions_for_app,
      update_quick_actions_for_app,
      update_input_command
    }
    const handler = message_map[type] || fail
    handler(data)
  }

  function deactivate_input_field (data) {
    default_actions.style.display = 'flex'
    text_bar.style.display = 'flex'

    input_wrapper.style.display = 'none'

    input_field.value = ''
    update_input_display()
    hide_input_tooltip()

    const head = [by, to, mid++]
    const refs = {}
    _.up({ head, refs, type: 'display_actions', data: 'none' })
  }

  function show_submit_btn () {
    submit_btn.style.display = 'flex'
  }

  function hide_submit_btn () {
    submit_btn.style.display = 'none'
  }

  function update_current_step (data) {
    const current_step_value = data?.index + 1 || 1
    current_step.textContent = current_step_value
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      create_default_actions(defaults)
      init = true
    } else {
      // TODO: update actions
    }
  }
  function fail (data, type) { console.warn(`Invalid message type: ${type}`, { cause: { data, type } }) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }
  function onhardcons (data) {
    hardcons = {
      submit: data[0],
      cross: data[1],
      confirm: data[2]
    }
    submit_btn.innerHTML = hardcons.submit
    close_btn.innerHTML = hardcons.cross
    confirm_btn.innerHTML = hardcons.confirm
  }
  function iconject (data) {
    icons = data
  }

  function onactions (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    defaults = vars
    create_default_actions(defaults)
  }

  function onprefs (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    enable_input_field_tooltips = vars.input_field
    enable_quick_action_tooltips = vars.quick_actions
  }

  function create_default_actions (actions) {
    default_actions.replaceChildren()
    actions.forEach((action) => create_action_button(action))
  }

  function create_action_button (action) {
    const btn = document.createElement('div')
    btn.classList.add('action-btn')
    btn.innerHTML = icons[action.icon]
    btn.dataset.name = action.name
    if (enable_quick_action_tooltips) {
      btn.onmouseenter = () => show_tooltip(btn, action.name)
      btn.onmouseleave = hide_tooltip
    }
    btn.onclick = docs.wrap(onclick, get_doc_content)
    default_actions.appendChild(btn)
    function onclick () {
      const head = [by, to, mid++]
      const refs = {}
      _.up({ head, refs, type: 'update_quick_actions_input', data: action.name })
    }
  }

  function update_input_tooltip (value) {
    if (!value || value.trim() === '') {
      hide_input_tooltip()
      return
    }
    const tooltip_text = get_tooltip_text(value)
    if (tooltip_text) {
      show_input_tooltip(tooltip_text)
    } else {
      hide_input_tooltip()
    }
  }

  function get_tooltip_text (value) {
    const lower_value = value.toLowerCase().trim()
    if (lower_value.length === 0) return null
    if (defaults.length > 0) {
      const matching = defaults.filter((action) => {
        return matches_action(action, lower_value)
      })
      if (matching.length > 0) {
        const names = matching.map(function (action) {
          return action.name
        })
        return `Found ${matching.length} action${matching.length > 1 ? 's' : ''}: ${names.join(', ')}`
      }
    }
    return 'No actions found. Try a different search term.'
  }

  function matches_action (action, search_term) {
    return action.name.toLowerCase().includes(search_term)
  }

  function show_input_tooltip (text) {
    input_tooltip.textContent = text
    input_tooltip.style.display = 'block'
    position_input_tooltip()
  }

  function hide_input_tooltip () {
    input_tooltip.style.display = 'none'
  }

  function position_input_tooltip () {
    const input_rect = input_field.getBoundingClientRect()
    const wrapper_rect = input_wrapper.getBoundingClientRect()
    const tooltip_rect = input_tooltip.getBoundingClientRect()
    const left = input_rect.left - wrapper_rect.left + (input_rect.width / 2) - (tooltip_rect.width / 2)
    const top = input_rect.top - wrapper_rect.top - tooltip_rect.height - 8
    input_tooltip.style.left = `${left}px`
    input_tooltip.style.top = `${top}px`
  }

  function update_actions_for_app (data) {
    const focused_app = data?.focused_app
  }

  function update_quick_actions_for_app (data) {
    const temp_quick_actions = data?.temp_quick_actions
    if (temp_quick_actions && Array.isArray(temp_quick_actions)) {
      drive.put('actions/default.json', JSON.stringify(temp_quick_actions))
    }
  }

  function update_input_command (command) {
    if (input_wrapper.style.display === 'none') {
      activate_input_field()
    }

    // Find the action that matches the command
    const matching_action = defaults.find(action =>
      action.name === command ||
      action.action === command
    )

    if (matching_action) {
      const pass_data = {
        action: matching_action.name,
        current_step: 1,
        total_steps: 3
      }
      update_input_display(pass_data)
    } else {
      // TODO: Strictly handle this case
      const pass_data = {
        action: command.action,
        current_step: 1,
        total_steps: 3
      }
      update_input_display(pass_data)
      // console.error('No matching action found for command:', command)
    }
  }

  function show_tooltip (btn, name) {
    tooltip.textContent = name
    tooltip.style.display = 'block'
    const btn_rect = btn.getBoundingClientRect()
    const container_rect = container.getBoundingClientRect()
    const tooltip_rect = tooltip.getBoundingClientRect()
    const left = btn_rect.left - container_rect.left + (btn_rect.width / 2) - (tooltip_rect.width / 2)
    const top = btn_rect.top - container_rect.top - tooltip_rect.height - 8
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${top}px`
  }

  function hide_tooltip () {
    tooltip.style.display = 'none'
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'icons/': {
          '0.svg': {
            $ref: 'action1.svg'
          },
          '1.svg': {
            $ref: 'action2.svg'
          },
          '2.svg': {
            $ref: 'action1.svg'
          },
          '3.svg': {
            $ref: 'action2.svg'
          },
          '4.svg': {
            $ref: 'action1.svg'
          }
        },
        'hardcons/': {
          'submit.svg': {
            $ref: 'submit.svg'
          },
          'close.svg': {
            $ref: 'cross.svg'
          },
          'confirm.svg': {
            $ref: 'check.svg'
          }
        },
        'actions/': {
          'default.json': {
            raw: JSON.stringify([
              {
                name: 'New',
                icon: '0'
              },
              {
                name: 'Settings',
                icon: '1'
              },
              {
                name: 'Help',
                icon: '2'
              },
              {
                name: 'About',
                icon: '3'
              },
              {
                name: 'Exit',
                icon: '4'
              }
            ])
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            raw: `
              .quick-actions-container {
                display: flex;
                flex: auto;
                flex-direction: row;
                align-items: center;
                background: #191919;
                border-radius: 20px;
                padding: 4px;
                gap: 8px;
                min-width: 200px;
                position: relative;
              }
              .default-actions {
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 4px;
                padding: 0 4px;
              }
              .action-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                color: #a6a6a6;
              }
              .action-btn:hover {
                background: rgba(255, 255, 255, 0.1);
              }
              .text-bar {
                flex: 1;
                min-height: 32px;
                border-radius: 16px;
                background: #131315;
                cursor: pointer;
                user-select: none;
              }
              .text-bar:hover {
                background: #1a1a1c;
              }
              .input-wrapper {
                display: flex;
                flex: 1;
                align-items: center;
                background: #131315;
                border-radius: 16px;
                border: 1px solid #3c3c3c;
                padding-right: 4px;
              }
              .input-wrapper:focus-within {
                border-color: #4285f4;
                background: #1a1a1c;
              }
              .input-display {
                display: flex;
                flex: 1;
                align-items: center;
                padding: 0 12px;
                min-height: 32px;
                position: relative;
              }
              .slash-prefix {
                color: #a6a6a6;
                font-size: 14px;
                margin-right: 4px;
                display: none;
              }
              .command-text {
                color: #e8eaed;
                font-size: 14px;
                background: #2d2d2d;
                border: 1px solid #4285f4;
                border-radius: 4px;
                padding: 2px 6px;
                font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                display: none;
              }
              .input-field {
                flex: 1;
                min-height: 32px;
                background: transparent;
                border: none;
                color: #e8eaed;
                padding: 0 12px;
                font-size: 14px;
                outline: none;
              }
              .input-field::placeholder {
                color: #a6a6a6;
              }
              .submit-btn {
                display: none;
                align-items: center;
                justify-content: center;
                background: #ffffff00;
                border: none;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                color: white;
                min-width: 32px;
                height: 32px;
                margin-right: 4px;
                font-size: 12px;
              }
              .submit-btn:hover {
                background: #ffffff00;
              }
              .confirm-btn {
                display: none;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                color: #a6a6a6;
                min-width: 32px;
                height: 32px;
                margin-right: 4px;
                font-size: 12px;
              }
              .confirm-btn:hover {
                background: rgba(255, 255, 255, 0.1);
              }
              .close-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                background: transparent;
                border: none;
                padding: 6px;
                border-radius: 50%;
                cursor: pointer;
                color: #a6a6a6;
                min-width: 32px;
                height: 32px;
              }
              .close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
              }
              svg {
                width: 16px;
                height: 16px;
              }
              .step-display {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                margin-left: 8px;
                background: #2d2d2d;
                border: 1px solid #666;
                border-radius: 4px;
                padding: 1px 6px;
                font-size: 12px;
                color: #fff;
                font-family: monospace;
              }
              .current-step {
                color:#f0f0f0;
              }
              .step-separator {
                color: #888;
              }
              .total-step {
                color: #f0f0f0;
              }
              .hide {
                display: none;
              }
              .tooltip {
                position: absolute;
                background: #2d2d2d;
                color: #e8eaed;
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                white-space: nowrap;
                pointer-events: none;
                z-index: 1000;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                border: 1px solid #3c3c3c;
              }
              .tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 4px solid transparent;
                border-top-color: #2d2d2d;
              }
              .input-tooltip {
                position: absolute;
                background: #2d2d2d;
                color: #e8eaed;
                padding: 6px 12px;
                border-radius: 4px;
                font-size: 12px;
                white-space: normal;
                pointer-events: none;
                z-index: 1001;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                border: 1px solid #4285f4;
                max-width: 300px;
                word-wrap: break-word;
              }
              .input-tooltip::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                transform: translateX(-50%);
                border: 4px solid transparent;
                border-top-color: #4285f4;
              }
            `
          }
        },
        'prefs/': {
          'tooltips.json': {
            raw: JSON.stringify({
              quick_actions: true,
              input_field: false
            })
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/quick_actions/quick_actions.js")
},{"DOCS":3,"STATE":1}],19:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const { resource } = require('helpers')

module.exports = quick_editor
let is_called
const nesting = 0

async function quick_editor (opts) {
  // ----------------------------------------
  let init; let data; let port; let labels; let nesting_limit; let top_first; let select = []
  const current_data = {}

  const { sdb, io, net } = await get(opts.sid)
  const { drive } = sdb

  const on = {
    style: inject
  }
  // ----------------------------------------
  const el = document.createElement('div')
  el.classList.add('quick-editor')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
      <button class="dots-button">⋮</button>
      <div class="quick-box">
        <div class="quick-menu hidden">
          <div class="btn-box">
            <button class="button">Apply</button>
            ${is_called
    ? ''
    : `<button class="button import">Import</button>
              <button class="button export">Export</button>
              <input type="file" accept='.json' hidden />`
}
          </div>
        </div>
      </div>
      <style>
      </style>
      `

  const style = shadow.querySelector('style')
  const menu_btn = shadow.querySelector('.dots-button')
  const menu = shadow.querySelector('.quick-menu')
  const import_btn = shadow.querySelector('.button.import')
  const export_btn = shadow.querySelector('.button.export')
  const input = shadow.querySelector('input')
  const apply_btn = shadow.querySelector('.button')
  // ----------------------------------------
  // EVENTS
  // ----------------------------------------
  await sdb.watch(onbatch)
  menu_btn.onclick = () => menu_click(false)
  if (is_called) {
    apply_btn.onclick = apply
    menu_btn.onclick = () => menu_click(true)
    labels = ['Nodes', 'Types', 'Files']
    nesting_limit = nesting + 3
    top_first = 0
  } else {
    apply_btn.onclick = () => {
      port.postMessage({ type: 'swtch', data: [{ name: current_data.Types.trim(), type: current_data.Names.trim() }] })
    }
    input.onchange = upload
    import_btn.onclick = () => {
      input.click()
    }
    export_btn.onclick = () => {
      if (current_data.radio.name === 'Names') { port.postMessage({ type: 'export_db', data: [{ name: current_data.Names.trim(), type: current_data.Types.trim() }] }) } else { port.postMessage({ type: 'export_root', data: [{ name: current_data.Root.trim(), type: current_data.Nodes.trim() }] }) }
    }
    menu.classList.add('admin')
    labels = ['Root', 'Types', 'Names', 'Nodes', 'Files', 'Entries']
    nesting_limit = nesting + 6
    top_first = 1
    select = [1, 0, 1, 0, 0, 0]
  }

  // ----------------------------------------
  // IO
  // ----------------------------------------
  const item = resource()
  io.on(port => {
    const { by, to } = port
    item.set(port.to, port)
    port.onmessage = event => {
      const txt = event.data
      const key = `[${by} -> ${to}]`
      console.log(key)
      data = txt
      if (init) {
        menu_click(false)
        init = false
        menu_click(false)
      }
    }
  })
  await io.at(net.page.id)
  is_called = true
  return el

  // ----------------------------------------
  // FUNCTIONS
  // ----------------------------------------
  function upload (e) {
    const file = e.target.files[0]
    const reader = new FileReader()
    reader.onload = event => {
      const content = event.target.result
      try {
        data = JSON.parse(content)
        console.log(file)
        if (current_data.radio.name === 'Names') { port.postMessage({ type: 'import_db', data: [data] }) } else { port.postMessage({ type: 'import_root', data: [data, file.name.split('.')[0]] }) }
      } catch (err) {
        console.error('Invalid JSON file', err)
      }
    }
    reader.readAsText(file)
  }
  function make_btn (name, classes, key, nesting) {
    const btn = document.createElement('button')
    if (select[nesting]) {
      btn.innerHTML = `
        <input type='radio' name='${key}' /> ${name}
      `
      const input = btn.querySelector('input')
      input.onchange = () => radio_change(input)
    } else { btn.textContent = name }
    btn.classList.add(...classes.split(' '))
    btn.setAttribute('tab', name.replaceAll(/[^A-Za-z0-9]/g, ''))
    btn.setAttribute('key', key)
    btn.setAttribute('title', name)
    return btn
  }
  function make_tab (id, classes, sub_classes, nesting = 0) {
    const tab = document.createElement('div')
    tab.classList.add(...classes.split(' '), id.replaceAll(/[^A-Za-z0-9]/g, ''))

    let height
    if (nesting % 2 === top_first) height = 565 - ((nesting + 1) * 30) + 'px'
    else tab.style.maxWidth = 700 - ((nesting + 1) * 47) + 'px'

    tab.innerHTML = `
      <div class="${sub_classes[0]}" style="--before-content: '${labels[nesting]}'; max-height: ${height}">
      </div>
      <div class="${sub_classes[1]}">
      </div>
    `

    return tab
  }
  function make_textarea (id, classes, value, nesting) {
    const textarea = document.createElement('textarea')
    textarea.id = id.replaceAll(/[^A-Za-z0-9]/g, '')
    textarea.classList.add(...classes.split(' '))
    textarea.value = typeof (value) === 'object' ? JSON.stringify(value, null, 2) : value
    textarea.placeholder = 'Type here...'
    textarea.style.width = 700 - ((nesting + 2) * 47) + 'px'
    return textarea
  }
  function radio_change (radio) {
    current_data.radio && (current_data.radio.checked = false)
    current_data.radio = radio
  }
  async function menu_click (call) {
    port = await item.get(net.page.id)
    menu.classList.toggle('hidden')
    if (init) { return }
    init = true

    const old_box = menu.querySelector('.tab-content')
    old_box && old_box.remove()

    const box = make_tab('any', 'tab-content active' + (top_first ? '' : ' sub'), ['btns', 'tabs'])
    menu.append(box)
    make_tabs(box, data, nesting)
  }
  function make_tabs (box, data, nesting) {
    const local_nesting = nesting + 1
    const not_last_nest = local_nesting !== nesting_limit
    let sub = ''
    if (local_nesting % 2 === top_first) { sub = ' sub' }
    const btns = box.querySelector('.btns')
    const tabs = box.querySelector('.tabs')
    Object.entries(data).forEach(([key, value], i) => {
      let first = ''
      if (!i) {
        first = ' active'
        current_data[labels[nesting]] = key
      }

      const btn = make_btn(key, `tab-button${first}`, labels[nesting], nesting)
      const tab = make_tab(key, `tab-content${sub + first}`, ['btns', 'tabs'], local_nesting)
      btn.onclick = () => tab_btn_click(btn, btns, tabs, '.root-tabs > .tab-content', 'node', key)

      btns.append(btn)
      tabs.append(tab)
      if (typeof (value) === 'object' && value !== null && not_last_nest && Object.keys(value).length) { make_tabs(tab, value, local_nesting) } else {
        const textarea = make_textarea(key, `subtab-textarea${first}`, value, local_nesting)
        tab.append(textarea)
      }
    })
  }
  function tab_btn_click (btn, btns, tabs) {
    btns.querySelector('.active').classList.remove('active')
    tabs.querySelector(':scope > .active').classList.remove('active')

    btn.classList.add('active')
    const tab = tabs.querySelector('.' + btn.getAttribute('tab'))
    tab.classList.add('active')
    current_data[btn.getAttribute('key')] = btn.textContent

    recurse(tab)
    function recurse (tab) {
      const btn = tab.querySelector('.btns > .active')
      if (!btn) { return }
      current_data[btn.getAttribute('key')] = btn.textContent
      const sub_tab = tab.querySelector('.tabs > .active')
      recurse(sub_tab)
    }
  }

  function apply () {
    let raw = shadow.querySelector('.tab-content.active .tab-content.active textarea.active').value
    if (current_data.file.split('.')[1] === 'json') { raw = JSON.parse(raw) }
    port.postMessage({
      type: 'put',
      data: [
        current_data.dataset + current_data.file,
        raw,
        current_data.node
      ]
    })
  }

  function inject (data) {
    style.textContent = data.join('\n')
  }
  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
}

function fallback_module () {
  return {
    api: fallback_instance
  }
  function fallback_instance () {
    return {
      drive: {
        'style/': {
          'quick_editor.css': {
            raw: `
            .dots-button {
              border: none;
              font-size: 24px;
              cursor: pointer;
              line-height: 1;
              background-color: white;
              letter-spacing: 1px;
              padding: 3px 5px;
              border-radius: 20%;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }

            .quick-menu {
              display: flex;
              position: absolute;
              top: 100%;
              right: 0;
              background: white;
              padding: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              white-space: nowrap;
              z-index: 10;
              width: fit-content;
            }
            *{
              box-sizing: border-box;
            }

            .hidden {
              display: none;
            }
            
            .btns::before {
              display: none;
              content: var(--before-content);
              font-weight: bold;
              color: white;
              background: #4CAF50;
              padding: 2px 6px;
              border-radius: 4px;
              position: absolute;
              margin-left: -10px;
              margin-top: -20px;
            }
            .btns:hover {
              border: 2px solid #4CAF50;
            }
            .btns:hover::before {
              display: block;
            }
            .btns{
              display: flex;
              margin-bottom: 8px;
              overflow-x: auto;
              background: #d0f0d0;
            }
            .sub > .btns {
              display: flex;
              flex-direction: column;
              gap: 4px;
              max-height: 400px;
              overflow-y: auto;
              min-width: fit-content;
              margin-right: 8px;
              background: #d0d2f0ff;
            }

            .tab-button {
              flex: 1;
              padding: 6px;
              background: #eee;
              border: none;
              cursor: pointer;
              border-bottom: 2px solid transparent;
              max-width: 70px;
              width: fit-content;
              text-overflow: ellipsis;
              overflow: hidden;
              min-width: 70px;
              min-height: 29px;
              position: relative;
              text-align: left;
            }
            .tab-button.active {
              background: #fff;
              border-bottom: 2px solid #4CAF50;
            }
            .sub > div > .tab-button.active {
              border-bottom: 2px solid #2196F3;
            }
            .tab-content {
              display: none;
              max-width: 700px;
              background: #d0d2f0ff;
            }
            .tab-content.active {
              display: block;
            }
            .tab-content.sub.active{
              display: flex;
              align-items: flex-start;
            }

            textarea {
              width: 500px;
              max-width: 560px;
              height: 400px;
              display: block;
              resize: vertical;
            }

            .button {
              display: block;
              margin-top: 10px;
              padding: 5px 10px;
              background-color: #4CAF50;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              height: fit-content;
              self-align: end;
              width: 100%;
            }
            .btn-box {
              border-right: 1px solid #ccc;
              padding-right: 10px;
            }
            .tabs{
              border-left: 2px solid #ccc;
              border-top: 1px solid #ccc;
            }
            button:has(input[type="radio"]:checked){
              background: #45abffff;
            }
            button > input[type="radio"]{
              width: 12px;
              height: 12px;
              border: 2px solid #555;
              border-radius: 50%;
              display: inline-block;
              position: relative;
              cursor: pointer;
              margin: 0;
            }
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/quick_editor/quick_editor.js")
},{"STATE":1,"helpers":13}],20:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')
const docs = DOCS(__filename)()
const docs_admin = docs.admin(admin_handler)  // Request admin access

const console_history = require('console_history')
const actions = require('actions')
const tabbed_editor = require('tabbed_editor')
const graph_explorer_wrapper = require('graph_explorer_wrapper')
const docs_window = require('docs_window')

module.exports = component

async function component (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  // const by = id
  // const to = ids.up

  const on = {
    style: inject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="space main">
    <docs-window-placeholder></docs-window-placeholder>
    <graph-explorer-placeholder></graph-explorer-placeholder>
    <actions-placeholder></actions-placeholder>
    <tabbed-editor-placeholder></tabbed-editor-placeholder>
    <console-history-placeholder></console-history-placeholder>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const graph_explorer_placeholder = shadow.querySelector('graph-explorer-placeholder')
  const actions_placeholder = shadow.querySelector('actions-placeholder')
  const tabbed_editor_placeholder = shadow.querySelector('tabbed-editor-placeholder')
  const console_placeholder = shadow.querySelector('console-history-placeholder')
  const docs_window_placeholder = shadow.querySelector('docs-window-placeholder')

  let console_history_el = null
  let docs_window_el = null
  let actions_el = null
  let tabbed_editor_el = null
  let graph_explorer_el = null

  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, actions: null, send_console_history: null, send_tabbed_editor: null, send_graph_explorer: null, send_docs_window: null }
  }

  docs_window_el = protocol ? await docs_window({ ...subs[4], ids: { up: id } }, docs_window_protocol) : await docs_window({ ...subs[4], ids: { up: id } })
  docs_window_el.classList.add('docs-window')
  docs_window_el.classList.add('hide')
  docs_window_placeholder.replaceWith(docs_window_el)

  graph_explorer_el = protocol ? await graph_explorer_wrapper({ ...subs[3], ids: { up: id } }, graph_explorer_protocol) : await graph_explorer_wrapper({ ...subs[3], ids: { up: id } })
  graph_explorer_el.classList.add('graph-explorer')
  graph_explorer_placeholder.replaceWith(graph_explorer_el)

  actions_el = protocol ? await actions({ ...subs[1], ids: { up: id } }, actions_protocol) : await actions({ ...subs[1], ids: { up: id } })
  actions_el.classList.add('actions')
  actions_placeholder.replaceWith(actions_el)

  tabbed_editor_el = protocol ? await tabbed_editor({ ...subs[2], ids: { up: id } }, tabbed_editor_protocol) : await tabbed_editor({ ...subs[2], ids: { up: id } })
  tabbed_editor_el.classList.add('tabbed-editor')
  tabbed_editor_placeholder.replaceWith(tabbed_editor_el)

  console_history_el = protocol ? await console_history({ ...subs[0], ids: { up: id } }, console_history_protocol) : await console_history({ ...subs[0], ids: { up: id } })
  console_history_el.classList.add('console-history')
  console_placeholder.replaceWith(console_history_el)
  let console_view = false
  let actions_view = false
  let graph_explorer_view = false
  let docs_mode_active = false

  if (protocol) {
    console_history_el.classList.add('hide')
    actions_el.classList.add('hide')
    tabbed_editor_el.classList.add('show')
    graph_explorer_el.classList.add('hide')

    docs_admin.set_doc_display_handler(({ content, sid }) => {
      docs_window_el.classList.remove('hide')
      if (_.send_docs_window) {
        _.send_docs_window({ type: 'display_doc', data: { content, sid } })
      }
    })
  }

  return el

  function console_history_toggle_view () {
    if (console_view) {
      console_history_el.classList.remove('show')
      console_history_el.classList.add('hide')
    } else {
      console_history_el.classList.remove('hide')
      console_history_el.classList.add('show')
    }
    console_view = !console_view
  }

  function actions_toggle_view () {
    if (actions_view) {
      actions_el.classList.remove('show')
      actions_el.classList.add('hide')
    } else {
      actions_el.classList.remove('hide')
      actions_el.classList.add('show')
    }
    actions_view = !actions_view
  }

  function graph_explorer_toggle_view () {
    if (graph_explorer_view) {
      graph_explorer_el.classList.remove('show')
      graph_explorer_el.classList.add('hide')
    } else {
      graph_explorer_el.classList.remove('hide')
      graph_explorer_el.classList.add('show')
    }
    graph_explorer_view = !graph_explorer_view
  }

  function tabbed_editor_toggle_view (show = true) {
    if (show) {
      tabbed_editor_el.classList.remove('hide')
      tabbed_editor_el.classList.add('show')
      actions_el.classList.remove('show')
      actions_el.classList.add('hide')
      console_history_el.classList.remove('show')
      console_history_el.classList.add('hide')
      graph_explorer_el.classList.remove('show')
      graph_explorer_el.classList.add('hide')
      actions_view = false
      console_view = false
      graph_explorer_view = false
    } else {
      tabbed_editor_el.classList.remove('show')
      tabbed_editor_el.classList.add('hide')
    }
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.replaceChildren((() => {
      const style = document.createElement('style')
      style.textContent = data[0]
      return style
    })())
  }

  // ---------
  // PROTOCOLS
  // ---------

  function console_history_protocol (send) {
    _.send_console_history = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function actions_protocol (send) {
    _.send_actions = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function tabbed_editor_protocol (send) {
    _.send_tabbed_editor = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function graph_explorer_protocol (send) {
    _.send_graph_explorer = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function docs_window_protocol (send) {
    _.send_docs_window = send
    return on
    function on (msg) {
      if (msg.type === 'close_docs') {
        docs_window_el.classList.add('hide')
      }
      _.up(msg)
    }
  }

  function onmessage (msg) {
    const { type, data } = msg
    if (type === 'console_history_toggle') console_history_toggle_view()
    else if (type === 'graph_explorer_toggle') graph_explorer_toggle_view()
    else if (type === 'display_actions') actions_toggle_view(data)
    else if (type === 'filter_actions') _.send_actions(msg)
    else if (type === 'tab_name_clicked') {
      tabbed_editor_toggle_view(true)
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor({ ...msg, type: 'toggle_tab' })
      }
    } else if (type === 'tab_close_clicked') {
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor({ ...msg, type: 'close_tab' })
      }
    } else if (type === 'switch_tab') {
      tabbed_editor_toggle_view(true)
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor(msg)
      }
    } else if (type === 'entry_toggled') {
      if (_.send_graph_explorer) {
        _.send_graph_explorer(msg)
      }
    } else if (type === 'display_doc') {
      docs_window_el.classList.remove('hide')
      if (_.send_docs_window) {
        _.send_docs_window(msg)
      }
    } else if (type === 'docs_toggle') {
      docs_mode_active = data?.active || false
      // Broadcast docs_toggle to all subcomponents
      if (_.send_console_history) _.send_console_history(msg)
      if (_.send_actions) _.send_actions(msg)
      if (_.send_tabbed_editor) _.send_tabbed_editor(msg)
      if (_.send_graph_explorer) _.send_graph_explorer(msg)
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      console_history: {
        $: ''
      },
      actions: {
        $: ''
      },
      tabbed_editor: {
        $: ''
      },
      graph_explorer_wrapper: {
        $: ''
      },
      docs_window: {
        $: ''
      },
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        console_history: {
          0: '',
          mapping: {
            style: 'style',
            commands: 'commands',
            icons: 'icons',
            scroll: 'scroll',
            docs: 'docs'
          }
        },
        actions: {
          0: '',
          mapping: {
            style: 'style',
            actions: 'actions',
            icons: 'icons',
            hardcons: 'hardcons',
            docs: 'docs'
          }
        },
        tabbed_editor: {
          0: '',
          mapping: {
            style: 'style',
            files: 'files',
            highlight: 'highlight',
            active_tab: 'active_tab',
            docs: 'docs'
          }
        },
        graph_explorer_wrapper: {
          0: '',
          mapping: {
            theme: 'style',
            entries: 'entries',
            runtime: 'runtime',
            mode: 'mode',
            flags: 'flags',
            keybinds: 'keybinds',
            undo: 'undo',
            docs: 'docs'
          }
        },
        docs_window: {
          0: '',
          mapping: {
            style: 'docs_style'
          }
        },
        DOCS: {
          0: ''
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .space {
                display: grid;
                grid-template-rows: 1fr auto auto;
                min-height: 200px;
                width: 100;
                height: 100;
                background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
                position: relative;
                gap: 8px;
                padding: 8px;
              }
              .console-history {
                grid-row: 3;
                position: relative;
                width: 100%;
                background-color: #161b22;
                border: 1px solid #21262d;
                border-radius: 6px;
                min-height: 120px;
              }
              .actions {
                grid-row: 2;
                position: relative;
                width: 100%;
                background-color: #161b22;
                border: 1px solid #21262d;
                border-radius: 6px;
                min-height: 60px;
              }
              .tabbed-editor {
                grid-row: 1;
                position: relative;
                width: 100%;
                min-height: 250px;
                background-color: #0d1117;
                border: 1px solid #21262d;
                border-radius: 6px;
                overflow: hidden;
              }
              .show {
                display: block;
              }
              .hide {
                display: none;
              }
            `
          }
        },
        'entries/': {},
        'flags/': {},
        'keybinds/': {},
        'commands/': {},
        'icons/': {},
        'scroll/': {},
        'actions/': {},
        'hardcons/': {},
        'files/': {},
        'highlight/': {},
        'active_tab/': {},
        'runtime/': {},
        'mode/': {},
        'undo/': {},
        'docs_style/': {}
      }
    }
  }
}

function admin_handler ({ type, data }, api) {
  if (type === 'set_docs_mode') {
    api.set_docs_mode(data.active)
  } else if (type === 'set_doc_display_handler') {
    console.error('DOCS: No Permission to set doc display handler')
  }
}
}).call(this)}).call(this,"/src/node_modules/space/space.js")
},{"DOCS":3,"STATE":1,"actions":5,"console_history":6,"docs_window":8,"graph_explorer_wrapper":12,"tabbed_editor":22}],21:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = steps_wizard

async function steps_wizard (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject
  }

  let variables = []
  let currentActiveStep = 0
  let mid = 0
  const docs = DOCS(__filename)(opts.sid)

  let _ = { up: null }
  if (protocol) {
    const send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="steps-wizard main">
    <div class="steps-container">
      <div class="steps-slot"></div>
    </div>
  </div>
  <style>
  </style>
  `

  const style = shadow.querySelector('style')
  const steps_entries = shadow.querySelector('.steps-slot')
  await sdb.watch(onbatch)

  // for demo purpose
  render_steps([
    { name: 'Optional Step', type: 'optional', is_completed: false, component: 'form_input', status: 'default', data: '' },
    { name: 'Step 2 testingasadasdadasdasdaasdasdsassss', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' },
    { name: 'Step 3', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' },
    { name: 'Step 4', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' },
    { name: 'Step 5', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' }
  ])

  return el

  function onmessage ({ type, data }) {
    // docs_toggle handled globally by DOCS module
    if (type === 'init_data') {
      variables = [
        { name: 'Optional Step', type: 'optional', is_completed: false, component: 'form_input', status: 'default', data: '' },
        { name: 'Step 2 testing', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: 'asdasd' },
        { name: 'Step 3', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' },
        { name: 'Step 4', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' },
        { name: 'Step 5', type: 'mandatory', is_completed: false, component: 'form_input', status: 'default', data: '' }
      ]
      render_steps(variables)
    }
  }

  function render_steps (steps) {
    if (!steps) { return }

    steps_entries.innerHTML = ''

    steps.forEach((step, index) => {
      const btn = document.createElement('button')
      btn.className = 'step-button'
      btn.textContent = step.name + (step.type === 'optional' ? ' *' : '')
      btn.title = btn.textContent
      btn.setAttribute('data-step', index + 1)

      const accessible = can_access(index, steps)

      let status = 'default'
      if (!accessible) status = 'disabled'
      else if (step.is_completed) status = 'completed'
      else if (step.status === 'error') status = 'error'
      else if (step.type === 'optional') status = 'optional'

      btn.classList.add(`step-${status}`)

      if (index === currentActiveStep - 1 && index > 0) {
        btn.classList.add('back')
      }
      if (index === currentActiveStep + 1 && index < steps.length - 1) {
        btn.classList.add('next')
      }
      if (index === currentActiveStep) {
        btn.classList.add('active')
      }

      btn.onclick = docs.wrap(async () => {
        const head = [by, to, mid++]
        const refs = {}
        console.log('Clicked:', step)
        currentActiveStep = index
        center_step(btn)
        render_steps(steps)
        _?.up({ head, refs, type: 'step_clicked', data: { ...step, index, total_steps: steps.length, is_accessible: accessible } })
      }, async () => {
        const doc_file = await drive.get('docs/README.md')
        return doc_file?.raw || 'No documentation available'
      })

      steps_entries.appendChild(btn)
    })
  }

  function center_step (step_button) {
    const container_width = steps_entries.clientWidth
    const step_left = step_button.offsetLeft
    const step_width = step_button.offsetWidth

    const center_position = step_left - (container_width / 2) + (step_width / 2)

    steps_entries.scrollTo({
      left: center_position,
      behavior: 'smooth'
    })
  }

  function can_access (index, steps) {
    for (let i = 0; i < index; i++) {
      if (!steps[i].is_completed && steps[i].type !== 'optional') {
        return false
      }
    }

    return true
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'stepswizard.css': {
            $ref: 'stepswizard.css'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/steps_wizard/steps_wizard.js")
},{"DOCS":3,"STATE":1}],22:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = tabbed_editor

async function tabbed_editor (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    files: onfiles,
    active_tab: onactivetab
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="tabbed-editor main">
    <div class="editor-content">
      <div class="editor-placeholder">
        <div class="placeholder-text">Select a file to edit</div>
      </div>
    </div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const editor_content = shadow.querySelector('.editor-content')

  let init = false
  let mid = 0
  let files = {}
  let active_tab = null
  let current_editor = null

  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }
  await sdb.watch(onbatch)

  return el

  function onmessage (msg) {
    const { type, data } = msg
    switch (type) {
    case 'switch_tab':
      switch_to_tab(data, msg)
      break
    case 'close_tab':
      close_tab(data, msg)
      break
    case 'toggle_tab':
      toggle_tab(data, msg)
      break
      default:
      }
    }
    // docs_toggle @TODO
    
  function switch_to_tab (tab_data, msg) {
    if (active_tab === tab_data.id) {
      return
    }

    active_tab = tab_data.id
    create_editor(tab_data)

    if (_) {
      const head = [by, to, mid++]
      const refs = msg?.head ? { cause: msg.head } : undefined
      _.up({
        head,
        refs,
        type: 'tab_switched',
        data: tab_data
      })
    }
  }

  function toggle_tab (tab_data, msg) {
    if (active_tab === tab_data.id) {
      hide_editor()
      active_tab = null
    } else {
      switch_to_tab(tab_data, msg)
    }
  }

  function close_tab (tab_data, msg) {
    if (active_tab === tab_data.id) {
      hide_editor()
      active_tab = null
    }

    if (_) {
      const head = [by, to, mid++]
      const refs = msg?.head ? { cause: msg.head } : undefined
      _.up({
        head,
        refs,
        type: 'tab_closed',
        data: tab_data
      })
    }
  }

  function create_editor (tab_data) {
    const parsed_data = JSON.parse(tab_data[0])
    const file_content = files[parsed_data.id] || ''
    // console.log('Creating editor for:', parsed_data)

    editor_content.replaceChildren()

    editor_content.innerHTML = `
    <div class="code-editor">
    <div class="editor-wrapper">
      <div class="line-numbers"></div>
      <textarea class="code-area" placeholder="Start editing ${parsed_data.name || parsed_data.id}...">${file_content}</textarea>
    </div>
    </div>`
    const editor = editor_content.querySelector('.code-editor')
    const line_numbers = editor_content.querySelector('.line-numbers')
    const code_area = editor_content.querySelector('.code-area')
    current_editor = { editor, code_area, line_numbers, tab_data: parsed_data }

    code_area.oninput = handle_code_input
    code_area.onscroll = handle_code_scroll

    update_line_numbers()
  }

  function hide_editor () {
    editor_content.innerHTML = `
      <div class="editor-placeholder">
        <div class="placeholder-text">Select a file to edit</div>
      </div>`
    current_editor = null
  }

  function update_line_numbers () {
    if (!current_editor) return

    const { code_area, line_numbers } = current_editor
    const lines = code_area.value.split('\n')
    const line_count = lines.length

    let line_html = ''
    for (let i = 1; i <= line_count; i++) {
      line_html += `<div class="line-number">${i}</div>`
    }

    line_numbers.innerHTML = line_html
  }

  function save_file_content () {
    if (!current_editor) return

    const { code_area, tab_data } = current_editor
    files[tab_data.id] = code_area.value

    if (_) {
      const head = [by, to, mid++]
      _.up({
        head,
        type: 'file_changed',
        data: {
          id: tab_data.id,
          content: code_area.value
        }
      })
    }
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      init = true
    }
  }

  function fail (data, type) {
    console.warn('Invalid message', { data, type })
  }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function onfiles (data) {
    files = data[0]
  }

  function onactivetab (data) {
    if (data && data.id !== active_tab) {
      switch_to_tab(data)
    }
  }

  function handle_code_input () {
    update_line_numbers()
    save_file_content()
  }

  function handle_code_scroll () {
    if (!current_editor) return
    const { code_area, line_numbers } = current_editor
    line_numbers.scrollTop = code_area.scrollTop
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'files/': {
          'example.js': {
            raw: `
              function hello() {
                console.log("Hello, World!");
              }

              const x = 42;
              let y = "string";

              if (x > 0) {
                hello();
              }
            `
          },
          'example.md': {
            raw: `
              # Example Markdown
              This is an **example** markdown file.

              ## Features

              - Syntax highlighting
              - Line numbers
              - File editing

              \`\`\`javascript
              function example() {
                return true;
              }
              \`\`\`
            `
          },
          'data.json': {
            raw: `
              {
                "name": "example",
                "version": "1.0.0",
                "dependencies": {
                "lodash": "^4.17.21"
              }
            `
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            raw: `
              .tabbed-editor {
                width: 100%;
                height: 100%;
                background-color: #0d1117;
                color: #e6edf3;
                font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
                display: grid;
                grid-template-rows: 1fr;
                position: relative;
                border: 1px solid #30363d;
                border-radius: 6px;
                overflow: hidden;
              }

              .editor-content {
                display: grid;
                grid-template-rows: 1fr;
                position: relative;
                overflow: hidden;
                background-color: #0d1117;
              }

              .editor-placeholder {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #7d8590;
                font-style: italic;
                font-size: 16px;
                background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
              }

              .code-editor {
                height: 100%;
                display: grid;
                grid-template-rows: 1fr;
                background-color: #0d1117;
              }

              .editor-wrapper {
                display: grid;
                grid-template-columns: auto 1fr;
                position: relative;
                overflow: auto;
                background-color: #0d1117;
              }

              .line-numbers {
                background-color: #161b22;
                color: #7d8590;
                padding: 12px 16px;
                text-align: right;
                user-select: none;
                font-size: 13px;
                line-height: 20px;
                font-weight: 400;
                border-right: 1px solid #21262d;
                position: sticky;
                left: 0;
                z-index: 1;
                height: 100%;
              }

              .line-number {
                height: 20px;
                line-height: 20px;
                transition: color 0.1s ease;
              }

              .line-number:hover {
                color: #f0f6fc;
              }

              .code-area {
                background-color: #0d1117;
                color: #e6edf3;
                border: none;
                outline: none;
                resize: none;
                font-family: 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'Menlo', monospace;
                font-size: 13px;
                line-height: 20px;
                padding: 12px 16px;
                position: relative;
                z-index: 2;
                tab-size: 2;
                white-space: pre;
                overflow-wrap: normal;
                overflow-x: auto;
                min-height: 100%;
              }

              .code-area:focus {
                background-color: #0d1117;
                box-shadow: none;
              }

              .code-area::selection {
                background-color: #264f78;
              }

              .editor-wrapper::-webkit-scrollbar {
                width: 8px;
                height: 8px;
              }

              .editor-wrapper::-webkit-scrollbar-track {
                background: #161b22;
              }

              .editor-wrapper::-webkit-scrollbar-thumb {
                background: #30363d;
                border-radius: 4px;
              }

              .editor-wrapper::-webkit-scrollbar-thumb:hover {
                background: #484f58;
              }
            `
          }
        },
        'active_tab/': {
          'current.json': {
            raw: JSON.stringify({
              id: 'example.js',
              name: 'example.js'
            })
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/tabbed_editor/tabbed_editor.js")
},{"DOCS":3,"STATE":1}],23:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = component

async function component (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    variables: onvariables,
    style: inject,
    icons: iconject,
    scroll: onscroll
  }
  const div = document.createElement('div')
  const shadow = div.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="tab-entries main"></div>
  <style>
  </style>`
  const entries = shadow.querySelector('.tab-entries')
  const style = shadow.querySelector('style')

  let init = false
  let mid = 0
  let variables = []
  let dricons = []
  const docs = DOCS(__filename)(opts.sid)
  await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }
  if (entries) {
    let is_down = false
    let start_x
    let scroll_start

    const stop = () => {
      is_down = false
      entries.classList.remove('grabbing')
      update_scroll_position()
    }

    const move = x => {
      if (!is_down) return
      if (entries.scrollWidth <= entries.clientWidth) return stop()
      entries.scrollLeft = scroll_start - (x - start_x) * 1.5
    }

    entries.onmousedown = e => {
      if (entries.scrollWidth <= entries.clientWidth) return
      is_down = true
      entries.classList.add('grabbing')
      start_x = e.pageX - entries.offsetLeft
      scroll_start = entries.scrollLeft
      window.onmousemove = e => {
        move(e.pageX - entries.offsetLeft)
        e.preventDefault()
      }
      window.onmouseup = () => {
        stop()
        window.onmousemove = window.onmouseup = null
      }
    }

    entries.onmouseleave = stop

    entries.ontouchstart = e => {
      if (entries.scrollWidth <= entries.clientWidth) return
      is_down = true
      start_x = e.touches[0].pageX - entries.offsetLeft
      scroll_start = entries.scrollLeft
    }
    ;['ontouchend', 'ontouchcancel'].forEach(ev => {
      entries[ev] = stop
    })

    entries.ontouchmove = e => {
      move(e.touches[0].pageX - entries.offsetLeft)
      e.preventDefault()
    }
  }
  return div

  function onmessage (msg) {
    // const { type } = msg
  }

  async function create_btn ({ name, id }, index) {
    const el = document.createElement('div')
    el.innerHTML = `
    <span class="icon">${dricons[index + 1]}</span>
    <span class='name'>${id}</span>
    <span class="name">${name}</span>
    <button class="btn">${dricons[0]}</button>`

    el.className = 'tabsbtn'
    const name_el = el.querySelector('.name')
    const close_btn = el.querySelector('.btn')

    name_el.draggable = false

    // Add click handler for tab name (switch/toggle tab)
    name_el.onclick = docs.wrap(async () => {
      if (_) {
        const head = [by, to, mid++]
        const refs = {}
        _.up({ head, refs, type: 'ui_focus', data: 'tab' })
        const head2 = [by, to, mid++]
        _.up({ head: head2, refs, type: 'tab_name_clicked', data: { id, name } })
      }
    }, async () => {
      const doc_file = await drive.get('docs/README.md')
      return doc_file?.raw || 'No documentation available'
    })

    // Add click handler for close button
    close_btn.onclick = docs.wrap(async (e) => {
      e.stopPropagation()
      if (_) {
        const head = [by, to, mid++]
        const refs = {}
        _.up({ head, refs, type: 'ui_focus', data: 'tab' })
        const head2 = [by, to, mid++]
        _.up({ head: head2, refs, type: 'tab_close_clicked', data: { id, name } })
      }
    }, async () => {
      const doc_file = await drive.get('docs/README.md')
      return doc_file?.raw || 'No documentation available'
    })

    entries.appendChild(el)
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      variables.forEach(create_btn)
      init = true
    } else {
      // TODO: Here we can handle drive updates
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function onvariables (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    variables = vars
  }

  function iconject (data) {
    dricons = data
  }

  function update_scroll_position () {
    // TODO
  }

  function onscroll (data) {
    setTimeout(() => {
      if (entries) {
        entries.scrollLeft = data
      }
    }, 200)
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }
  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'icons/': {
          'cross.svg': {
            $ref: 'cross.svg'
          },
          '1.svg': {
            $ref: 'icon.svg'
          },
          '2.svg': {
            $ref: 'icon.svg'
          },
          '3.svg': {
            $ref: 'icon.svg'
          }
        },
        'variables/': {
          'tabs.json': {
            $ref: 'tabs.json'
          }
        },
        'scroll/': {
          'position.json': {
            raw: '100'
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        },
        'style/': {
          'theme.css': {
            $ref: 'style.css'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/tabs/tabs.js")
},{"DOCS":3,"STATE":1}],24:[function(require,module,exports){
(function (__filename){(function (){
const state = require('STATE')
const state_db = state(__filename)
const { get } = state_db(fallback_module)
const DOCS = require('DOCS')

const tabs_component = require('tabs')
const task_manager = require('task_manager')

module.exports = tabsbar

async function tabsbar (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  const on = {
    style: inject,
    icons: inject_icons
  }

  let dricons = {}
  let mid = 0
  let docs_toggle_active = false
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, tabs: null, task_manager: null }
  }

  shadow.innerHTML = `
  <div class="tabs-bar-container main">
  <button class="hat-btn"></button>
  <tabs></tabs>
  <task-manager></task-manager>
  <button class="bar-btn"></button>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const hat_btn = shadow.querySelector('.hat-btn')
  const bar_btn = shadow.querySelector('.bar-btn')

  const subs = await sdb.watch(onbatch)
  const docs = DOCS(__filename)(opts.sid)
  if (dricons[0]) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(dricons[0], 'image/svg+xml')
    const svgElem = doc.documentElement
    hat_btn.replaceChildren(svgElem)
    hat_btn.onclick = docs.wrap(hat_click, async () => {
      const doc_file = await drive.get('docs/README.md')
      return doc_file?.raw || 'No documentation available'
    })
  }
  if (dricons[2]) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(dricons[2], 'image/svg+xml')
    const svgElem = doc.documentElement
    bar_btn.replaceChildren(svgElem)
    bar_btn.onclick = () => {
      docs_toggle_active = !docs_toggle_active
      docs.message.set_docs_mode(docs_toggle_active)
      const head = [by, to, mid++]
      const head_mgr = [by, to, mid++]
      const refs = {}
      _.up?.({ head, refs, type: 'docs_toggle', data: { active: docs_toggle_active } })
      bar_btn.classList.toggle('active', docs_toggle_active)
      _.task_manager({ head_mgr, refs, type: 'docs_toggle', data: { active: docs_toggle_active } })
    }
  }
  const tabs = protocol ? await tabs_component({ ...subs[0], ids: { up: id } }, tabs_protocol) : await tabs_component({ ...subs[0], ids: { up: id } })
  tabs.classList.add('tabs-bar')
  shadow.querySelector('tabs').replaceWith(tabs)

  const task_mgr = protocol ? await task_manager({ ...subs[1], ids: { up: id } }, task_manager_protocol) : await task_manager({ ...subs[1], ids: { up: id } })
  task_mgr.classList.add('bar-btn')
  shadow.querySelector('task-manager').replaceWith(task_mgr)

  return el
  async function hat_click () {
    const head = [by, to, mid++]
    const refs = {}
    _.up?.({ head, refs, type: 'ui_focus', data: 'wizard_hat' })
  }
  function onmessage (msg) {
    const { type } = msg
    switch (type) {
    case 'docs_toggle':
      // Broadcast to subcomponents
      _.tabs?.(msg)
      break
    default:
        // Handle other message types
    }
  }

  function tabs_protocol (send) {
    _.tabs = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function task_manager_protocol (send) {
    _.task_manager = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function inject_icons (data) {
    dricons = data
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      tabs: {
        $: ''
      },
      task_manager: {
        $: ''
      },
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        tabs: {
          0: '',
          mapping: {
            icons: 'icons',
            variables: 'variables',
            scroll: 'scroll',
            style: 'style',
            docs: 'docs'
          }
        },
        task_manager: {
          0: '',
          mapping: {
            count: 'count',
            style: 'style',
            docs: 'docs'
          }
        },
        DOCS: {
          0: ''
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .tabs-bar-container {
                display: flex;
                flex: inherit;
                flex-direction: row;
                flex-wrap: nowrap;
                align-items: stretch;
              }
              .tabs-bar {
                display: flex;
                flex: auto;
                flex-direction: row;
                flex-wrap: nowrap;
                align-items: stretch;
                width: 300px;
              }
              .hat-btn, .bar-btn {
                display: flex;
                min-width: 32px;
                border: none;
                background: #131315;
                cursor: pointer;
                flex-direction: row;
                justify-content: center;
                align-items: center;
              }
              .bar-btn.active {
                background: #2d4a6d;
              }
            `
          }
        },
        'icons/': {
          '1.svg': {
            $ref: 'hat.svg'
          },
          '2.svg': {
            $ref: 'hat.svg'
          },
          '3.svg': {
            $ref: 'docs.svg'
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/tabsbar/tabsbar.js")
},{"DOCS":3,"STATE":1,"tabs":23,"task_manager":25}],25:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const DOCS = require('DOCS')

module.exports = task_manager

async function task_manager (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  const by = id
  const to = ids.up

  let mid = 0
  const docs = DOCS(__filename)(opts.sid)

  const on = {
    style: inject,
    count: update_count
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="task-manager-container main">
    <button class="task-count-btn">0</button>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const btn = shadow.querySelector('.task-count-btn')

  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  // DOCS.wrap() is used for automatic docs mode hook
  btn.onclick = docs.wrap(async () => {
    if (_) {
      const head = [by, to, mid++]
      const refs = {}
      _.up({ head, refs, type: 'ui_focus', data: 'task_manager' })
    }
  }, async () => {
    const doc_file = await drive.get('docs/README.md')
    return doc_file?.raw || 'No documentation available'
  })

  await sdb.watch(onbatch)

  return el

  function onmessage (msg) {
    // Temporary placeholder
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function update_count (data) {
    if (btn) btn.textContent = data.toString()
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      DOCS: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        DOCS: {
          0: ''
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .task-count-btn {
                background: #2d2d2d;
                color: #fff;
                border: none;
                border-radius: 100%;
                padding: 4px 8px;
                min-width: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
              }
              .task-count-btn:hover {
                background: #3d3d3d;
              }
            `
          }
        },
        'count/': {
          'value.json': {
            raw: '3'
          }
        },
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/task_manager/task_manager.js")
},{"DOCS":3,"STATE":1}],26:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)
const manager = require('manager')
const tabsbar = require('tabsbar')

module.exports = taskbar

async function taskbar (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  const ids = opts.ids
  if (!ids || !ids.up) {
    throw new Error(`Component ${__filename} requires ids.up to be provided`)
  }
  // const by = id
  // const to = ids.up

  const on = {
    style: inject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="taskbar-container main">
    <div class="manager-slot"></div>
    <div class="tabsbar-slot"></div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const manager_slot = shadow.querySelector('.manager-slot')
  const tabsbar_slot = shadow.querySelector('.tabsbar-slot')

  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, manager: null, tabsbar: null }
  }
  const manager_el = protocol ? await manager({ ...subs[0], ids: { up: id } }, manager_protocol) : await manager({ ...subs[0], ids: { up: id } })
  manager_el.classList.add('replaced-manager')
  manager_slot.replaceWith(manager_el)

  const tabsbar_el = protocol ? await tabsbar({ ...subs[1], ids: { up: id } }, tabsbar_protocol) : await tabsbar({ ...subs[1], ids: { up: id } })
  tabsbar_el.classList.add('replaced-tabsbar')
  tabsbar_slot.replaceWith(tabsbar_el)

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  // ---------
  // PROTOCOLS
  // ---------
  function manager_protocol (send) {
    _.manager = send
    return on
    function on (msg) {
      _.up(msg)
    }
  }

  function tabsbar_protocol (send) {
    _.tabsbar = send
    return on
    function on (msg) {
      if (msg.type == 'docs_toggle') _.manager?.(msg)
      _.up(msg)
    }
  }

  function onmessage (msg) {
    const { type } = msg
    switch (type) {
    default:
      if (_.manager) {
        _.manager(msg)
      }
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      manager: {
        $: ''
      },
      tabsbar: {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        manager: {
          0: '',
          mapping: {
            icons: 'icons',
            style: 'style',
            variables: 'variables',
            data: 'data',
            actions: 'actions',
            hardcons: 'hardcons',
            prefs: 'prefs',
            docs: 'docs'
          }
        },
        tabsbar: {
          0: '',
          mapping: {
            icons: 'icons',
            style: 'style',
            docs: 'docs'
          }
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .taskbar-container {
                display: flex;
                background: #2d2d2d;
                column-gap: 1px;
              }
              .replaced-tabsbar {
                display: flex;
                flex: auto;
              }
              .replaced-manager {
                display: flex;
              }
              @media (max-width: 768px) {
                .taskbar-container {
                  flex-direction: column;
                }
              }
            `
          }
        },
        'icons/': {},
        'variables/': {},
        'data/': {},
        'actions/': {},
        'hardcons/': {},
        'prefs/': {},
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/taskbar/taskbar.js")
},{"STATE":1,"manager":15,"tabsbar":24}],27:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

const space = require('space')
const taskbar = require('taskbar')
const focus_tracker = require('focus_tracker')
const control_unit = require('control_unit')

module.exports = theme_widget

async function theme_widget (opts) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb

  const on = {
    style: inject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="theme-widget main">
    <div class="space-slot"></div>
    <div class="taskbar-slot"></div>
  </div>
  <style>
  </style>
  `

  const style = shadow.querySelector('style')
  const space_slot = shadow.querySelector('.space-slot')
  const taskbar_slot = shadow.querySelector('.taskbar-slot')

  const subs = await sdb.watch(onbatch)

  let space_el = null
  let taskbar_el = null
  const _ = { send_space: null, send_taskbar: null, send_focus_tracker: null, send_control_unit: null }

  taskbar_el = await taskbar({ ...subs[1], ids: { up: id } }, taskbar_protocol)
  taskbar_slot.replaceWith(taskbar_el)

  space_el = await space({ ...subs[0], ids: { up: id } }, space_protocol)
  space_el.classList.add('space')
  space_slot.replaceWith(space_el)

  await focus_tracker({ ...subs[2], ids: { up: id } }, focus_tracker_protocol)
  await control_unit({ ...subs[3], ids: { up: id } }, control_unit_protocol)

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      // console.log(data, type)
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.replaceChildren((() => {
      const style_el = document.createElement('style')
      style_el.textContent = data[0]
      return style_el
    })())
  }

  // ---------
  // PROTOCOLS
  // ---------
  function space_protocol (send) {
    _.send_space = send
    return on
    function on (msg) {
      if (msg.type === 'ui_focus') _.send_focus_tracker(msg)
      else _.send_taskbar(msg)
    }
  }

  function taskbar_protocol (send) {
    _.send_taskbar = send
    return on
    function on (msg) {
      if (msg.type === 'ui_focus') _.send_focus_tracker(msg)
      else if (msg.type === 'docs_toggle') {
        _.send_focus_tracker(msg)
        _.send_space(msg)
      } else _.send_space(msg)
    }
  }

  function focus_tracker_protocol (send) {
    _.send_focus_tracker = send
    return on
    function on (msg) {
      if (_.send_control_unit) _.send_control_unit(msg)
    }
  }

  function control_unit_protocol (send) {
    _.send_control_unit = send
    return on
    function on (msg) {
      if (msg.type === 'display_doc') {
        _.send_space(msg)
      } else if (_ && _.send_taskbar) {
        _.send_taskbar(msg)
      }
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      space: {
        $: ''
      },
      taskbar: {
        $: ''
      },
      focus_tracker: {
        $: ''
      },
      control_unit: {
        $: ''
      }
    },
    drive: {}
  }

  function fallback_instance () {
    return {
      _: {
        space: {
          0: '',
          mapping: {
            style: 'style',
            icons: 'icons',
            commands: 'commands',
            scroll: 'scroll',
            actions: 'actions',
            hardcons: 'hardcons',
            files: 'files',
            highlight: 'highlight',
            active_tab: 'active_tab',
            entries: 'entries',
            runtime: 'runtime',
            mode: 'mode',
            flags: 'flags',
            keybinds: 'keybinds',
            undo: 'undo',
            focused: 'focused',
            temp_actions: 'temp_actions',
            temp_quick_actions: 'temp_quick_actions',
            prefs: 'prefs',
            variables: 'variables',
            data: 'data',
            docs: 'docs',
            docs_style: 'docs_style'
          }
        },
        taskbar: {
          0: '',
          mapping: {
            style: 'style',
            icons: 'icons',
            actions: 'actions',
            prefs: 'prefs',
            variables: 'variables',
            data: 'data',
            hardcons: 'hardcons',
            docs: 'docs'
          }
        },
        focus_tracker: {
          0: '',
          mapping: {
            focused: 'focused',
            docs: 'docs'
          }
        },
        control_unit: {
          0: '',
          mapping: {
            temp_actions: 'temp_actions',
            temp_quick_actions: 'temp_quick_actions',
            docs: 'docs'
          }
        }
      },
      drive: {
        'style/': {
          'theme.css': {
            raw: `
              .theme-widget {
                display: flex;
                flex-direction: column;
                width: 100%;
                height: 100%;
                background: #131315;
              }
              .space{
                height: inherit;
              }
            `
          }
        },
        'flags/': {},
        'commands/': {},
        'icons/': {},
        'scroll/': {},
        'actions/': {},
        'hardcons/': {},
        'files/': {},
        'highlight/': {},
        'active_tab/': {},
        'entries/': {},
        'runtime/': {},
        'mode/': {},
        'keybinds/': {},
        'undo/': {},
        'focused/': {},
        'temp_actions/': {},
        'temp_quick_actions/': {},
        'prefs/': {},
        'variables/': {},
        'data/': {},
        'docs_style/': {},
        'docs/': {
          'README.md': {
            $ref: 'README.md'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/theme_widget/theme_widget.js")
},{"STATE":1,"control_unit":7,"focus_tracker":9,"space":20,"taskbar":26}],28:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const admin_api = statedb.admin()
const admin_on = {}
admin_api.on(({ type, data }) => {
  admin_on[type] && admin_on[type]()
})
const { sdb, io, id } = statedb(fallback_module)
const { drive, admin } = sdb
/******************************************************************************
  PAGE
******************************************************************************/
const navbar = require('../src/node_modules/menu')
const theme_widget = require('../src/node_modules/theme_widget')
const taskbar = require('../src/node_modules/taskbar')
const tabsbar = require('../src/node_modules/tabsbar')
const action_bar = require('../src/node_modules/action_bar')
const space = require('../src/node_modules/space')
const tabs = require('../src/node_modules/tabs')
const console_history = require('../src/node_modules/console_history')
const actions = require('../src/node_modules/actions')
const tabbed_editor = require('../src/node_modules/tabbed_editor')
const task_manager = require('../src/node_modules/task_manager')
const quick_actions = require('../src/node_modules/quick_actions')
const graph_explorer_wrapper = require('../src/node_modules/graph_explorer_wrapper')
const editor = require('../src/node_modules/quick_editor')
const manager = require('../src/node_modules/manager')
const steps_wizard = require('../src/node_modules/steps_wizard')
const { resource } = require('../src/node_modules/helpers')

const imports = {
  theme_widget,
  taskbar,
  tabsbar,
  action_bar,
  space,
  tabs,
  console_history,
  actions,
  tabbed_editor,
  task_manager,
  quick_actions,
  graph_explorer_wrapper,
  manager,
  steps_wizard
}
config().then(() => boot({ sid: '' }))

async function config () {
  // const path = path => new URL(`../src/node_modules/${path}`, `file://${__dirname}`).href.slice(8)
  const html = document.documentElement
  const meta = document.createElement('meta')
  // const appleTouch = '<link rel="apple-touch-icon" sizes="180x180" href="./src/node_modules/assets/images/favicon/apple-touch-icon.png">'
  // const icon32 = '<link rel="icon" type="image/png" sizes="32x32" href="./src/node_modules/assets/images/favicon/favicon-32x32.png">'
  // const icon16 = '<link rel="icon" type="image/png" sizes="16x16" href="./src/node_modules/assets/images/favicon/favicon-16x16.png">'
  // const webmanifest = '<link rel="manifest" href="./src/node_modules/assets/images/favicon/site.webmanifest"></link>'
  const font = 'https://fonts.googleapis.com/css?family=Nunito:300,400,700,900|Slackey&display=swap'
  const loadFont = `<link href=${font} rel='stylesheet' type='text/css'>`
  html.setAttribute('lang', 'en')
  meta.setAttribute('name', 'viewport')
  meta.setAttribute('content', 'width=device-width,initial-scale=1.0')
  // @TODO: use font api and cache to avoid re-downloading the font data every time
  document.head.append(meta)
  document.head.innerHTML += loadFont // + icon16 + icon32 + webmanifest
  await document.fonts.ready // @TODO: investigate why there is a FOUC
}
/******************************************************************************
  PAGE BOOT
******************************************************************************/
async function boot (opts) {
  // ----------------------------------------
  // ID + JSON STATE
  // ----------------------------------------
  let resize_enabled = true
  const on = {
    style: inject,
    resize_container: update_resize,
    ...sdb.admin.status.dataset.drive,
    ...sdb.admin
  }
  // const status = {}
  // ----------------------------------------
  // TEMPLATE
  // ----------------------------------------
  const el = document.body
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="navbar-slot"></div>
  <div class="components-wrapper-container">
    <div class="components-wrapper"></div>
  </div>
  <style>
  </style>`
  el.style.margin = 0
  el.style.backgroundColor = '#d8dee9'

  // ----------------------------------------
  // ELEMENTS
  // ----------------------------------------

  const navbar_slot = shadow.querySelector('.navbar-slot')
  const components_wrapper = shadow.querySelector('.components-wrapper')
  const style = shadow.querySelector('style')

  const entries = Object.entries(imports)
  const wrappers = []
  const names = entries.map(([name]) => name)
  let current_selected_wrapper = null

  const url_params = new URLSearchParams(window.location.search)
  const checked_param = url_params.get('checked')
  const selected_name_param = url_params.get('selected')
  let initial_checked_indices = []

  if (checked_param) {
    try {
      const parsed = JSON.parse(checked_param)
      if (Array.isArray(parsed) && parsed.every(Number.isInteger)) {
        initial_checked_indices = parsed
      } else {
        console.warn('Invalid "checked" URL parameter format.')
      }
    } catch (e) {
      console.error('Error parsing "checked" URL parameter:', e)
    }
  }

  const menu_callbacks = {
    on_checkbox_change: handle_checkbox_change,
    on_label_click: handle_label_click,
    on_select_all_toggle: handle_select_all_toggle,
    on_resize_toggle: handle_resize_toggle
  }
  const item = resource()
  io.on(port => {
    const { by, to } = port
    item.set(port.to, port)
    port.onmessage = event => {
      const txt = event.data
      const key = `[${by} -> ${to}]`
      console.log('[ port-stuff ]', key)

      on[txt.type] && on[txt.type](...txt.data)
    }
  })

  const editor_subs = await sdb.get_sub('page>../src/node_modules/quick_editor')
  // const subs = await sdb.watch(onbatch)
  const subs = (await sdb.watch(onbatch)).filter((_, index) => index % 2 === 0)
  console.log('Page subs', subs)
  const nav_menu_element = await navbar(subs[names.length], names, initial_checked_indices, menu_callbacks)

  navbar_slot.replaceWith(nav_menu_element, await editor(editor_subs[0]))
  await create_component(entries)
  update_resize(resize_enabled)
  window.onload = scroll_to_initial_selected
  send_quick_editor_data()
  admin_on.import = send_quick_editor_data

  return el
  async function create_component (entries_obj) {
    let index = 0
    for (const [name, factory] of entries_obj) {
      const is_initially_checked = initial_checked_indices.length === 0 || initial_checked_indices.includes(index + 1)
      const outer = document.createElement('div')
      outer.className = 'component-outer-wrapper'
      outer.style.display = is_initially_checked ? 'block' : 'none'
      outer.innerHTML = `
      <div class="component-name-label">${name}</div>
      <div class="component-wrapper"></div>
    `
      const inner = outer.querySelector('.component-wrapper')
      const component_content = await factory({ ...subs[index], ids: { up: id } })
      component_content.className = 'component-content'

      const node_id = admin.status.s2i[subs[index].sid]
      const editor_index = index + 1
      inner.append(component_content, await editor(editor_subs[editor_index]))

      const result = {}
      const drive = admin.status.dataset.drive

      const modulepath = node_id.split(':')[0]
      const fields = admin.status.db.read_all(['state', modulepath])
      const nodes = Object.keys(fields).filter(field => !isNaN(Number(field.split(':').at(-1))))
      for (const node of nodes) {
        result[node] = {}
        const datasets = drive.list('', node)
        for (const dataset of datasets) {
          result[node][dataset] = {}
          const files = drive.list(dataset, node)
          for (const file of files) {
            result[node][dataset][file] = (await drive.get(dataset + file, node)).raw
          }
        }
      }

      const editor_id = admin.status.a2i[admin.status.s2i[editor_subs[editor_index].sid]]
      const port = await item.get(editor_id)
      // await io.at(editor_id)
      port.postMessage(result)

      components_wrapper.appendChild(outer)
      wrappers[index] = { outer, inner, name, checkbox_state: is_initially_checked }
      index++
    }
  }

  function scroll_to_initial_selected () {
    if (selected_name_param) {
      const index = names.indexOf(selected_name_param)
      if (index !== -1 && wrappers[index]) {
        const target_wrapper = wrappers[index].outer
        if (target_wrapper.style.display !== 'none') {
          setTimeout(() => {
            target_wrapper.scrollIntoView({ behavior: 'auto', block: 'center' })
            clear_selection_highlight()
            target_wrapper.style.backgroundColor = '#2e3440'
            current_selected_wrapper = target_wrapper
          }, 100)
        }
      }
    }
  }

  function clear_selection_highlight () {
    if (current_selected_wrapper) {
      current_selected_wrapper.style.backgroundColor = ''
    }
    current_selected_wrapper = null
  }

  function update_url (selected_name = url_params.get('selected')) {
    const checked_indices = wrappers.reduce((acc, w, i) => {
      if (w.checkbox_state) { acc.push(i + 1) }
      return acc
    }, [])
    const params = new URLSearchParams()
    if (checked_indices.length > 0 && checked_indices.length < wrappers.length) {
      params.set('checked', JSON.stringify(checked_indices))
    }
    const selected_index = names.indexOf(selected_name)
    if (selected_name && selected_index !== -1 && wrappers[selected_index]?.checkbox_state) {
      params.set('selected', selected_name)
    }
    const new_url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`
    window.history.replaceState(null, '', new_url)
  }

  function handle_checkbox_change (detail) {
    const { index, checked } = detail
    if (wrappers[index]) {
      wrappers[index].outer.style.display = checked ? 'block' : 'none'
      wrappers[index].checkbox_state = checked
      update_url()
      if (!checked && current_selected_wrapper === wrappers[index].outer) {
        clear_selection_highlight()
        update_url(null)
      }
    }
  }

  function handle_label_click (detail) {
    const { index, name } = detail
    if (wrappers[index]) {
      const target_wrapper = wrappers[index].outer
      if (target_wrapper.style.display === 'none') {
        target_wrapper.style.display = 'block'
        wrappers[index].checkbox_state = true
      }
      target_wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' })
      clear_selection_highlight()
      target_wrapper.style.backgroundColor = 'lightblue'
      current_selected_wrapper = target_wrapper
      update_url(name)
    }
  }

  function handle_select_all_toggle (detail) {
    const { selectAll: select_all } = detail
    wrappers.forEach((w, index) => {
      w.outer.style.display = select_all ? 'block' : 'none'
      w.checkbox_state = select_all
    })
    clear_selection_highlight()
    update_url(null)
  }

  function handle_resize_toggle () {
    console.log('handle_resize_toggle', resize_enabled)
    resize_enabled = !resize_enabled
    drive.put('resize_container/state.json', resize_enabled)
  }

  async function onbatch (batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { console.warn(__filename + 'invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.innerHTML = data.join('\n')
  }
  function update_resize (data) {
    console.log('[ update_resize ]', data)
    resize_enabled = data
    wrappers.forEach(wrap => {
      const wrapper = wrap.outer.querySelector('.component-wrapper')
      if (wrapper) {
        wrapper.style.resize = resize_enabled ? 'both' : 'none'
        wrapper.style.overflow = resize_enabled ? 'auto' : 'visible'
      }
    })
  }
  async function send_quick_editor_data () {
    const roots = admin.status.db.read(['root_datasets'])
    const result = {}
    roots.forEach(root_dataset => {
      const root = root_dataset.name
      result[root] = {}
      const inputs = sdb.admin.get_dataset({ root }) || []
      inputs.forEach(type => {
        result[root][type] = {}
        const datasets = sdb.admin.get_dataset({ root, type })
        datasets && Object.values(datasets).forEach(name => {
          result[root][type][name] = {}
          const ds = sdb.admin.get_dataset({ root, type, name: name })
          ds.forEach(ds_id => {
            const files = admin.status.db.read([root, ds_id]).files || []
            result[root][type][name][ds_id] = {}
            files.forEach(file_id => {
              result[root][type][name][ds_id][file_id] = admin.status.db.read([root, file_id])
            })
          })
        })
      })
    })

    const editor_id = admin.status.a2i[admin.status.s2i[editor_subs[0].sid]]
    const port = await item.get(editor_id)
    // await io.at(editor_id)
    port.postMessage(result)
  }
}
function fallback_module () {
  const menuname = '../src/node_modules/menu'
  const names = [
    '../src/node_modules/theme_widget',
    '../src/node_modules/taskbar',
    '../src/node_modules/tabsbar',
    '../src/node_modules/action_bar',
    '../src/node_modules/space',
    '../src/node_modules/tabs',
    '../src/node_modules/console_history',
    '../src/node_modules/actions',
    '../src/node_modules/tabbed_editor',
    '../src/node_modules/task_manager',
    '../src/node_modules/quick_actions',
    '../src/node_modules/graph_explorer_wrapper',
    '../src/node_modules/manager',
    '../src/node_modules/steps_wizard'
  ]
  const subs = {}
  names.forEach(subgen)
  subs['../src/node_modules/helpers'] = 0

  subs['../src/node_modules/taskbar'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      icons: 'icons',
      actions: 'actions',
      prefs: 'prefs',
      variables: 'variables',
      data: 'data',
      hardcons: 'hardcons',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/tabs'] = {
    $: '',
    0: '',
    mapping: {
      icons: 'icons',
      variables: 'variables',
      scroll: 'scroll',
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/space'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      flags: 'flags',
      commands: 'commands',
      icons: 'icons',
      scroll: 'scroll',
      actions: 'actions',
      hardcons: 'hardcons',
      files: 'files',
      highlight: 'highlight',
      active_tab: 'active_tab',
      entries: 'entries',
      runtime: 'runtime',
      mode: 'mode',
      keybinds: 'keybinds',
      undo: 'undo',
      docs_style: 'docs_style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/manager'] = {
    $: '',
    0: '',
    mapping: {
      icons: 'icons',
      style: 'style',
      variables: 'variables',
      data: 'data',
      actions: 'actions',
      hardcons: 'hardcons',
      prefs: 'prefs',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/steps_wizard'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/tabsbar'] = {
    $: '',
    0: '',
    mapping: {
      icons: 'icons',
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/action_bar'] = {
    $: '',
    0: '',
    mapping: {
      icons: 'icons',
      style: 'style',
      actions: 'actions',
      variables: 'variables',
      hardcons: 'hardcons',
      prefs: 'prefs',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/console_history'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      commands: 'commands',
      icons: 'icons',
      scroll: 'scroll',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/actions'] = {
    $: '',
    0: '',
    mapping: {
      actions: 'actions',
      icons: 'icons',
      hardcons: 'hardcons',
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/tabbed_editor'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      files: 'files',
      highlight: 'highlight',
      active_tab: 'active_tab',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/task_manager'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      count: 'count',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/quick_actions'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      icons: 'icons',
      actions: 'actions',
      hardcons: 'hardcons',
      prefs: 'prefs',
      docs: 'docs'
    }
  }
  subs[menuname] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/quick_editor'] = {
    $: '',
    mapping: {
      style: 'style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/theme_widget'] = {
    $: '',
    0: '',
    mapping: {
      style: 'style',
      commands: 'commands',
      icons: 'icons',
      scroll: 'scroll',
      actions: 'actions',
      hardcons: 'hardcons',
      files: 'files',
      highlight: 'highlight',
      active_tab: 'active_tab',
      entries: 'entries',
      runtime: 'runtime',
      mode: 'mode',
      flags: 'flags',
      keybinds: 'keybinds',
      undo: 'undo',
      focused: 'focused',
      temp_actions: 'temp_actions',
      temp_quick_actions: 'temp_quick_actions',
      prefs: 'prefs',
      variables: 'variables',
      data: 'data',
      docs_style: 'docs_style',
      docs: 'docs'
    }
  }
  subs['../src/node_modules/graph_explorer_wrapper'] = {
    $: '',
    0: '',
    mapping: {
      theme: 'style',
      entries: 'entries',
      runtime: 'runtime',
      mode: 'mode',
      flags: 'flags',
      keybinds: 'keybinds',
      undo: 'undo',
      docs: 'docs'
    }
  }
  for (let i = 0; i < Object.keys(subs).length - 1; i++) {
    subs['../src/node_modules/quick_editor'][i] = quick_editor$
  }

  return {
    _: subs,
    drive: {
      'style/': {
        'theme.css': {
          raw: `
          .components-wrapper-container {
            padding-top: 10px; /* Adjust as needed */
          }

          .component-outer-wrapper {
            margin-bottom: 20px;
            padding: 0px 0px 10px 0px;
            transition: background-color 0.3s ease;
          }

          .component-name-label {
            background-color:transparent;
            padding: 8px 15px;
            text-align: center;
            font-weight: bold;
            color: #333;
          }

          .component-wrapper {
            width: 95%;
            margin: 0 auto;
            position: relative;
            padding: 15px;
            border: 3px solid #666;
            resize: none;
            overflow: visible;
            border-radius: 0px;
            background-color: #eceff4;
            min-height: 50px;
          }
          .component-content {
            width: 100%;
            height: 100%;
          }
          .toggle-switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 26px;
          }

          .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }

          .slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background-color: #ccc;
            border-radius: 26px;
            transition: 0.4s;
          }

          .slider::before {
            content: "";
            position: absolute;
            height: 20px;
            width: 20px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            border-radius: 50%;
            transition: 0.4s;
          }

          input:checked + .slider {
            background-color: #2196F3;
          }

          input:checked + .slider::before {
            transform: translateX(24px);
          }
          .component-wrapper:hover::before {
            content: '';
            position: absolute;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            border: 4px solid skyblue;
            pointer-events: none;
            z-index: 15;
            resize: both;
            overflow: auto;
          }
          .quick-editor {
            position: absolute;
            z-index: 100;
            top: 0;
            right: 0;
          }
          .component-wrapper:hover .quick-editor {
            display: block;
          }
          .component-wrapper > .quick-editor {
            display: none;
            top: -5px;
            right: -10px;
          }`
        }
      },
      'resize_container/': {
        'state.json': {
          raw: 'false'
        }
      },
      'icons/': {},
      'variables/': {},
      'scroll/': {},
      'commands/': {},
      'actions/': {},
      'hardcons/': {},
      'files/': {},
      'highlight/': {},
      'count/': {},
      'entries/': {},
      'active_tab/': {},
      'runtime/': {},
      'mode/': {},
      'data/': {},
      'flags/': {},
      'keybinds/': {},
      'undo/': {},
      'focused/': {},
      'temp_actions/': {},
      'temp_quick_actions/': {},
      'prefs/': {},
      'docs_style/': {},
      'docs/': {}
    }
  }
  function quick_editor$ (args, tools, [quick_editor]) {
    const state = quick_editor()
    state.net = {
      page: {}
    }
    return state
  }
  function subgen (name) {
    subs[name] = {
      $: '',
      0: '',
      mapping: {
        style: 'style',
        docs: 'docs'
      }
    }
  }
}

}).call(this)}).call(this,"/web/page.js")
},{"../src/node_modules/action_bar":4,"../src/node_modules/actions":5,"../src/node_modules/console_history":6,"../src/node_modules/graph_explorer_wrapper":12,"../src/node_modules/helpers":13,"../src/node_modules/manager":15,"../src/node_modules/menu":16,"../src/node_modules/quick_actions":18,"../src/node_modules/quick_editor":19,"../src/node_modules/space":20,"../src/node_modules/steps_wizard":21,"../src/node_modules/tabbed_editor":22,"../src/node_modules/tabs":23,"../src/node_modules/tabsbar":24,"../src/node_modules/task_manager":25,"../src/node_modules/taskbar":26,"../src/node_modules/theme_widget":27,"STATE":1}]},{},[28]);
