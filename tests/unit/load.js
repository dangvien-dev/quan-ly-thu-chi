// Loads the browser scripts that have no DOM dependency into a vm context so that their pure
// functions can be unit-tested with node:test. Scripts are classic scripts (no exports): top-level
// functions and `const`s are read back through `run()`.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadScripts(...files) {
    const context = vm.createContext({ console, Intl, JSON, Math, Date });

    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, {
            filename: file,
        });
    }

    /** Evaluate an expression inside the loaded scripts' global scope. */
    return (expression) => vm.runInContext(expression, context);
}

module.exports = { loadScripts };
