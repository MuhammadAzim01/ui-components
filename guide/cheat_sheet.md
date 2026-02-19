# Cheat Sheet for UI Components Development

## Repository Structure

### General Structure
- **`src/<modulename>.js`**: Main component to be implemented and published.
- **`src/node_modules/<dependencies>`**: Internal dependencies developed within the same repository.
- **`web/page.js`**: Short presentation page converted into `bundle.js` and loaded by `index.html`.
- **`index.html`**: Entry point for the browser.
- **`package.json`**: Defines the project metadata and dependencies.

### Boilerplate Files

#### `index.html`
```html
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><link rel="icon" href="data:,"></head>
  <body><script src="index.js"></script></body>
</html>
```

#### `package.json`
```json
{
  "name": "example",
  "version": "0.0.0",
  "description": "example for using STATE",
  "type": "commonjs",
  "main": "src/example.js",
  "scripts": {
    "start": "budo web/page.js:bundle.js --dir . --live --open -- -i STATE",
    "build": "browserify web/page.js -i STATE -o bundle.js",
    "lint": "standardx --fix"
  },
  "devDependencies": {
    "browserify": "^17.0.1",
    "budo": "^11.8.4",
    "standardx": "^7.0.0"
  },
  "eslintConfig": {
    "env": {
      "browser": true
    },
    "rules": {
      "camelcase": 0,
      "indent": [
        "error",
        2
      ]
    }
  }
}
```

#### `index.js`
```javascript
const env = { version: 'latest' }
const arg = { x: 321, y: 543 }
const url = 'https://playproject.io/datashell/shim.js'
const src = `${url}?${new URLSearchParams(env)}#${new URLSearchParams(arg)}`
this.open ? document.body.append(Object.assign(document.createElement('script'), { src })) : importScripts(src)
```

#### `web/page.js`
```javascript
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb } = statedb(defaults)

const example = require('..')

const subs = sdb.watch(onbatch)
const [{ sid }] = subs
const element = example({ sid })
document.body.append(element)

function onbatch (batch) {
  // Handle updates
}

function defaults () {
  return {
    _: {
      '..': {
        $: '',
        0: override,
        mapping : {}
      }
    },
    drive : {}
  }

  function override ([example]) {
    const data = example()
    // Customize `data` if needed
    return data
  }
}
```

#### `src/example.js`
```javascript
const STATE = require('STATE')
const statedb = STATE(__filename)
const { sdb, get } = statedb(defaults)

module.exports = example

function example (opts) {
  const { sdb } = get(opts.sid)

  const drive = sdb.drive({ type: 'text' })
  const text = drive.get('title.json')
  const el = document.createElement('div')
  el.innerHTML = `<h1> ${text} </h1>`

  return el
}

function defaults () {
  return {
    drive: {},
    api,
    _: {}
  }

  function api () {
    const drive = {
      'text/': {
        'title.json': { raw: 'hello world' }
      }
    }
    return { drive, _: {} }
  }
}
```

## Development Workflow
1. **Initialization**:
   - Run `npm init -y` in the directory.

2. **Set up the repository**:
   - Create the boilerplate files (`index.html`, `package.json`, `web/boot.js`, `web/page.js`, `src/example.js`).
   - Run `npm install` to install dependencies.
3. **Run the development server**:
   ```bash
   npm start
   ```

4. **Build the bundle**:
   ```bash
   npm run build
   ```

5. **Preview the component**:
   - Open address returned by `npm start` in a browser to see the component in action.

## Advanced Features

- Use the `STATE` module for state management and persistent storage.
- Define `drive` objects to store data in `localStorage`.
- Use `onbatch` to handle updates dynamically.
- Customize components using the `defaults` and `api` functions.

## Example Component: `tabs.js` (Standardized):
- [`module_example`](./tabs_commented.js)

## Component Coding Standard:
- [`standard`](./standard.md)

## Module creation Explanation (@TODO: Update):
[`module_guide`](./deep_guide_for_modules.md)

## Module Communication (Standard Protocol):
[`standard_protocol`](./standard_protocol.md)