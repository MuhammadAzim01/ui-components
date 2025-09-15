(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('./STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = graph_explorer

async function graph_explorer(opts) {
/******************************************************************************
  1. COMPONENT INITIALIZATION
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
  let all_entries = {} // Holds the entire graph structure from entries.json.
  let instance_states = {} // Holds expansion state {expanded_subs, expanded_hubs} for each node instance.
  let search_state_instances = {}
  let view = [] // A flat array representing the visible nodes in the graph.
  let mode // Current mode of the graph explorer, can be set to 'default', 'menubar' or 'search'. Its value should be set by the `mode` file in the drive.
  let previous_mode = 'menubar'
  let search_query = ''
  let drive_updated_by_scroll = false // Flag to prevent `onbatch` from re-rendering on scroll updates.
  let drive_updated_by_toggle = false // Flag to prevent `onbatch` from re-rendering on toggle updates.
  let drive_updated_by_search = false // Flag to prevent `onbatch` from re-rendering on search updates.
  let is_rendering = false // Flag to prevent concurrent rendering operations in virtual scrolling.
  let spacer_element = null // DOM element used to manage scroll position when hubs are toggled.
  let spacer_initial_height = 0
  let hub_num = 0 // Counter for expanded hubs.

  const el = document.createElement('div')
  el.className = 'graph-explorer-wrapper'
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <div class="menubar"></div>
    <div class="graph-container"></div>
  `
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
    entries: on_entries,
    style: inject_style,
    runtime: on_runtime,
    mode: on_mode
  }
  // Start watching for state changes. This is the main trigger for all updates.
  await sdb.watch(onbatch)

  return el

/******************************************************************************
  2. STATE AND DATA HANDLING
    - These functions process incoming data from the STATE module's `sdb.watch`.
    - `onbatch` is the primary entry point.
******************************************************************************/
  async function onbatch(batch) {
    // Prevent feedback loops from scroll or toggle actions.
    if (drive_updated_by_scroll) {
      drive_updated_by_scroll = false
      return
    }
    if (drive_updated_by_toggle) {
      drive_updated_by_toggle = false
      return
    }
    if (drive_updated_by_search) {
      drive_updated_by_search = false
      return
    }

    for (const { type, paths } of batch) {
      if (!paths || paths.length === 0) continue
      const data = await Promise.all(paths.map(async (path) => {
        try {
          const file = await drive.get(path)
          if (!file) return null
          return file.raw
        } catch (e) {
          console.error(`Error getting file from drive: ${path}`, e)
          return null
        }
      }))
      // Call the appropriate handler based on `type`.
      const func = on[type]
      func ? func({ data, paths }) : fail(data, type)
    }
  }

  function fail (data, type) { throw new Error(`Invalid message type: ${type}`, { cause: { data, type } }) }

  function on_entries({ data }) {
    if (!data || data[0] === null || data[0] === undefined) {
      console.error('Entries data is missing or empty.')
      all_entries = {}
      return
    }
    try {
      const parsed_data = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
      if (typeof parsed_data !== 'object' || parsed_data === null) {
        console.error('Parsed entries data is not a valid object.')
        all_entries = {}
        return
      }
      all_entries = parsed_data
    } catch (e) {
      console.error('Failed to parse entries data:', e)
      all_entries = {}
      return
    }
  
    // After receiving entries, ensure the root node state is initialized and trigger the first render.
    const root_path = '/'
    if (all_entries[root_path]) {
      const root_instance_path = '|/'
      if (!instance_states[root_instance_path]) {
        instance_states[root_instance_path] = { expanded_subs: true, expanded_hubs: false }
      }
      build_and_render_view()
    } else {
      console.warn('Root path "/" not found in entries. Clearing view.')
      view = []
      if (container) container.replaceChildren()
    }
  }

  function on_runtime ({ data, paths }) {
    let needs_render = false
    const render_nodes_needed = new Set()

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (data[i] === null) continue
      
      let value
      try {
        value = typeof data[i] === 'string' ? JSON.parse(data[i]) : data[i]
      } catch (e) {
        console.error(`Failed to parse JSON for ${path}:`, e)
        continue
      }
      // Handle different runtime state updates based on the path i.e files
      switch (true) {
        case path.endsWith('node_height.json'):
          node_height = value
          break
        case path.endsWith('vertical_scroll_value.json'):
          if (typeof value === 'number') vertical_scroll_value = value
          break
        case path.endsWith('horizontal_scroll_value.json'):
          if (typeof value === 'number') horizontal_scroll_value = value
          break
        case path.endsWith('selected_instance_paths.json'): {
          const old_paths = [...selected_instance_paths]
          if (Array.isArray(value)) {
            selected_instance_paths = value
          } else {
            console.warn('selected_instance_paths is not an array, defaulting to empty.', value)
            selected_instance_paths = []
          }
          const changed_paths = [...new Set([...old_paths, ...selected_instance_paths])]
          changed_paths.forEach(p => render_nodes_needed.add(p))
          break
        }
        case path.endsWith('confirmed_selected.json'): {
          const old_paths = [...confirmed_instance_paths]
          if (Array.isArray(value)) {
            confirmed_instance_paths = value
          } else {
            console.warn('confirmed_selected is not an array, defaulting to empty.', value)
            confirmed_instance_paths = []
          }
          const changed_paths = [...new Set([...old_paths, ...confirmed_instance_paths])]
          changed_paths.forEach(p => render_nodes_needed.add(p))
          break
        }
        case path.endsWith('instance_states.json'):
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          instance_states = value
          needs_render = true
        } else console.warn('instance_states is not a valid object, ignoring.', value)
        break
      }
    }

    if (needs_render) {
      build_and_render_view()
    } else if (render_nodes_needed.size > 0) {
      render_nodes_needed.forEach(re_render_node)
    }
  }

  function on_mode ({ data, paths }) {
    let new_current_mode
    let new_previous_mode
    let new_search_query

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const raw_data = data[i]
      if (raw_data === null) continue
      let value
      try {
        value = JSON.parse(raw_data)
      } catch (e) {
        console.error(`Failed to parse JSON for ${path}:`, e)
        continue
      }
      if (path.endsWith('current_mode.json')) new_current_mode = value
      else if (path.endsWith('previous_mode.json')) new_previous_mode = value
      else if (path.endsWith('search_query.json')) new_search_query = value
    }

    if (typeof new_search_query === 'string') search_query = new_search_query
    if (new_previous_mode) previous_mode = new_previous_mode
    if (new_current_mode === 'search' && !search_query) {
      search_state_instances = instance_states
    }
    if (!new_current_mode || mode === new_current_mode) return

    if (mode && new_current_mode === 'search') {
      update_mode_state('previous_mode', mode)
    }
    mode = new_current_mode
    render_menubar()
    handle_mode_change()
    if (mode === 'search' && search_query) {
      perform_search(search_query)
    }
  }

  function inject_style({ data }) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data[0])
    shadow.adoptedStyleSheets = [sheet]
  }

  // Helper to persist component state to the drive.
  async function update_runtime_state (name, value) {
    try {
      await drive.put(`runtime/${name}.json`, JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to update runtime state for ${name}:`, e)
    }
  }

  async function update_mode_state (name, value) {
    try {
      await drive.put(`mode/${name}.json`, JSON.stringify(value))
    } catch (e) {
      console.error(`Failed to update mode state for ${name}:`, e)
    }
  }

/******************************************************************************
  3. VIEW AND RENDERING LOGIC
    - These functions build the `view` array and render the DOM.
    - `build_and_render_view` is the main orchestrator.
    - `build_view_recursive` creates the flat `view` array from the hierarchical data.
******************************************************************************/
  function build_and_render_view(focal_instance_path, hub_toggle = false) {
    if (Object.keys(all_entries).length === 0) {
      console.warn('No entries available to render.')
      return
    }
    const old_view = [...view]
    const old_scroll_top = vertical_scroll_value
    const old_scroll_left = horizontal_scroll_value

    let existing_spacer_height = 0
    if (spacer_element && spacer_element.parentNode) {
      existing_spacer_height = parseFloat(spacer_element.style.height) || 0
    }

    // Recursively build the new `view` array from the graph data.
    view = build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub : true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      all_entries
    })

    // Calculate the new scroll position to maintain the user's viewport.
    let new_scroll_top = old_scroll_top
    if (focal_instance_path) {
      // If an action was focused on a specific node (like a toggle), try to keep it in the same position.
      const old_toggled_node_index = old_view.findIndex(node => node.instance_path === focal_instance_path)
      const new_toggled_node_index = view.findIndex(node => node.instance_path === focal_instance_path)

      if (old_toggled_node_index !== -1 && new_toggled_node_index !== -1) {
        const index_change = new_toggled_node_index - old_toggled_node_index
        new_scroll_top = old_scroll_top + (index_change * node_height)
      }
    } else if (old_view.length > 0) {
      // Otherwise, try to keep the topmost visible node in the same position.
      const old_top_node_index = Math.floor(old_scroll_top / node_height)
      const scroll_offset = old_scroll_top % node_height
      const old_top_node = old_view[old_top_node_index]
      if (old_top_node) {
        const new_top_node_index = view.findIndex(node => node.instance_path === old_top_node.instance_path)
        if (new_top_node_index !== -1) {
          new_scroll_top = (new_top_node_index * node_height) + scroll_offset
        }
      }
    }

    const render_anchor_index = Math.max(0, Math.floor(new_scroll_top / node_height))
    start_index = Math.max(0, render_anchor_index - chunk_size)
    end_index = Math.min(view.length, render_anchor_index + chunk_size)

    const fragment = document.createDocumentFragment()
    for (let i = start_index; i < end_index; i++) {
      if (view[i]) fragment.appendChild(create_node(view[i]))
      else console.warn(`Missing node at index ${i} in view.`)
    }

    container.replaceChildren()
    container.appendChild(top_sentinel)
    container.appendChild(fragment)
    container.appendChild(bottom_sentinel)

    top_sentinel.style.height = `${start_index * node_height}px`
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`

    observer.observe(top_sentinel)
    observer.observe(bottom_sentinel)

    const set_scroll_and_sync = () => {
      container.scrollTop = new_scroll_top
      container.scrollLeft = old_scroll_left
      vertical_scroll_value = container.scrollTop
    }

    // Handle the spacer element used for keep entries static wrt cursor by scrolling when hubs are toggled.
    if (hub_toggle || hub_num > 0) {
      spacer_element = document.createElement('div')
      spacer_element.className = 'spacer'
      container.appendChild(spacer_element)

      if (hub_toggle) {
        requestAnimationFrame(() => {
          const container_height = container.clientHeight
          const content_height = view.length * node_height
          const max_scroll_top = content_height - container_height
          
          if (new_scroll_top > max_scroll_top) {
            spacer_initial_height = new_scroll_top - max_scroll_top
            spacer_initial_scroll_top = new_scroll_top
            spacer_element.style.height = `${spacer_initial_height}px`
          }
          set_scroll_and_sync()
        })
      } else {
        spacer_element.style.height = `${existing_spacer_height}px`
        requestAnimationFrame(set_scroll_and_sync)
      }
    } else {
      spacer_element = null
      spacer_initial_height = 0
      spacer_initial_scroll_top = 0
      requestAnimationFrame(set_scroll_and_sync)
    }
  }

  // Traverses the hierarchical `all_entries` data and builds a flat `view` array for rendering.
  function build_view_recursive({
    base_path,
    parent_instance_path,
    parent_base_path = null,
    depth,
    is_last_sub,
    is_hub,
    is_first_hub = false,
    parent_pipe_trail,
    instance_states,
    all_entries
  }) {
    const instance_path = `${parent_instance_path}|${base_path}`
    const entry = all_entries[base_path]
    if (!entry) return []
    
    if (!instance_states[instance_path]) {
      instance_states[instance_path] = {
        expanded_subs: false,
        expanded_hubs: false
      }
    }
    const state = instance_states[instance_path]
    const is_hub_on_top = (base_path === all_entries[parent_base_path]?.hubs?.[0]) || (base_path === '/')

    // Calculate the pipe trail for drawing the tree lines. Quite complex logic here.
    const children_pipe_trail = [...parent_pipe_trail]
    let last_pipe = null
    if (depth > 0) {

      if (is_hub) {
        last_pipe = [...parent_pipe_trail]
        if (is_last_sub) { 
          children_pipe_trail.pop()
          children_pipe_trail.push(true)
          last_pipe.pop()
          last_pipe.push(true)
          if (is_first_hub) {
            last_pipe.pop()
            last_pipe.push(false)
          }
        }
        if (is_hub_on_top && !is_last_sub) {
          last_pipe.pop()
          last_pipe.push(true)
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

    let current_view = []
    // If hubs are expanded, recursively add them to the view first (they appear above the node).
    if (state.expanded_hubs && Array.isArray(entry.hubs)) {
      entry.hubs.forEach((hub_path, i, arr) => {
        current_view = current_view.concat(
          build_view_recursive({
            base_path: hub_path,
            parent_instance_path: instance_path,
            parent_base_path: base_path,
            depth: depth + 1,
            is_last_sub : i === arr.length - 1,
            is_hub: true,
            is_first_hub: is_hub ? is_hub_on_top : false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            all_entries
          })
        )
      })
    }

    current_view.push({
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      pipe_trail: ((is_hub && is_last_sub) || (is_hub && is_hub_on_top)) ? last_pipe : parent_pipe_trail,
      is_hub_on_top
    })

    // If subs are expanded, recursively add them to the view (they appear below the node).
    if (state.expanded_subs && Array.isArray(entry.subs)) {
      entry.subs.forEach((sub_path, i, arr) => {
        current_view = current_view.concat(
          build_view_recursive({
            base_path: sub_path,
            parent_instance_path: instance_path,
            depth: depth + 1,
            is_last_sub: i === arr.length - 1,
            is_hub: false,
            parent_pipe_trail: children_pipe_trail,
            instance_states,
            all_entries
          })
        )
      })
    }
    return current_view
  }
  
/******************************************************************************
 4. NODE CREATION AND EVENT HANDLING
   - `create_node` generates the DOM element for a single node.
   - It sets up event handlers for user interactions like selecting or toggling.
******************************************************************************/
  
  function create_node({ base_path, instance_path, depth, is_last_sub, is_hub, pipe_trail, is_hub_on_top, is_search_match, is_direct_match, is_in_original_view }) {
    const entry = all_entries[base_path]
    if (!entry) {
      console.error(`Entry not found for path: ${base_path}. Cannot create node.`)
      const err_el = document.createElement('div')
      err_el.className = 'node error'
      err_el.textContent = `Error: Missing entry for ${base_path}`
      return err_el
    }

    const states = mode === 'search' ? search_state_instances : instance_states
    let state = states[instance_path]
    if (!state) {
      console.warn(`State not found for instance: ${instance_path}. Using default.`)
      state = { expanded_subs: false, expanded_hubs: false }
      states[instance_path] = state
    }

    const el = document.createElement('div')
    el.className = `node type-${entry.type || 'unknown'}`
    el.dataset.instance_path = instance_path

    if (is_search_match) {
      el.classList.add('search-result')
      if (is_direct_match) {
        el.classList.add('direct-match')
      }
      if (!is_in_original_view) {
        el.classList.add('new-entry')
      }
    }

    if (selected_instance_paths.includes(instance_path)) el.classList.add('selected')
    if (confirmed_instance_paths.includes(instance_path)) el.classList.add('confirmed')

    const has_hubs = Array.isArray(entry.hubs) && entry.hubs.length > 0
    const has_subs = Array.isArray(entry.subs) && entry.subs.length > 0
    
    if (depth) {
      el.style.paddingLeft = '17.5px'
    }
    el.style.height = `${node_height}px`

    // Handle the special case for the root node since its a bit different.
    if (base_path === '/' && instance_path === '|/') {
      const { expanded_subs } = state
      const prefix_class_name = expanded_subs ? 'tee-down' : 'line-h'
      const prefix_class = has_subs && mode !== 'search' ? 'prefix clickable' : 'prefix'
      el.innerHTML = `<div class="wand">🪄</div><span class="${prefix_class} ${prefix_class_name}"></span><span class="name clickable">/🌐</span>`

      const wand_el = el.querySelector('.wand')
      if (wand_el) wand_el.onclick = reset

      if (has_subs) {
        const prefix_el = el.querySelector('.prefix')
        if (prefix_el) {
          if (mode !== 'search') {
            prefix_el.onclick = () => toggle_subs(instance_path)
          } else {
            prefix_el.onclick = null
          }
        }
      }

      const name_el = el.querySelector('.name')
      if (name_el) name_el.onclick = (ev) => select_node(ev, instance_path, base_path)

      return el
    }

    const prefix_class_name = get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top })
    const pipe_html = pipe_trail.map(should_pipe => `<span class="${should_pipe ? 'pipe' : 'blank'}"></span>`).join('')
    
    const prefix_class = has_subs && mode !== 'search' ? 'prefix clickable' : 'prefix'
    const icon_class = (has_hubs && base_path !== '/') && mode !== 'search' ? 'icon clickable' : 'icon'

    el.innerHTML = `
    <span class="indent">${pipe_html}</span>
      <span class="${prefix_class} ${prefix_class_name}"></span>
      <span class="${icon_class}"></span>
      <span class="name clickable">${entry.name || base_path}</span>
    `

    if (has_hubs && base_path !== '/') {
      const icon_el = el.querySelector('.icon')
      if (icon_el) {
        if (mode !== 'search') {
          icon_el.onclick = () => toggle_hubs(instance_path)
        } else {
          icon_el.onclick = null
        }
      }
    }

    if (has_subs) {
      const prefix_el = el.querySelector('.prefix')
      if (prefix_el) {
        if (mode !== 'search') {
          prefix_el.onclick = () => toggle_subs(instance_path)
        } else {
          prefix_el.onclick = null
        }
      }
    }

    const name_el = el.querySelector('.name')
    if (name_el) name_el.onclick = (ev) => select_node(ev, instance_path, base_path)
    
    if (selected_instance_paths.includes(instance_path) || confirmed_instance_paths.includes(instance_path)) {
      const checkbox_div = document.createElement('div')
      checkbox_div.className = 'confirm-wrapper'
      const is_confirmed = confirmed_instance_paths.includes(instance_path)
      checkbox_div.innerHTML = `<input type="checkbox" ${is_confirmed ? 'checked' : ''}>`
      const checkbox_input = checkbox_div.querySelector('input')
      if (checkbox_input) checkbox_input.onchange = (ev) => handle_confirm(ev, instance_path)
      el.appendChild(checkbox_div)
    }

    return el
  }

  // `re_render_node` updates a single node in the DOM, used when only its selection state changes.
  function re_render_node (instance_path) {
    const node_data = view.find(n => n.instance_path === instance_path)
    if (node_data) {
      const old_node_el = shadow.querySelector(`[data-instance_path="${CSS.escape(instance_path)}"]`)
      if (old_node_el) {
        const new_node_el = create_node(node_data)
        old_node_el.replaceWith(new_node_el)
      }
    }
  }

  // `get_prefix` determines which box-drawing character to use for the node's prefix. It gives the name of a specific CSS class.
  function get_prefix({ is_last_sub, has_subs, state, is_hub, is_hub_on_top }) {
    if (!state) {
      console.error('get_prefix called with invalid state.')
      return 'middle-line'
    }
    const { expanded_subs, expanded_hubs } = state
    if (is_hub) {
      if (is_hub_on_top) {
        if (expanded_subs && expanded_hubs) return 'top-cross'
        if (expanded_subs) return 'top-tee-down'
        if (expanded_hubs) return 'top-tee-up'
        return 'top-line'
      } else {
        if (expanded_subs && expanded_hubs) return 'middle-cross'
        if (expanded_subs) return 'middle-tee-down'
        if (expanded_hubs) return 'middle-tee-up'
        return 'middle-line'
      }
    } else if (is_last_sub) {
      if (expanded_subs && expanded_hubs) return 'bottom-cross'
      if (expanded_subs) return 'bottom-tee-down'
      if (expanded_hubs) return has_subs ? 'bottom-tee-up' : 'bottom-light-tee-up'
      return has_subs ? 'bottom-line' : 'bottom-light-line'
    } else {
      if (expanded_subs && expanded_hubs) return 'middle-cross'
      if (expanded_subs) return 'middle-tee-down'
      if (expanded_hubs) return has_subs ? 'middle-tee-up' : 'middle-light-tee-up'
      return has_subs ? 'middle-line' : 'middle-light-line'
    }
  }
  
/******************************************************************************
  5. MENUBAR AND SEARCH
******************************************************************************/
  function render_menubar () {
    menubar.replaceChildren() // Clear existing menubar
    const search_button = document.createElement('button')
    search_button.textContent = 'Search'
    search_button.onclick = toggle_search_mode

    menubar.appendChild(search_button)

    if (mode === 'search') {
      const search_input = document.createElement('input')
      search_input.type = 'text'
      search_input.placeholder = 'Search entries...'
      search_input.className = 'search-input'
      search_input.oninput = on_search_input
      search_input.value = search_query
      menubar.appendChild(search_input)
      requestAnimationFrame(() => search_input.focus())
    }
  }

  function handle_mode_change () {
    if (mode === 'default') {
      menubar.style.display = 'none'
    } else {
      menubar.style.display = 'flex'
    }
    build_and_render_view()
  }

  function toggle_search_mode () {
    const new_mode = mode === 'search' ? previous_mode : 'search'
    if (mode === 'search') {
      search_query = ''
      drive_updated_by_search = true
      update_mode_state('search_query', '')
    }
    update_mode_state('current_mode', new_mode)
    search_state_instances = instance_states
  }

  function on_search_input (event) {
    const query = event.target.value.trim()
    search_query = query
    drive_updated_by_search = true
    update_mode_state('search_query', query)
    if (query === '') search_state_instances = instance_states
    perform_search(query)
  }

  function perform_search (query) {
    if (!query) {
      build_and_render_view()
      return
    }
    const original_view = build_view_recursive({
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub : true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states,
      all_entries
    })
    search_state_instances = {}
    const search_view = build_search_view_recursive({
      query,
      base_path: '/',
      parent_instance_path: '',
      depth: 0,
      is_last_sub : true,
      is_hub: false,
      parent_pipe_trail: [],
      instance_states: search_state_instances, // Use a temporary state for search
      all_entries,
      original_view
    })
    render_search_results(search_view, query)
  }

  function build_search_view_recursive({
    query,
    base_path,
    parent_instance_path,
    depth,
    is_last_sub,
    is_hub,
    parent_pipe_trail,
    instance_states,
    all_entries,
    original_view
  }) {
    const entry = all_entries[base_path]
    if (!entry) return []

    const instance_path = `${parent_instance_path}|${base_path}`
    const is_direct_match = entry.name && entry.name.toLowerCase().includes(query.toLowerCase())

    let sub_results = []
    if (Array.isArray(entry.subs)) {
      const children_pipe_trail = [...parent_pipe_trail]
      if (depth > 0) children_pipe_trail.push(!is_last_sub)

      sub_results = entry.subs.map((sub_path, i, arr) => {
        return build_search_view_recursive({
          query,
          base_path: sub_path,
          parent_instance_path: instance_path,
          depth: depth + 1,
          is_last_sub: i === arr.length - 1,
          is_hub: false,
          parent_pipe_trail: children_pipe_trail,
          instance_states,
          all_entries,
          original_view
        })
      }).flat()
    }

    const has_matching_descendant = sub_results.length > 0

    if (!is_direct_match && !has_matching_descendant) {
      return []
    }

    instance_states[instance_path] = {
      expanded_subs: has_matching_descendant,
      expanded_hubs: false
    }

    const is_in_original_view = original_view.some(node => node.instance_path === instance_path)

    const current_node_view = {
      base_path,
      instance_path,
      depth,
      is_last_sub,
      is_hub,
      pipe_trail: parent_pipe_trail,
      is_hub_on_top: false,
      is_search_match: true,
      is_direct_match,
      is_in_original_view
    }

    return [current_node_view, ...sub_results]
  }

  function render_search_results (search_view, query) {
    view = search_view
    container.replaceChildren()

    if (search_view.length === 0) {
      const no_results_el = document.createElement('div')
      no_results_el.className = 'no-results'
      no_results_el.textContent = `No results for "${query}"`
      container.appendChild(no_results_el)
      return
    }

    const fragment = document.createDocumentFragment()
    for (const node_data of search_view) {
      fragment.appendChild(create_node(node_data))
    }
    container.appendChild(fragment)
  }

/******************************************************************************
  6. VIEW MANIPULATION & USER ACTIONS
      - These functions handle user interactions like selecting, confirming,
        toggling, and resetting the graph.
  ******************************************************************************/
  function select_node(ev, instance_path) {
    if (mode === 'search') {
      let current_path = instance_path
      // Traverse up the tree to expand all parents
      while (current_path) {
        const parent_path = current_path.substring(0, current_path.lastIndexOf('|'))
        if (!parent_path) break // Stop if there's no parent left

        if (!instance_states[parent_path]) {
          instance_states[parent_path] = { expanded_subs: false, expanded_hubs: false }
        }
        instance_states[parent_path].expanded_subs = true
        current_path = parent_path
      }
      drive_updated_by_toggle = true
      update_runtime_state('instance_states', instance_states)
      update_mode_state('current_mode', previous_mode)
    }

    if (ev.ctrlKey) {
      const new_selected_paths = [...selected_instance_paths]
      const index = new_selected_paths.indexOf(instance_path)
      if (index > -1) {
        new_selected_paths.splice(index, 1)
      } else {
        new_selected_paths.push(instance_path)
      }
      update_runtime_state('selected_instance_paths', new_selected_paths)
    } else {
      update_runtime_state('selected_instance_paths', [instance_path])
    }
  }

  function handle_confirm(ev, instance_path) {
    if (!ev.target) return console.warn('Checkbox event target is missing.')
    const is_checked = ev.target.checked
    const new_selected_paths = [...selected_instance_paths]
    const new_confirmed_paths = [...confirmed_instance_paths]

    if (is_checked) {
      const idx = new_selected_paths.indexOf(instance_path)
      if (idx > -1) new_selected_paths.splice(idx, 1)
      if (!new_confirmed_paths.includes(instance_path)) {
          new_confirmed_paths.push(instance_path)
      }
    } else {
      if (!new_selected_paths.includes(instance_path)) {
          new_selected_paths.push(instance_path)
      }
      const idx = new_confirmed_paths.indexOf(instance_path)
      if (idx > -1) new_confirmed_paths.splice(idx, 1)
    }
    update_runtime_state('selected_instance_paths', new_selected_paths)
    update_runtime_state('confirmed_selected', new_confirmed_paths)
  }

  function toggle_subs(instance_path) {
    if (!instance_states[instance_path]) {
      console.warn(`Toggling subs for non-existent state: ${instance_path}. Creating default state.`)
      instance_states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    const state = instance_states[instance_path]
    state.expanded_subs = !state.expanded_subs
    build_and_render_view(instance_path)
    // Set a flag to prevent the subsequent `onbatch` call from causing a render loop.
    drive_updated_by_toggle = true
    update_runtime_state('instance_states', instance_states)
  }

  function toggle_hubs(instance_path) {
    if (!instance_states[instance_path]) {
      console.warn(`Toggling hubs for non-existent state: ${instance_path}. Creating default state.`)
      instance_states[instance_path] = { expanded_subs: false, expanded_hubs: false }
    }
    const state = instance_states[instance_path]
    state.expanded_hubs ? hub_num-- : hub_num++
    state.expanded_hubs = !state.expanded_hubs
    build_and_render_view(instance_path, true)
    drive_updated_by_toggle = true
    update_runtime_state('instance_states', instance_states)
  }

  function reset() {
    const root_path = '/'
    const root_instance_path = '|/'
    const new_instance_states = {}
    if (all_entries[root_path]) {
      new_instance_states[root_instance_path] = { expanded_subs: true, expanded_hubs: false }
    }
    update_runtime_state('vertical_scroll_value', 0)
    update_runtime_state('horizontal_scroll_value', 0)
    update_runtime_state('selected_instance_paths', [])
    update_runtime_state('confirmed_selected', [])
    update_runtime_state('instance_states', new_instance_states)
  }

/******************************************************************************
  7. VIRTUAL SCROLLING
    - These functions implement virtual scrolling to handle large graphs
      efficiently using an IntersectionObserver.
******************************************************************************/
  function onscroll() {
    if (scroll_update_pending) return
    scroll_update_pending = true
    requestAnimationFrame(() => {
      const scroll_delta = vertical_scroll_value - container.scrollTop

      // Handle removal of the scroll spacer.
      if (spacer_element && scroll_delta > 0 && container.scrollTop == 0) {
        spacer_element.remove()
        spacer_element = null
        spacer_initial_height = 0
        spacer_initial_scroll_top = 0
        hub_num = 0
      }

      if (vertical_scroll_value !== container.scrollTop) {
        vertical_scroll_value = container.scrollTop
        drive_updated_by_scroll = true // Set flag to prevent render loop.
        update_runtime_state('vertical_scroll_value', vertical_scroll_value)
      }
      if (horizontal_scroll_value !== container.scrollLeft) {
        horizontal_scroll_value = container.scrollLeft
        drive_updated_by_scroll = true
        update_runtime_state('horizontal_scroll_value', horizontal_scroll_value)
      }
      scroll_update_pending = false
    })
  }

  async function fill_viewport_downwards() {
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

  async function fill_viewport_upwards() {
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

  function handle_sentinel_intersection(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (entry.target === top_sentinel) fill_viewport_upwards()
        else if (entry.target === bottom_sentinel) fill_viewport_downwards()
      }
    })
  }

  function render_next_chunk() {
    if (end_index >= view.length) return
    const fragment = document.createDocumentFragment()
    const next_end = Math.min(view.length, end_index + chunk_size)
    for (let i = end_index; i < next_end; i++) if (view[i]) fragment.appendChild(create_node(view[i]))
    container.insertBefore(fragment, bottom_sentinel)
    end_index = next_end
    bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    cleanup_dom(false)
  }

  function render_prev_chunk() {
    if (start_index <= 0) return
    const fragment = document.createDocumentFragment()
    const prev_start = Math.max(0, start_index - chunk_size)
    for (let i = prev_start; i < start_index; i++) if (view[i]) fragment.appendChild(create_node(view[i]))
    container.insertBefore(fragment, top_sentinel.nextSibling)
    start_index = prev_start
    top_sentinel.style.height = `${start_index * node_height}px`
    cleanup_dom(true)
  }

  // Removes nodes from the DOM that are far outside the viewport.
  function cleanup_dom(is_scrolling_up) {
    const rendered_count = end_index - start_index
    if (rendered_count <= max_rendered_nodes) return

    const to_remove_count = rendered_count - max_rendered_nodes
    if (is_scrolling_up) {
      // If scrolling up, remove nodes from the bottom.
      for (let i = 0; i < to_remove_count; i++) {
        const temp = bottom_sentinel.previousElementSibling
        if (temp && temp !== top_sentinel) {
          temp.remove()
        }
      }
      end_index -= to_remove_count
      bottom_sentinel.style.height = `${(view.length - end_index) * node_height}px`
    } else {
      // If scrolling down, remove nodes from the top.
      for (let i = 0; i < to_remove_count; i++) {
        const temp = top_sentinel.nextElementSibling
        if (temp && temp !== bottom_sentinel) {
          temp.remove()
        }
      }
      start_index += to_remove_count
      top_sentinel.style.height = `${start_index * node_height}px`
    }
  }
}

/******************************************************************************
  8. FALLBACK CONFIGURATION
    - This provides the default data and API configuration for the component,
      following the pattern described in `instructions.md`.
    - It defines the default datasets (`entries`, `style`, `runtime`) and their
      initial values.
******************************************************************************/
function fallback_module() {
  return {
    api: fallback_instance
  }
  function fallback_instance() {
    return {
      drive: {
        'entries/': {
          'entries.json': { $ref: 'entries.json' }
        },
        'style/': {
          'theme.css': {
            raw: `
              .graph-container, .node {
                font-family: monospace;
              }
              .graph-container {
                color: #abb2bf;
                background-color: #282c34;
                padding: 10px;
                height: 500px; /* Or make it flexible */
                overflow: auto;
              }
              .node {
                display: flex;
                align-items: center;
                white-space: nowrap;
                cursor: default;
              }
              .node.error {
                color: red;
              }
              .node.selected {
                background-color: #776346;
              }
              .node.confirmed {
                background-color: #774346;
              }
              .node.new-entry {
                background-color: #87ceeb; /* sky blue */
              }
              .menubar {
                display: flex;
                padding: 5px;
                background-color: #21252b;
                border-bottom: 1px solid #181a1f;
              }
              .search-input {
                margin-left: auto;
                background-color: #282c34;
                color: #abb2bf;
                border: 1px solid #181a1f;
              }
              .confirm-wrapper {
                margin-left: auto;
                padding-left: 10px;
              }
              .indent {
                display: flex;
              }
              .pipe {
                text-align: center;
              }
              .pipe::before { content: '┃'; }
              .blank {
                width: 8.5px;
                text-align: center;
              }
              .clickable {
                cursor: pointer;
              }
              .prefix, .icon {
                margin-right: 2px;
              }
              .top-cross::before { content: '┏╋'; }
              .top-tee-down::before { content: '┏┳'; }
              .top-tee-up::before { content: '┏┻'; }
              .top-line::before { content: '┏━'; }
              .middle-cross::before { content: '┣╋'; }
              .middle-tee-down::before { content: '┣┳'; }
              .middle-tee-up::before { content: '┣┻'; }
              .middle-line::before { content: '┣━'; }
              .bottom-cross::before { content: '┗╋'; }
              .bottom-tee-down::before { content: '┗┳'; }
              .bottom-tee-up::before { content: '┗┻'; }
              .bottom-line::before { content: '┗━'; }
              .bottom-light-tee-up::before { content: '┖┸'; }
              .bottom-light-line::before { content: '┖─'; }
              .middle-light-tee-up::before { content: '┠┸'; }
              .middle-light-line::before { content: '┠─'; }
              .tee-down::before { content: '┳'; }
              .line-h::before { content: '━'; }
              .icon { display: inline-block; text-align: center; }
              .name { flex-grow: 1; }
              .node.type-root > .icon::before { content: '🌐'; }
              .node.type-folder > .icon::before { content: '📁'; }
              .node.type-html-file > .icon::before { content: '📄'; }
              .node.type-js-file > .icon::before { content: '📜'; }
              .node.type-css-file > .icon::before { content: '🎨'; }
              .node.type-json-file > .icon::before { content: '📝'; }
              .node.type-file > .icon::before { content: '📄'; }
            `
          }
        },
        'runtime/': {
          'node_height.json': { raw: '16' },
          'vertical_scroll_value.json': { raw: '0' },
          'horizontal_scroll_value.json': { raw: '0' },
          'selected_instance_paths.json': { raw: '[]' },
          'confirmed_selected.json': { raw: '[]' },
          'instance_states.json': { raw: '{}' }
        },
        'mode/': {
          'current_mode.json': { raw: '"menubar"' },
          'previous_mode.json': { raw: '"menubar"' },
          'search_query.json': { raw: '""' }
        }
      }
    }
  }
}
}).call(this)}).call(this,"/node_modules/graph-explorer/lib/graph_explorer.js")
},{"./STATE":1}],3:[function(require,module,exports){
arguments[4][1][0].apply(exports,arguments)
},{"dup":1}],4:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)


