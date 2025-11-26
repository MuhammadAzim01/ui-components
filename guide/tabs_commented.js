// state Initialization
const STATE = require('STATE')
const statedb = STATE(__filename)
// eslint-disable-next-line no-unused-vars
const { sdb, get } = statedb(fallback_module)
// exporting the module
module.exports = component
// actual module
async function component (opts, callback = id => console.log('calling:', '@' + id)) {
  // getting the state database for the current instance
  // eslint-disable-next-line no-unused-vars
  const { id, sdb } = await get(opts.sid)
  // optional getting drive from state database but it does not work currently. will be useful in the future though.
  // eslint-disable-next-line no-unused-vars
  const { drive } = sdb
  // on object which contains the functions to be executed when the dataset changes and onbatch is called.
  const on = {
    variables: onvariables,
    style: inject_style,
    icons: iconject,
    scroll: onscroll
  }
  // creating the main element and attaching shadow DOM to it.
  const div = document.createElement('div')
  const shadow = div.attachShadow({ mode: 'closed' })
  // defining the HTML structure of the component using template literals.
  shadow.innerHTML = '<div class="tab-entries"></div>'
  const entries = shadow.querySelector('.tab-entries')
  // Initializing the variables to be used in the element creation. We store the data from drive through the onbatch function in these variables.
  // this init variable is used to check if the component is initialized or not. It is set to true when the component is initialized for the first time. So that after that we can just update the component instead of creating it again using the onbatch function data.
  let init = false
  let variables = []
  let dricons = []

  // subs for storing the Sid's of submodules and onbatch function which is called when the dataset changes.
  // eslint-disable-next-line no-unused-vars
  const subs = await sdb.watch(onbatch)
  // this is just a custom scrolling through drag clicking functionality.
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
  // component function returns the main element.
  return div
  // All the functions are defined below this return statement.
  // this create_btn function is executed using forEach on the variables array. It creates the buttons for each variable in the array. It uses the data from the variables and dricons arrays to create the buttons.
  async function create_btn ({ name, id }, index) {
    const el = document.createElement('div')
    el.innerHTML = `
    <span class="icon">${dricons[index + 1]}</span>
    <span class='name'>${id}</span>
    <span class="name">${name}</span>
    <button class="btn">${dricons[0]}</button>`

    el.className = 'tabsbtn'
    const icon_el = el.querySelector('.icon')
    const label_el = el.querySelector('.name')

    label_el.draggable = false
    icon_el.onclick = callback
    entries.appendChild(el)
  }
  // this function is called when the dataset changes. It calls the functions defined in `on` object.
  function onbatch (batch) {
    for (const { type, data } of batch) (on[type] || fail)(data, type)
    // this condition checks if the component is initialized or not. If not then it creates the buttons using the create_btn function. if the component is already initialized then it can handle the updates to the drive in future.
    if (!init) {
      // after for loop ends and each of the data is stored in their respective variables, we can create the buttons using the create_btn function.
      variables.forEach(create_btn)
      init = true
    } else {
      // TODO: Here we can handle drive updates
      // currently waiting for the next STATE module to be released so we can use the drive updates.
    }
  }
  // this function throws an error if the type of data is not valid. It is used to handle the errors in the onbatch function.
  function fail (data, type) { throw new Error('invalid message', { cause: { data, type } }) }
  // this function adds styles to shadow DOM. It uses the CSSStyleSheet API to create a new stylesheet and then replaces the existing stylesheet with the new one.
  function inject_style (data) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(data)
    shadow.adoptedStyleSheets = [sheet]
  }
  // we simple store the data from the dataset into variables. We can use this data to create the buttons in the create_btn function.
  function onvariables (data) {
    const vars = typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]
    variables = vars
  }
  // same here we store the data into dricons for later use. We can use this data to create the buttons in the create_btn function.
  function iconject (data) {
    dricons = data
  }
  // waiting for the next STATE module to be released so we can use the drive.put() to update the scroll position.
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
// this is the fallback module which is used to create the state database and to provide the default data for the component.
function fallback_module () {
  return {
    api: fallback_instance
  }
  // this is the fallback instance which is used to provide the default data for the instances of a component. this also help in providing an API for csustomization by overriding the default data.
  function fallback_instance () {
    return {
      drive: {
        'icons/': {
          'cross.svg': {
            $ref: 'cross.svg'
            // data is stored through '$ref' functionality
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
        'style/': {
          'theme.css': {
            $ref: 'style.css'
          }
        }
      }
    }
  }
}