const quick_actions = require('quick_actions')
const actions = require('actions')
const steps_wizard = require('steps_wizard')

module.exports = action_bar

async function action_bar(opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
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
  const main = shadow.querySelector('.main')
  const history_icon = shadow.querySelector('.icon-btn')
  const quick_placeholder = shadow.querySelector('quick-actions')
  const actions_placeholder = shadow.querySelector('actions')
  const steps_wizard_placeholder = shadow.querySelector('steps-wizard')

  let console_icon = {}
  const subs = await sdb.watch(onbatch)

  const _ = {
    up: null,
    send_quick_actions: null,
    send_actions: null,
    send_steps_wizard: null
  }
  let actions_data = null
  let selected_action = null

  if(protocol){
    let send = protocol(msg => onmessage(msg))
    _.up = send
  }

  history_icon.innerHTML = console_icon
  history_icon.onclick = onhistory
  const element = protocol ? await quick_actions(subs[0], quick_actions_protocol) : await quick_actions(subs[0])
  quick_placeholder.replaceWith(element)

  const actions_el = await actions(subs[1], actions_protocol)
  actions_el.classList.add('hide')
  actions_placeholder.replaceWith(actions_el)

  const steps_wizard_el = await steps_wizard(subs[2], steps_wizard_protocol)
  steps_wizard_el.classList.add('hide')
  steps_wizard_placeholder.replaceWith(steps_wizard_el)

  const parent_handler = {
    load_actions,
    selected_action: parent__selected_action,
    show_submit_btn,
    hide_submit_btn,
    form_data
  }

  return el

  async function onbatch (batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject(data) {
    style.innerHTML = data.join('\n')
  }

  function iconject(data) {
    console_icon = data[0]
  }
  function onhistory() {
    _.up({ type: 'console_history_toggle', data: null })
  }


  // --- Toggle Views ---
  function toggle_view(el, show) {
    el.classList.toggle('hide', !show)
  }

  function actions_toggle_view(display) {
    toggle_view(actions_el, display === 'block')
  }

  function steps_toggle_view(display) {
    toggle_view(steps_wizard_el, display === 'block')
  }

  // -------------------------------
  // Protocol: actions
  // -------------------------------
  
  function actions_protocol(send) {
    _.send_actions = send

    const actions_handlers = {
      selected_action: actions__selected_action
    }

    return function on({ type, data }) {
      const handler = actions_handlers[type] || fail
      handler(data, type)
    }
  }

  function actions__selected_action(data, type) {
    selected_action = data?.action || null
    _.send_quick_actions?.({
      type,
      data: {
        ...data,
        total_steps: actions_data[selected_action]?.length || 0
      }
    })

    _.send_steps_wizard?.({ type: 'init_data', data: actions_data[selected_action] })
    steps_toggle_view('block')

    if (actions_data[selected_action]?.length > 0) {
      const first_step = actions_data[selected_action][0]
      _.up?.({ type: 'render_form', data: first_step })
    }

    if (actions_data[selected_action][actions_data[selected_action].length - 1]?.is_completed) {
      _?.send_quick_actions({ type: 'show_submit_btn' })
    }

    _.up?.({ type, data: selected_action })
    actions_toggle_view('none')
  }


  // -------------------------------
  // Protocol: quick actions
  // -------------------------------


  function quick_actions_protocol (send) {
    _.send_quick_actions = send

    const quick_handlers = {
      display_actions: quick_actions__display_actions,
      action_submitted: quick_actions__action_submitted
    }

    return on
    function on ({ type, data }) {
      const handler = quick_handlers[type] || fail
      handler(data, type)
      
    }
  }
  
  function quick_actions__display_actions(data) {
    actions_toggle_view(data)
    if (data === 'none') {
      steps_toggle_view('none')
      _.up?.({ type: 'clean_up', data: selected_action })
    }
  }

  function quick_actions__action_submitted(data) {
    const result = JSON.stringify(actions_data[selected_action].map(step => step.data), null, 2)
    _.send_quick_actions?.({ type: 'deactivate_input_field' })
    _.up?.({ type: 'action_submitted', data: { result, selected_action } })
  }

  // -------------------------------
  // Protocol: steps wizard
  // -------------------------------

  function steps_wizard_protocol(send) {
    _.send_steps_wizard = send

    const steps_handlers = {
      step_clicked: steps_wizard__step_clicked
    }

    return function on({ type, data }) {
      const handler = steps_handlers[type] || default_steps_handler
      handler(data, type)
    }
  }

  function steps_wizard__step_clicked(data) {
    _.send_quick_actions?.({ type: 'update_current_step', data })
    _.up?.({ type: 'render_form', data })
  }

  function onmessage ({ type, data }) {
    console.log('action_bar.onmessage', type, data)
    parent_handler[type]?.(data, type)
  }

  function load_actions(data, type) {
    actions_data = data
    _.send_actions?.({ type, data })
  }
  function parent__selected_action(data, type) {
    _.send_quick_actions?.({ type, data })
  }
  function show_submit_btn(data, type) {
    _.send_quick_actions?.({ type: 'show_submit_btn' })
  }
  function hide_submit_btn(data, type) {
    _.send_quick_actions?.({ type: 'hide_submit_btn' })
  }
  function form_data(data, type) {
    _.send_steps_wizard?.({ type: 'init_data', data: actions_data[selected_action] })
  }
}

function fallback_module() {
  return {
    api: fallback_instance,
    _: {
      'quick_actions': { $: '' },
      'actions': { $: '' },
      'steps_wizard': { $: '' }
    }
  }
  function fallback_instance() {
    return {
      _: {
        'quick_actions': {
          0: '',
          mapping: {
            'style': 'style',
            'icons': 'icons',
            'actions': 'actions',
            'hardcons': 'hardcons'
          }
        },
        'actions': {
          0: '',
          mapping: {
            'style': 'style',
            'icons': 'icons',
            'actions': 'actions',
            'hardcons': 'hardcons'
          }
        },
        'steps_wizard': {
          0: '',
          mapping: {
            'style': 'style',
            'variables': 'variables'
          }
        }
      },
      drive: {
        'icons/': {
          'console.svg': {
            '$ref': 'console.svg'
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
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/action_bar/action_bar.js")
},{"STATE":3,"actions":5,"quick_actions":12,"steps_wizard":15}],5:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = actions

async function actions(opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
  
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
  const main = shadow.querySelector('.main')
  const actions_menu = shadow.querySelector('.actions-menu')

  
  let init = false
  let actions = []
  let icons = {}
  let hardcons = {}

  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  return el

  function onmessage ({ type, data }) {
    switch (type) {
      case 'filter_actions':
        filter(data)
        break
      case 'send_selected_action':
        send_selected_action(data)
        break
      case 'load_actions':
        // Handle the new data format from program_protocol
        handleLoadActions(data)
        break
      default:
        fail(data, type)
    }
  }

  function handleLoadActions(data) {   
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
    _.up({ type: 'selected_action', data: msg.data })
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      create_actions_menu()
      init = true
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject(data) {
    style.innerHTML = data.join('\n')
  }

  function iconject(data) {
    icons = data
  }

  function onhardcons(data) {
    hardcons = {
      pin: data[0],
      unpin: data[1],
      default: data[2],
      undefault: data[3]
    }
  }

  function onactions(data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    actions = vars
  }

  function create_actions_menu() {
    actions_menu.replaceChildren()
    actions.forEach(create_action_item)
  }

  function create_action_item(action_data, index) {
    const action_item = document.createElement('div')
    action_item.classList.add('action-item')
    
    const icon = icons[index]
    
    action_item.innerHTML = `
    <div class="action-icon">${icon}</div>
    <div class="action-name">${action_data.action}</div>
    <div class="action-pin">${action_data.pin ? hardcons.pin : hardcons.unpin}</div>
    <div class="action-default">${action_data.default ? hardcons.default : hardcons.undefault}</div>`
    action_item.onclick = onaction
    actions_menu.appendChild(action_item)

    function onaction() {
      send_selected_action({ data: action_data })
    }
  }

  function filter(search_term) {
    const items = shadow.querySelectorAll('.action-item')
    items.forEach(item => {
      const action_name = item.children[1].textContext.toLowerCase()
      const matches = action_name.includes(search_term.toLowerCase())
      item.style.display = matches ? 'flex' : 'none'
    })
  }
}

function fallback_module() {
  return {
    api: fallback_instance,
  }

  function fallback_instance() {
    return {
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
            '$ref': 'icon.svg'
          },
          'folder.svg': {
            '$ref': 'icon.svg'
          },
          'save.svg': {
            '$ref': 'icon.svg'
          },
          'gear.svg': {
            '$ref': 'icon.svg'
          },
          'help.svg': {
            '$ref': 'icon.svg'
          },
          'terminal.svg': {
            '$ref': 'icon.svg'
          },
          'search.svg': {
            '$ref': 'icon.svg'
          }
        },
        'hardcons/': {
          'pin.svg': {
            '$ref': 'pin.svg'
          },
          'unpin.svg': {
            '$ref': 'unpin.svg'
          },
          'default.svg': {
            '$ref': 'default.svg'
          },
          'undefault.svg': {
            '$ref': 'undefault.svg'
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
},{"STATE":3}],6:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = console_history

async function console_history (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
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
  const main = shadow.querySelector('.main')
  const commands_placeholder = shadow.querySelector('console-commands')
  
  
  let init = false
  let commands = []
  let dricons = []

  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if(protocol){
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }
  return el

  function onmessage ({ type, data }) {
    console.log(`[space->console_history]`, type, data)
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

    command_el.onclick = function () {
      _.up({ type: 'command_clicked', data: command_data })
    }

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
  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init && commands.length > 0) {
      render_commands()
    }
  }

  function fail (data, type) { 
    throw new Error('invalid message', { cause: { data, type } }) 
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
    api: fallback_instance
  }

  function fallback_instance () {
    return {
      drive: {
        'commands/': {
          'list.json': {
            '$ref': 'commands.json'
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
},{"STATE":3}],7:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

module.exports = form_input
async function form_input (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
	
	const on = {
    style: inject,
    data: ondata
  }

  let current_step = null
  let input_accessible = true
	
	if(protocol){
    send = protocol(msg => onmessage(msg))
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
			_.up({
        type: 'action_submitted',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
			console.log('mark_as_complete')
		} else {
      _.up({
        type: 'action_incomplete',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
    }
	}

  const subs = await sdb.watch(onbatch)

  const parent_handler = {
    step_data,  
    reset_data
  }

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }

  function ondata(data) {
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
  
  function step_data(data, type) {
    current_step = data 

    input_accessible = data?.is_accessible !== false
    
    overlay_el.hidden = input_accessible

    input_field_el.placeholder = input_accessible
      ? 'Type to submit'
      : 'Input disabled for this step'
  }

  function reset_data(data, type) {
    input_field_el.value = ''
    drive.put('data/form_input.json', {
      input_field: ''
    })
  }

}
function fallback_module () {
  return {
    api: fallback_instance,
  }
  function fallback_instance () {
    return {
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
            }
						`
          }
        },
        'data/': {
          'form_input.json': {
            raw:  {
              input_field: ""
            }
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/form_input.js")
},{"STATE":3}],8:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

module.exports = input_test
async function input_test (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
	
	const on = {
    style: inject,
    data: ondata
  }

  let current_step = null
  let input_accessible = true
  
	if(protocol){
    send = protocol(msg => onmessage(msg))
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
			_.up({
        type: 'action_submitted',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
			console.log('mark_as_complete')
		} else {
      _.up({
        type: 'action_incomplete',
        data: {
          value: this.value,
          index: current_step?.index || 0
        }
      })
    }
	}

  const subs = await sdb.watch(onbatch)
  
  const parent_handler = {
    step_data,
    reset_data
  }

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }

  function ondata(data) {
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

  function step_data(data, type) {
    current_step = data 

    input_accessible = data?.is_accessible !== false
    
    overlay_el.hidden = input_accessible

    input_field_el.placeholder = input_accessible
      ? 'Type to submit'
      : 'Input disabled for this step'
  }

  function reset_data(data, type) {
    input_field_el.value = ''
    drive.put('data/input_test.json', {
      input_field: ''
    })
  }

}
function fallback_module () {
  return {
    api: fallback_instance,
  }
  function fallback_instance () {
    return {
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
            }
						`
          }
        },
        'data/': {
          'input_test.json': {
            raw:  {
              input_field: ""
            }
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/input_test.js")
},{"STATE":3}],9:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

const program = require('program')
const action_bar = require('action_bar')

const { form_input, input_test } = program

const component_modules = {
  form_input,
  input_test
  // Add more form input components here if needed
}

module.exports = manager

async function manager(opts) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb

  const on = {
    style: inject,
  }

  let variables = []
  let selected_action = null

  const _ = {
    send_actions_bar: null,
    send_form_input: {},
    send_steps_wizard: null,
    send_program: null
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

  const action_bar_el = await action_bar(subs[0], actions_bar_protocol)
  action_bar_placeholder.replaceWith(action_bar_el)

  const program_el = await program(subs[1], program_protocol)
  program_el.classList.add('hide')
  program_placeholder.replaceWith(program_el)


  const form_input_elements = {}

  console.log('subs', subs)

  for (const [index, [component_name, component_fn]] of Object.entries(component_modules).entries()) {
    const final_index = index + 2
  
    console.log('final_index', final_index, component_name, subs[final_index])
    
    const el = await component_fn(subs[final_index], form_input_protocol(component_name))
    el.classList.add('hide')
    form_input_elements[component_name] = el
    form_input_placeholder.parentNode.insertBefore(el, form_input_placeholder)
  }

  form_input_placeholder.remove()

  return el

  // --- Internal Functions ---
  async function onbatch(batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) {
    throw new Error('invalid message', { cause: { data, type } })
  }

  function inject(data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }

  function toggle_view(el, show) {
    el.classList.toggle('hide', !show)
  }

  function get_form_input_component_index(component) {
    const { _: components } = fallback_module()
    return Object.keys(components).indexOf(component)
  }
  
  function render_form_component(component_name) {
    for (const name in form_input_elements) {
      toggle_view(form_input_elements[name], name === component_name)
    }
  }

  
  // -------------------------------
  // Protocol: form input
  // -------------------------------

  function form_input_protocol(component_name) {
    return function (send) {
      _.send_form_input[component_name] = send
      
      const form_input_handlers = {
        action_submitted: form__action_submitted,
        action_incomplete: form__action_incomplete,
      }

      return function on({ type, data }) {  
        const handler = form_input_handlers[type] || fail
        handler(data, type)
      }
    }
  }

  function form__action_submitted(data, type) {
    console.log('manager.on_form_submitted', data, variables, selected_action)
    const step = variables[selected_action][data?.index]
    Object.assign(step, {
      is_completed: true,
      status: 'completed',
      data: data?.value
    })
    _.send_program?.({ type: 'update_data', data: variables })
    _?.send_actions_bar({ type: "form_data", data: variables[selected_action] })

    if (variables[selected_action][variables[selected_action].length - 1]?.is_completed) {
      _.send_actions_bar({ type: 'show_submit_btn' })
    }
  }

  function form__action_incomplete(data, type) {
    console.log('manager.on_form_incomplete', data, variables, selected_action)
    const step = variables[selected_action][data?.index]

    if (!step.is_completed) return

    Object.assign(step, {
      is_completed: false,
      status: 'error',
      data: data?.value
    })
    _.send_program?.({ type: 'update_data', data: variables })
    _?.send_actions_bar({ type: "form_data", data: variables[selected_action] })
    _.send_actions_bar({ type: 'hide_submit_btn' })
    
  }
  
  // -------------------------------
  // Protocol: program
  // -------------------------------

  function program_protocol(send) {
    _.send_program = send

    const program_handlers = {
      load_actions: program__load_actions
    }
    return function on({ type, data }) {
      const handler = program_handlers[type] || fail
      handler(data, type)
    }
  }

  function program__load_actions(data, type) {
    variables = data  
    _.send_actions_bar?.({ type, data })
  }

  // -------------------------------
  // Protocol: action bar
  // -------------------------------

  function actions_bar_protocol(send) {
    _.send_actions_bar = send

    const action_bar_handlers = {
      render_form: action_bar__render_form,
      clean_up: action_bar__clean_up,
      action_submitted: action_bar__action_submitted,
      selected_action: action_bar__selected_action
    }

    return function on({ type, data }) {
      const handler = action_bar_handlers[type] || fail
      handler(data, type)
    }
  }

  function action_bar__render_form(data, type) {
    render_form_component(data.component)
    const send = _.send_form_input[data.component]
    if (send) send({ type: 'step_data', data })
  }

  function action_bar__action_submitted(data, type) {
    _.send_program({ type: 'display_result', data })
  }

  function action_bar__selected_action(data, type) {
    selected_action = data
  }

  function action_bar__clean_up(data, type) {
    data && cleanup(data)
  }

  function cleanup(selected_action) {
    const cleaned = variables[selected_action].map(step => ({
      ...step,
      is_completed: false,
      data: ''
    }))
    variables[selected_action] = cleaned
    _.send_program?.({ type: 'update_data', data: variables })

    for (const step of variables[selected_action]) {
      if (step.component && _.send_form_input[step.component]) {
        _.send_form_input[step.component]({ type: 'reset_data'})
      }
    }

    for (const el of Object.values(form_input_elements)) {
      console.log('toggle_view', el, false)
      toggle_view(el, false)
    }
  }
}

// --- Fallback Module ---
function fallback_module() {
  return {
    api: fallback_instance,
    _: {
      'action_bar': { $: '' },
      'program': { $: '' },
    }
  }

  function fallback_instance() {
    return {
      _: {
        'action_bar': {
          0: '',
          mapping: {
            'icons': 'icons',
            'style': 'style'
          }
        },
        'program': {
          0: '',
          mapping: {
            'style': 'style',
            'variables': 'variables',
          }
        },
        'program>form_input': {
          0: '',
          mapping: {
            'style': 'style',
            'data': 'data',
          }
        },
        'program>input_test': {
          0: '',
          mapping: {
            'style': 'style',
            'data': 'data',
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
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/manager/manager.js")
},{"STATE":3,"action_bar":4,"program":11}],10:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

module.exports = create_component_menu
async function create_component_menu (opts, names, inicheck, callbacks) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  const on = {
    style: inject
  }
  const {
    on_checkbox_change,
    on_label_click,
    on_select_all_toggle
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
        </div>
        <ul class="menu-list"></ul>
      </div>
    </div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const main = shadow.querySelector('.main')
  const menu = shadow.querySelector('.menu')
  const toggle_btn = shadow.querySelector('.menu-toggle-button')
  const unselect_btn = shadow.querySelector('.unselect-all-button')
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
  // event listeners
  const subs = await sdb.watch(onbatch)
  toggle_btn.onclick = on_toggle_btn
  unselect_btn.onclick = on_unselect_btn
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

  function handle_document_click (e) {
    const path = e.composedPath()
    if (!menu.classList.contains('hidden') && !path.includes(el)) {
      menu.classList.add('hidden')
    }
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject (data) {
    style.textContent = data.join('\n')
  }
}
function fallback_module () {
  return {
    api: fallback_instance,
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
            }

            .unselect-all-button:hover {
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

}).call(this)}).call(this,"/src/node_modules/menu.js")
},{"STATE":3}],11:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

const form_input = require('form_input')
const input_test = require('input_test')


program.form_input = form_input
program.input_test = input_test

module.exports = program

async function program(opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb

  const on = {
    style: inject,
    variables: onvariables,
  }

  const _ = {
    up: null,
  }

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
  
  const subs = await sdb.watch(onbatch)
  console.log('program', subs)

  const parent_handler = {
    display_result,
    update_data
  }

  return el

  // --- Internal Functions ---
  async function onbatch(batch) {
    for (const { type, paths } of batch) {
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) {
    throw new Error('invalid message', { cause: { data, type } })
  }

  function inject(data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }

  function onvariables(data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    _?.up({
      type: 'load_actions',
      data: vars,
    })
  }

  function onmessage({ type, data }) {
    parent_handler[type]?.(data, type)
  }
  function display_result(data) {
    console.log('Display Result:', data)
    alert(`Result of action(${data?.selected_action}): ${data?.result}`)
  }
  function update_data(data) {
    drive.put('variables/program.json', data)
  }
}

// --- Fallback Module ---
function fallback_module() {
  return {
    api: fallback_instance,
    _: {
      
      'form_input': { $: '' },
      'input_test': { $: '' }
    }
  }

  function fallback_instance() {
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
          'program.json': { '$ref': 'program.json' }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/program/program.js")
},{"STATE":3,"form_input":7,"input_test":8}],12:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = quick_actions

async function quick_actions(opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  
  const on = {
    style: inject,
    icons: iconject,
    hardcons: onhardcons,
    actions: onactions
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
          <span>steps:<span>
          <span class="current-step">1</span>
          <span class="step-separator">-</span>
          <span class="total-step">1</span>
        </span>
        <input class="input-field" type="text" placeholder="Type to search actions...">
      </div>
      <button class="submit-btn" style="display: none;"></button>
      <button class="close-btn"></button>
    </div>
  </div>
  <style>
  </style>`
  const default_actions = shadow.querySelector('.default-actions')
  const text_bar = shadow.querySelector('.text-bar')
  const input_wrapper = shadow.querySelector('.input-wrapper')
  const slash_prefix = shadow.querySelector('.slash-prefix')
  const command_text = shadow.querySelector('.command-text')
  const input_field = shadow.querySelector('.input-field')
  const submit_btn = shadow.querySelector('.submit-btn')
  const close_btn = shadow.querySelector('.close-btn')
  const step_display = shadow.querySelector('.step-display')
  const current_step = shadow.querySelector('.current-step')
  const total_steps = shadow.querySelector('.total-step')
  const style = shadow.querySelector('style')
  const main = shadow.querySelector('.main')
  
  let init = false
  let icons = {}
  let hardcons = {}
  let defaults = []
  
  let send = null
  const _ = {
    up: null
  }
  if(protocol){
    send = protocol(msg => onmessage(msg))
    _.up = send
  }
  text_bar.onclick = activate_input_field
  close_btn.onclick = deactivate_input_field
  submit_btn.onclick = onsubmit
  input_field.oninput = oninput

  const subs = await sdb.watch(onbatch)

  submit_btn.innerHTML = hardcons.submit
  close_btn.innerHTML = hardcons.cross

  return el

  function onsubmit() {
    _.up({ type: 'action_submitted'})
  }
  function oninput(e) {
    _.up({ type: 'filter_actions', data: e.target.value })
  }

  function update_input_display(selected_action = null) {
    if (selected_action) {
      slash_prefix.style.display = 'inline'
      command_text.style.display = 'inline'
      command_text.textContent = `#${selected_action.action}`
      current_step.textContent = selected_action?.current_step || 1
      total_steps.textContent = selected_action.total_steps || 1
      step_display.style.display = 'inline-flex'
      
      input_field.style.display = 'none'
    } else {
      slash_prefix.style.display = 'none'
      command_text.style.display = 'none'
      input_field.style.display = 'block'
      submit_btn.style.display = 'none'
      step_display.style.display = 'none'
      input_field.placeholder = 'Type to search actions...'
    }
  }

  function activate_input_field() {
    is_input_active = true
    
    default_actions.style.display = 'none'
    text_bar.style.display = 'none'
    
    input_wrapper.style.display = 'flex'
    input_field.focus()
    
    _.up({ type: 'display_actions', data: 'block' })
  }

  function onmessage({ type, data }) {
    const message_map = {
      selected_action,
      deactivate_input_field,
      show_submit_btn,
      update_current_step,
      hide_submit_btn,
    }
    const handler = message_map[type] || fail
    handler(data)
  }

  function deactivate_input_field(data) {
    is_input_active = false
    
    default_actions.style.display = 'flex'
    text_bar.style.display = 'flex'
    
    input_wrapper.style.display = 'none'
    
    input_field.value = ''
    update_input_display()
    
    _.up({ type: 'display_actions', data: 'none' })
  }
  
  function show_submit_btn() {
    submit_btn.style.display = 'flex'
  }

  function hide_submit_btn() {
    submit_btn.style.display = 'none'
  }

  function update_current_step(data) {
    let current_step_value = data?.index + 1 || 1
    current_step.textContent = current_step_value
  }

  function selected_action(data) {
    update_input_display(data)
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if(!init) {
      create_default_actions(defaults)
      init = true
    } else {
      //TODO: update actions
    }
  }
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject(data) {
    style.innerHTML = data.join('\n')
  }
  function onhardcons(data) {
    hardcons = {
      submit: data[0],
      cross: data[1]
    }
  }
  function iconject(data) {
    icons = data
  }

  function onactions(data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    defaults = vars
  }

  function create_default_actions (actions) {
    default_actions.replaceChildren()
    actions.forEach(action => {
      const btn = document.createElement('div')
      btn.classList.add('action-btn')
      btn.innerHTML = icons[action.icon]
      default_actions.appendChild(btn)
    })
    
    close_btn.innerHTML = icons['close']
  }
}

function fallback_module() {
  return {
    api: fallback_instance,
  }

  function fallback_instance() {
    return {
      drive: {
        'icons/': {
          '0.svg': {
            '$ref': 'action1.svg'
          },
          '1.svg': {
            '$ref': 'action2.svg'
          },
          '2.svg': {
            '$ref': 'action1.svg'
          },
          '3.svg': {
            '$ref': 'action2.svg'
          },
          '4.svg': {
            '$ref': 'action1.svg'
          }
        },
        'hardcons/': {
          'submit.svg': {
            '$ref': 'submit.svg'
          },
          'close.svg': {
            '$ref': 'cross.svg'
          }
        },
        'actions/': {
          'default.json': {
            raw: JSON.stringify([
              {
                name: 'New',
                icon: '0',
              },
              {
                name: 'Settings',
                icon: '1',
              },
              {
                name: 'Help',
                icon: '2',
              },
              {
                name: 'About',
                icon: '3',
              },
              {
                name: 'Exit',
                icon: '4',
              }
            ])
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
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/quick_actions/quick_actions.js")
},{"STATE":3}],13:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { get } = statedb(fallback_module)

module.exports = quick_editor

async function quick_editor (opts) {
  // ----------------------------------------
  let init
  let data
  const current_data = {}

  const { sdb, io, net } = await get(opts.sid)
  const { drive } = sdb

  const on = {
    style: inject
  }
  // ----------------------------------------
  const el = document.createElement('div')
  el.classList.add('quick-editor')
  const shadow = el.attachShadow({mode: 'closed'})

  shadow.innerHTML = `
      <button class="dots-button">⋮</button>
      <div class="quick-box">
        <div class="quick-menu hidden">
          <!-- Top Tabs -->
          <div class="top-btns">
          </div>
          <div class="top-tabs">
          </div>
          <button class="apply-button">Apply</button>
        </div>
      </div>
      <style>
      </style>
      `

  const style = shadow.querySelector('style')
  const menu_btn = shadow.querySelector('.dots-button')
  const menu = shadow.querySelector('.quick-menu')
  const textarea = shadow.querySelector('textarea')
  const apply_btn = shadow.querySelector('.apply-button')
  const top_btns = shadow.querySelector('.top-btns')
  const top_tabs = shadow.querySelector('.top-tabs')
  // ----------------------------------------
  // EVENTS
  // ----------------------------------------
  await sdb.watch(onbatch)
  menu_btn.onclick = menu_click
  apply_btn.onclick = apply

  io.on(port => {
    const { by, to } = port
    port.onmessage = event => {
      const txt = event.data
      const key = `[${by} -> ${to}]`
      data = txt
    }
  })
  const port = await io.at(net.page.id)
  
  return el

  // ----------------------------------------
  // FUNCTIONS
  // ----------------------------------------
  function make_btn (name, classes) {
    const btn = document.createElement('button')
    btn.textContent = name
    btn.classList.add(...classes.split(' '))
    btn.setAttribute('tab', name)
    return btn
  }
  function make_tab (id, classes) {
    const tab = document.createElement('div')
    tab.classList.add(...classes.split(' '))
    tab.id = id.replaceAll('.', '')
    tab.innerHTML = `
      <div class="sub-btns">
      </div>
      <div class="subtab-content">
      </div>
    `
    return tab
  }
  function make_textarea (id, classes, value) {
    const textarea = document.createElement('textarea')
    textarea.id = id.replaceAll('.', '')
    textarea.classList.add(...classes.split(' '))
    textarea.value = value
    textarea.placeholder = 'Type here...'
    return textarea
  }
  async function menu_click () {
    menu.classList.toggle('hidden')
    if(init)
      return
    init = true
    Object.entries(data).forEach(([dataset, files], i) => {
      let first = ''
      if(!i){
        first = ' active'
        current_data.dataset = dataset
      }
      const no_slash = dataset.split('/')[0]
      const btn = make_btn(no_slash, `tab-button${first}`)
      const tab = make_tab(no_slash, `tab-content${first}`)

      btn.onclick = () => tab_btn_click(btn, top_btns, top_tabs, '.tab-content', 'dataset', dataset)
      
      top_btns.append(btn)
      top_tabs.append(tab)

      const sub_btns = tab.querySelector('.sub-btns')
      const subtab = tab.querySelector('.subtab-content')
      Object.entries(files).forEach(([file, raw], j) => {
        let first = ''
        if(!j){
          first = ' active'
          current_data.file = file
        }
        const sub_btn = make_btn(file, `sub-btn${first}`)
        const textarea = make_textarea(file, `subtab-textarea${first}`, raw)

        sub_btn.onclick = () => tab_btn_click(sub_btn, sub_btns, subtab, '.subtab-textarea', 'file', file)

        sub_btns.append(sub_btn)
        subtab.append(textarea)
      })
    })
  }
  function tab_btn_click (btn, btns, tabs, tab_class, key, name) {
    btns.querySelector('.active').classList.remove('active')
    tabs.querySelector(tab_class+'.active').classList.remove('active')

    btn.classList.add('active')
    tabs.querySelector('#'+btn.getAttribute('tab').replaceAll('.', '')).classList.add('active')
    current_data[key] = name

  }

  function apply() {
    port.postMessage({ type: 'put', args: [
      current_data.dataset + current_data.file,
      shadow.querySelector('.tab-content.active textarea.active').value
    ]})
  }
  
  function inject (data) {
    style.textContent = data.join('\n')
  }
  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

}


function fallback_module(){
  return {
    api: fallback_instance
  }
  function fallback_instance(){
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
              position: absolute;
              top: 100%;
              right: 0;
              background: white;
              padding: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              white-space: nowrap;
              z-index: 10;
              width: 400px;
            }

            .hidden {
              display: none;
            }

            .top-btns {
              display: flex;
              margin-bottom: 8px;
            }

            .tab-button {
              flex: 1;
              padding: 6px 10px;
              background: #eee;
              border: none;
              cursor: pointer;
              border-bottom: 2px solid transparent;
            }
            .tab-button.active {
              background: white;
              border-bottom: 2px solid #4CAF50;
            }
            .tab-content {
              display: none;
            }
            .tab-content.active {
              display: block;
            }

            .sub-btns {
              float: right;
              display: flex;
              flex-direction: column;
              gap: 4px;
              margin-left: 5px;
            }

            .sub-btn {
              padding: 4px 8px;
              background: #f1f1f1;
              border: none;
              cursor: pointer;
              text-align: right;
            }
            .sub-btn.active {
              background: #d0f0d0;
            }

            .subtab-content {
              overflow: hidden;
            }

            .subtab-textarea {
              width: 300px;
              height: 400px;
              display: none;
              resize: vertical;
            }
            .subtab-textarea.active {
              display: block;
            }

            .apply-button {
              display: block;
              margin-top: 10px;
              padding: 5px 10px;
              background-color: #4CAF50;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            }

            `
          }
        }
      }
    }
  }
}
}).call(this)}).call(this,"/src/node_modules/quick_editor.js")
},{"STATE":3}],14:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

const console_history = require('console_history')
const actions = require('actions')
const tabbed_editor = require('tabbed_editor')
const graph_explorer = require('graph-explorer')

module.exports = component

async function component (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  const on = {
    style: inject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
  <div class="space main">
    <graph-explorer-placeholder></graph-explorer-placeholder>
    <actions-placeholder></actions-placeholder>
    <tabbed-editor-placeholder></tabbed-editor-placeholder>
    <console-history-placeholder></console-history-placeholder>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const main = shadow.querySelector('.main')
  const graph_explorer_placeholder = shadow.querySelector('graph-explorer-placeholder')
  const actions_placeholder = shadow.querySelector('actions-placeholder')
  const tabbed_editor_placeholder = shadow.querySelector('tabbed-editor-placeholder')
  const console_placeholder = shadow.querySelector('console-history-placeholder')

  
  let console_history_el = null
  let actions_el = null
  let tabbed_editor_el = null
  let graph_explorer_el = null

  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if(protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, actions: null, send_console_history: null, send_tabbed_editor: null, send_graph_explorer: null }
  }
  
  graph_explorer_el = protocol ? await graph_explorer(subs[3], graph_explorer_protocol) : await graph_explorer(subs[3])
  graph_explorer_el.classList.add('graph-explorer')
  graph_explorer_placeholder.replaceWith(graph_explorer_el)
  
  actions_el = protocol ? await actions(subs[1], actions_protocol) : await actions(subs[1])
  actions_el.classList.add('actions')
  actions_placeholder.replaceWith(actions_el)
  
  tabbed_editor_el = protocol ? await tabbed_editor(subs[2], tabbed_editor_protocol) : await tabbed_editor(subs[2])
  tabbed_editor_el.classList.add('tabbed-editor')
  tabbed_editor_placeholder.replaceWith(tabbed_editor_el)
  
  console_history_el = protocol ? await console_history(subs[0], console_history_protocol) : await console_history(subs[0])
  console_history_el.classList.add('console-history')
  console_placeholder.replaceWith(console_history_el)
  let console_view = false
  let actions_view = false
  let tabbed_editor_view = true
  let graph_explorer_view = false

  if (protocol) {
    console_history_el.classList.add('hide')
    actions_el.classList.add('hide')
    tabbed_editor_el.classList.add('show')
    graph_explorer_el.classList.add('hide')
  }

  return el
  
  function console_history_toggle_view() { 
    if(console_view) {
      console_history_el.classList.remove('show')
      console_history_el.classList.add('hide')
    } else {
      console_history_el.classList.remove('hide')
      console_history_el.classList.add('show')
    }
    console_view = !console_view
  }

  function actions_toggle_view() {
    if(actions_view) {
      actions_el.classList.remove('show')
      actions_el.classList.add('hide')
    } else {
      actions_el.classList.remove('hide')
      actions_el.classList.add('show')
    }
    actions_view = !actions_view
  }

  function graph_explorer_toggle_view() {
    if(graph_explorer_view) {
      graph_explorer_el.classList.remove('show')
      graph_explorer_el.classList.add('hide')
    } else {
      graph_explorer_el.classList.remove('hide')
      graph_explorer_el.classList.add('show')
    }
    graph_explorer_view = !graph_explorer_view
  }

  function tabbed_editor_toggle_view(show = true) {
    if (show) {
      tabbed_editor_el.classList.remove('hide')
      tabbed_editor_el.classList.add('show')
      actions_el.classList.remove('show')
      actions_el.classList.add('hide')
      console_history_el.classList.remove('show')
      console_history_el.classList.add('hide')
      graph_explorer_el.classList.remove('show')
      graph_explorer_el.classList.add('hide')
      tabbed_editor_view = true
      actions_view = false
      console_view = false
      graph_explorer_view = false
    } else {
      tabbed_editor_el.classList.remove('show')
      tabbed_editor_el.classList.add('hide')
      tabbed_editor_view = false
    }
  } 

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }
  
  // ---------
  // PROTOCOLS
  // ---------

  function console_history_protocol (send) {
    _.send_console_history = send
    return on
    function on ({ type, data }) { 
      _.up(type, data)
    }
  }
  
  function actions_protocol (send) {
    _.send_actions = send
    return on
    function on ({ type, data }) { 
      _.up({ type, data })
    }
  }
  
  function tabbed_editor_protocol (send) {
    _.send_tabbed_editor = send
    return on
    function on ({ type, data }) { 
      _.up({ type, data })
    }
  }
  
  function graph_explorer_protocol (send) {
    _.send_graph_explorer = send
    return on
    function on ({ type, data }) { 
      _.up({ type, data })
    }
  }
  
  function onmessage ({ type, data }) {
    if(type == 'console_history_toggle') console_history_toggle_view()
    else if (type == 'graph_explorer_toggle') graph_explorer_toggle_view()
    else if (type == 'display_actions') actions_toggle_view(data)
    else if (type == 'filter_actions') _.send_actions({ type, data })
    else if (type == 'tab_name_clicked') {
      tabbed_editor_toggle_view(true)
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor({ type: 'toggle_tab', data })
      }
    }
    else if (type == 'tab_close_clicked') {
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor({ type: 'close_tab', data })
      }
    }
    else if (type == 'switch_tab') {
      tabbed_editor_toggle_view(true)
      if (_.send_tabbed_editor) {
        _.send_tabbed_editor({ type, data })
      }
    }
    else if (type == 'entry_toggled') {
      if (_.send_graph_explorer) {
        _.send_graph_explorer({ type, data })
      }
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      'console_history': {
        $: ''
      },
      'actions': {
        $: ''
      },
      'tabbed_editor': {
        $: ''
      },
      'graph-explorer': {
        $: ''
      }
    }
  }

  function fallback_instance () {
    return {
      _: {
        'console_history': {
          0: '',
          mapping: {
            'style': 'style',
            'commands': 'commands',
            'icons': 'icons',
            'scroll': 'scroll'
          }
        },
        'actions': {
          0: '',
          mapping: {
            'style': 'style',
            'actions': 'actions',
            'icons': 'icons',
            'hardcons': 'hardcons'
          }
        },
        'tabbed_editor': {
          0: '',
          mapping: {
            'style': 'style',
            'files': 'files',
            'highlight': 'highlight',
            'active_tab': 'active_tab'
          }
        },
        'graph-explorer': {
          0: '',
          mapping: {
            'style': 'style',
            'entries': 'entries',
            'runtime': 'runtime',
            'mode': 'mode'
          }
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
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/space.js")
},{"STATE":3,"actions":5,"console_history":6,"graph-explorer":2,"tabbed_editor":16}],15:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

module.exports = steps_wizard

async function steps_wizard (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  
  const on = {
    style: inject
  }

  let variables = []
  let currentActiveStep = 0

  let _ = null
  if(protocol){
    send = protocol(msg => onmessage(msg))
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
  const subs = await sdb.watch(onbatch)

  // for demo purpose
  render_steps([
    {name: "Optional Step", "type": "optional", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
	  {name: "Step 2 testingasadasdadasdasdaasdasdsassss", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 3", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 4", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 5", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 6", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 7", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 8", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 9", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 10", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 11", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
    {name: "Step 12", "type": "mandatory", "is_completed": false, "component": "form_input", "status": "default", "data": ""},
  ])

  return el
  
  function onmessage ({ type, data }) {
    console.log('steps_ data', type, data)
    if (type === 'init_data') {
      variables = data
      render_steps(variables)
    }
  }
  
  function render_steps(steps) {
    if (!steps)
      return;

    steps_entries.innerHTML = '';

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

      btn.onclick = async () => {
        console.log('Clicked:', step)
        currentActiveStep = index
        center_step(btn)
        render_steps(steps)
        _?.up({type: 'step_clicked', data: {...step, index, total_steps: steps.length, is_accessible: accessible}})
      };

      steps_entries.appendChild(btn)
    });
  }

  
  function center_step(step_button) {
    const container_width = steps_entries.clientWidth
    const step_left = step_button.offsetLeft
    const step_width = step_button.offsetWidth
    
    const center_position = step_left - (container_width / 2) + (step_width / 2)
    
    steps_entries.scrollTo({
      left: center_position,
      behavior: 'smooth'
    })
  }

  function can_access(index, steps) {
    for (let i = 0; i < index; i++) {
      if (!steps[i].is_completed && steps[i].type !== 'optional') {
        return false
      }
    }

    return true
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
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
          'stepswizard.css': {
            '$ref': 'stepswizard.css' 
          }
        }
      }
    }
  }
}
}).call(this)}).call(this,"/src/node_modules/steps_wizard/steps_wizard.js")
},{"STATE":3}],16:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = tabbed_editor

async function tabbed_editor(opts, protocol) {
  const { sdb } = await get(opts.sid)
  const { drive } = sdb
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
  const main = shadow.querySelector('.main')
  const editor_content = shadow.querySelector('.editor-content')

  
  let init = false
  let files = {}
  let active_tab = null
  let current_editor = null

  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send }
  }

  const subs = await sdb.watch(onbatch)

  return el

  function onmessage({ type, data }) {
    switch (type) {
      case 'switch_tab':
        switch_to_tab(data)
        break
      case 'close_tab':
        close_tab(data)
        break
      case 'toggle_tab':
        toggle_tab(data)
        break
      default:
    }
  }

  function switch_to_tab(tab_data) {
    if (active_tab === tab_data.id) {
      return
    }
    
    active_tab = tab_data.id
    create_editor(tab_data)
    
    if (_) {
      _.up({ type: 'tab_switched', data: tab_data })
    }
  }

  function toggle_tab(tab_data) {
    if (active_tab === tab_data.id) {
      hide_editor()
      active_tab = null
    } else {
      switch_to_tab(tab_data)
    }
  }

  function close_tab(tab_data) {
    if (active_tab === tab_data.id) {
      hide_editor()
      active_tab = null
    }
    
    if (_) {
      _.up({ type: 'tab_closed', data: tab_data })
    }
  }

  function create_editor(tab_data) {
    let parsed_data = JSON.parse(tab_data[0])
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

  function hide_editor() {
    editor_content.innerHTML = `
      <div class="editor-placeholder">
        <div class="placeholder-text">Select a file to edit</div>
      </div>`
    current_editor = null
  }

  function update_line_numbers() {
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

  function save_file_content() {
    if (!current_editor) return
    
    const { code_area, tab_data } = current_editor
    files[tab_data.id] = code_area.value
    
    if (_) {
      _.up({ 
        type: 'file_changed', 
        data: { 
          id: tab_data.id, 
          content: code_area.value 
        } 
      })
    }
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
    if (!init) {
      init = true
    }
  }

  function fail(data, type) { 
    console.warn('Invalid message', { data, type })
  }

  function inject(data) {
    style.innerHTML = data.join('\n')
  }

  function onfiles(data) {
    files = data[0]
  }

  function onactivetab(data) {
    if (data && data.id !== active_tab) {
      switch_to_tab(data)
    }
  }

  function handle_code_input() {
    update_line_numbers()
    save_file_content()
  }

  function handle_code_scroll() {
    if (!current_editor) return
    const { code_area, line_numbers } = current_editor
    line_numbers.scrollTop = code_area.scrollTop
  }
}

function fallback_module() {
  return {
    api: fallback_instance
  }

  function fallback_instance() {
    return {
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
},{"STATE":3}],17:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = component

async function component (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const { drive } = sdb
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
  const main = shadow.querySelector('.main')

  
  let init = false
  let variables = []
  let dricons = []
  const subs = await sdb.watch(onbatch)
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

  function onmessage({ type, data }) {
    switch (type) {
      default:
        // Handle other message types
    }
  }

  async function create_btn ({ name, id }, index) {
    const el = document.createElement('div')
    el.innerHTML = `
    <span class="icon">${dricons[index + 1]}</span>
    <span class='name'>${id}</span>
    <span class="name">${name}</span>
    <button class="btn">${dricons[0]}</button>`

    el.className = 'tabsbtn'
    const icon_el = el.querySelector('.icon')
    const name_el = el.querySelector('.name')
    const close_btn = el.querySelector('.btn')

    name_el.draggable = false
    
    // Add click handler for tab name (switch/toggle tab)
    name_el.onclick = () => {
      if (_) {
        _.up({ type: 'tab_name_clicked', data: { id, name } })
      }
    }
    
    // Add click handler for close button
    close_btn.onclick = (e) => {
      e.stopPropagation()
      if (_) {
        _.up({ type: 'tab_close_clicked', data: { id, name } })
      }
    }
    
    entries.appendChild(el)
    return
  }

  async function onbatch(batch) {
    for (const { type, paths } of batch){
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
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }
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
  }
  function fallback_instance () {
    return {
      drive: {
        'icons/': {
          'cross.svg': {
            '$ref': 'cross.svg'
          },
          '1.svg': {
            '$ref': 'icon.svg'
          },
          '2.svg': {
            '$ref': 'icon.svg'
          },
          '3.svg': {
            '$ref': 'icon.svg'
          }
        },
        'variables/': {
          'tabs.json': {
            '$ref': 'tabs.json'
          }
        },
        'scroll/': {
          'position.json': {
            raw: '100'
          }
        },
        'style/': {
          'theme.css': {
            '$ref': 'style.css'
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/tabs/tabs.js")
},{"STATE":3}],18:[function(require,module,exports){
(function (__filename){(function (){
const state = require('STATE')
const state_db = state(__filename)
const { sdb, get } = state_db(fallback_module)

const tabs_component = require('tabs')
const task_manager = require('task_manager')

module.exports = tabsbar

async function tabsbar (opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  const on = {
    style: inject,
    icons: inject_icons
  }

  let dricons = {}
  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })
  
  let send = null
  let _ = null
  if (protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, tabs: null }
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
  const main = shadow.querySelector('.main')
  const hat_btn = shadow.querySelector('.hat-btn')
  const bar_btn = shadow.querySelector('.bar-btn')

  const subs = await sdb.watch(onbatch)
  if (dricons[0]) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(dricons[0], 'image/svg+xml')
    const svgElem = doc.documentElement
    hat_btn.replaceChildren(svgElem)
  }
  if (dricons[2]) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(dricons[2], 'image/svg+xml')
    const svgElem = doc.documentElement
    bar_btn.replaceChildren(svgElem)
  }
  const tabs = protocol ? await tabs_component(subs[0], () => {}, tabs_protocol) : await tabs_component(subs[0])
  tabs.classList.add('tabs-bar')
  shadow.querySelector('tabs').replaceWith(tabs)

  const task_mgr = await task_manager(subs[1], () => console.log('Task manager clicked!'))
  task_mgr.classList.add('bar-btn')
  shadow.querySelector('task-manager').replaceWith(task_mgr)

  return el

  function onmessage({ type, data }) {
    switch (type) {
      default:
        // Handle other message types
    }
  }

  function tabs_protocol(send) {
    _.tabs = send
    return on
    function on({ type, data }) {
      _.up({ type, data })
    }
  }

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }

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
            style: 'style'
          }
        },
        task_manager: {
          0: '',
          mapping: {
            count: 'count',
            style: 'style'
          }
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
        }
      }
    }
  }
}
}).call(this)}).call(this,"/src/node_modules/tabsbar/tabsbar.js")
},{"STATE":3,"tabs":17,"task_manager":19}],19:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
module.exports = task_manager

async function task_manager (opts, callback = () => console.log('task manager clicked')) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  let number = 0
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
  const main = shadow.querySelector('.main')
  const btn = shadow.querySelector('.task-count-btn')

  
  btn.onclick = callback

  await sdb.watch(onbatch)

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.innerHTML = data.join('\n')
  }

  function update_count (data) {
    if (btn) btn.textContent = data.toString()
    else number = data
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
  }

  function fallback_instance () {
    return {
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
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/task_manager.js")
},{"STATE":3}],20:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)
const action_bar = require('action_bar')
const tabsbar = require('tabsbar')

module.exports = taskbar

async function taskbar(opts, protocol) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
  const on = {
    style: inject
  }

  const el = document.createElement('div')
  const shadow = el.attachShadow({ mode: 'closed' })

  shadow.innerHTML = `
  <div class="taskbar-container main">
    <div class="action-bar-slot"></div>
    <div class="tabsbar-slot"></div>
  </div>
  <style>
  </style>`
  const style = shadow.querySelector('style')
  const main = shadow.querySelector('.main')
  const action_bar_slot = shadow.querySelector('.action-bar-slot')
  const tabsbar_slot = shadow.querySelector('.tabsbar-slot')

  
  const subs = await sdb.watch(onbatch)
  let send = null
  let _ = null
  if(protocol) {
    send = protocol(msg => onmessage(msg))
    _ = { up: send, action_bar: null, tabsbar: null }
  }
  const action_bar_el = protocol ? await action_bar(subs[0], action_bar_protocol) : await action_bar(subs[0])
  action_bar_el.classList.add('replaced-action-bar')
  action_bar_slot.replaceWith(action_bar_el)

  const tabsbar_el = protocol ? await tabsbar(subs[1], tabsbar_protocol) : await tabsbar(subs[1])
  tabsbar_el.classList.add('replaced-tabsbar')
  tabsbar_slot.replaceWith(tabsbar_el)

  return el

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }

  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }

  function inject(data) {
    style.innerHTML = data.join('\n')
  }

  // ---------
  // PROTOCOLS  
  // ---------
  function action_bar_protocol (send) {
    _.action_bar = send
    return on
    function on ({ type, data }) { 
      _.up({ type, data })
    }
  }
  
  function tabsbar_protocol (send) {
    _.tabsbar = send
    return on
    function on ({ type, data }) { 
      _.up({ type, data })
    }
  }
  
  function onmessage ({ type, data }) {
    switch (type) {
      case 'tab_name_clicked':
      case 'tab_close_clicked':
        _.up({ type, data })
        break
      default:
        if (_.action_bar) {
          _.action_bar({ type, data })
        }
    }
  }
}

function fallback_module() {
  return {
    api: fallback_instance,
    _: {
      'action_bar': {
        $: ''
      },
      'tabsbar': {
        $: ''
      },
    }
  }

  function fallback_instance() {
    return {
      _: {
        'action_bar': {
          0: '',
          mapping: {
            'icons': 'icons',
            'style': 'style'
          }
        },
        'tabsbar': {
          0: '',
          mapping: {
            'icons': 'icons',
            'style': 'style'
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
              .replaced-action-bar {
                display: flex;
              }
              @media (max-width: 768px) {
                .taskbar-container {
                  flex-direction: column;
                }
              }
            `
          }
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/taskbar/taskbar.js")
},{"STATE":3,"action_bar":4,"tabsbar":18}],21:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(fallback_module)

const space = require('space')
const taskbar = require('taskbar')

module.exports = theme_widget

async function theme_widget (opts) {
  const { id, sdb } = await get(opts.sid)
  const {drive} = sdb
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
  const main = shadow.querySelector('.main')
  const space_slot = shadow.querySelector('.space-slot')
  const taskbar_slot = shadow.querySelector('.taskbar-slot')


  const subs = await sdb.watch(onbatch)
  
  let space_el = null
  let taskbar_el = null
  const _ = { send_space: null, send_taskbar: null }
  
  taskbar_el = await taskbar(subs[1], taskbar_protocol)
  taskbar_slot.replaceWith(taskbar_el)
  
  space_el = await space(subs[0], space_protocol)
  space_el.classList.add('space')
  space_slot.replaceWith(space_el)
  
  return el
  
  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail(data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  function inject (data) {
    style.replaceChildren((() => {
      return document.createElement('style').textContent = data[0]
    })())
  }

  // ---------
  // PROTOCOLS
  // ---------
  function space_protocol (send) {
    _.send_space = send
    return on
    function on ({ type, data }) {
      _.send_taskbar({ type, data })
    }
  }

  function taskbar_protocol (send) {
    _.send_taskbar = send
    return on
    function on ({ type, data }) {
      _.send_space({ type, data })
    }
  }
}

function fallback_module () {
  return {
    api: fallback_instance,
    _: {
      'space': {
        $: ''
      },
      'taskbar': {
        $: ''
      },
    }
  }

  function fallback_instance () {
    return {
      _: {
        'space': {
          0: '',
          mapping: {
            'style': 'style'
          }
        },
        'taskbar': {
          0: '',
          mapping: {
            'style': 'style'
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
        }
      }
    }
  }
}

}).call(this)}).call(this,"/src/node_modules/theme_widget/theme_widget.js")
},{"STATE":3,"space":14,"taskbar":20}],22:[function(require,module,exports){
const prefix = 'https://raw.githubusercontent.com/alyhxn/playproject/main/'
const init_url = location.hash === '#dev' ? 'web/init.js' : prefix + 'src/node_modules/init.js'
const args = arguments

const has_save = location.hash.includes('#save')
const fetch_opts = has_save ? {} : { cache: 'no-store' }

if (!has_save) {
  localStorage.clear()
}

fetch(init_url, fetch_opts).then(res => res.text()).then(async source => {
  const module = { exports: {} }
  const f = new Function('module', 'require', source)
  f(module, require)
  const init = module.exports
  await init(args, prefix)
  require('./page') // or whatever is otherwise the main entry of our project
})

},{"./page":23}],23:[function(require,module,exports){
(function (__filename){(function (){
const STATE = require('../src/node_modules/STATE')
const statedb = STATE(__filename)
const admin_api = statedb.admin()
admin_api.on(event => {
  console.log(event)
})
const { sdb, io } = statedb(fallback_module)
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
const graph_explorer = require('graph-explorer')
const editor = require('../src/node_modules/quick_editor')
const manager = require('../src/node_modules/manager')
const steps_wizard = require('../src/node_modules/steps_wizard')

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
  graph_explorer,
  manager,
  steps_wizard,
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
  const on = {
    style: inject,
    ...sdb.admin.status.dataset.drive
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
  const pairs = {}
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
    on_select_all_toggle: handle_select_all_toggle
  }
  io.on(port => {
    const { by, to } = port
    port.onmessage = event => {
      const txt = event.data
      const key = `[${by} -> ${to}]`
      on[txt.type] && on[txt.type](...txt.args, pairs[to])

    }
  })
  

  const editor_subs = await sdb.get_sub("page>../src/node_modules/quick_editor")
  const subs = (await sdb.watch(onbatch)).filter((_, index) => index % 2 === 0)
  console.log('Page subs', subs)
  const nav_menu_element = await navbar(subs[names.length], names, initial_checked_indices, menu_callbacks)
  navbar_slot.replaceWith(nav_menu_element)
  create_component(entries)
  window.onload = scroll_to_initial_selected

  
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
    const component_content = await factory(subs[index])
    console.log('component_content', index)
    component_content.className = 'component-content'
    
    const node_id = admin.status.s2i[subs[index].sid]
    const editor_id = admin.status.a2i[admin.status.s2i[editor_subs[index].sid]]
    inner.append(component_content, await editor(editor_subs[index]))
    

    const result = {}
    const drive = admin.status.dataset.drive

    pairs[editor_id] = node_id
    
    const datasets = drive.list('', node_id)
    for(dataset of datasets) {
      result[dataset] = {}
      const files = drive.list(dataset, node_id)
      for(file of files){
        result[dataset][file] = (await drive.get(dataset+file, node_id)).raw
      }
    }
    

    const port = await io.at(editor_id)
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

  async function onbatch(batch) {
    for (const { type, paths } of batch){
      const data = await Promise.all(paths.map(path => drive.get(path).then(file => file.raw)))
      console.log('onbatch', type, data)
      const func = on[type] || fail
      func(data, type)
    }
  }
  function fail (data, type) {  }
  function inject(data) {
    style.innerHTML = data.join('\n')
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
    'graph-explorer',
    '../src/node_modules/manager',
    '../src/node_modules/steps_wizard'
  ]
  const subs = {}
  names.forEach(subgen)
  subs['../src/node_modules/tabs'] = {
    $: '',
    0: '',
    mapping: {
      'icons': 'icons',
      'variables': 'variables',
      'scroll': 'scroll',
      'style': 'style'
    }
  }
  subs['../src/node_modules/manager'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style'
    }
  }
  subs['../src/node_modules/steps_wizard'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style'
    }
  }
  subs['../src/node_modules/tabsbar'] = {
    $: '',
    0: '',
    mapping: {
      'icons': 'icons',
      'style': 'style'
    }
  }
  subs['../src/node_modules/action_bar'] = {
    $: '',
    0: '',
    mapping: {
      'icons': 'icons',
      'style': 'style'
    }
  }
  subs['../src/node_modules/console_history'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style',
      'commands': 'commands',
      'icons': 'icons',
      'scroll': 'scroll'
    }
  }
  subs['../src/node_modules/actions'] = {
    $: '',
    0: '',
    mapping: {
      'actions': 'actions',
      'icons': 'icons',
      'hardcons': 'hardcons',
      'style': 'style'
    }
  }
  subs['../src/node_modules/tabbed_editor'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style',
      'files': 'files',
      'highlight': 'highlight',
      'active_tab': 'active_tab'
    }
  }
  subs['../src/node_modules/task_manager'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style',
      'count': 'count'
    }
  }
  subs['../src/node_modules/quick_actions'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style',
      'icons': 'icons',
      'actions': 'actions',
      'hardcons': 'hardcons'
    }
  }
  subs['graph-explorer'] = {
    $: '',
    0: '',
    mapping: {
      'style': 'style',
      'entries': 'entries',
      'runtime': 'runtime',
      'mode': 'mode'
    }
  }
  subs[menuname] = { 
    $: '',
    0: '',
    mapping: {
      'style': 'style',
    }
  }
  subs['../src/node_modules/quick_editor'] = {
    $: '',
    mapping: {
      'style': 'style'
    }
  }
  for(i = 0; i < Object.keys(subs).length - 2; i++){
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
      
          .components-wrapper {
            width: 95%;
            margin: 0 auto;
            padding: 2.5%;
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
            position: relative;
            padding: 15px;
            border: 3px solid #666;
            resize: both;
            overflow: auto;
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
      .component-wrapper:hover .quick-editor {
        display: block;
      }
      .quick-editor {
        display: none;
        position: absolute;
        top: -5px;
        right: -10px;
        z-index: 16;
      }`
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
      'active_tab/': {},
      'count/': {},
      'entries/': {},
      'runtime/': {},
      'mode/': {},
      'data/': {},
    }
  }
  function quick_editor$ (args, tools, [quick_editor]){
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
        'style': 'style',
      }
    }
  }
}

}).call(this)}).call(this,"/web/page.js")
},{"../src/node_modules/STATE":3,"../src/node_modules/action_bar":4,"../src/node_modules/actions":5,"../src/node_modules/console_history":6,"../src/node_modules/manager":9,"../src/node_modules/menu":10,"../src/node_modules/quick_actions":12,"../src/node_modules/quick_editor":13,"../src/node_modules/space":14,"../src/node_modules/steps_wizard":15,"../src/node_modules/tabbed_editor":16,"../src/node_modules/tabs":17,"../src/node_modules/tabsbar":18,"../src/node_modules/task_manager":19,"../src/node_modules/taskbar":20,"../src/node_modules/theme_widget":21,"graph-explorer":2}]},{},[22]);
