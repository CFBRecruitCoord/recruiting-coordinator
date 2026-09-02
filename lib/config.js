const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'config.json');
// Empty by default - unlike Dynasty Tracker, this standalone tool doesn't
// assume a specific dynasty save file until the user configures one (via
// the "set up one-click refresh" prompt shown after their first upload).
const DEFAULT_CONFIG = {
    savePath: ''
};

function getConfig() {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

function setConfig(partial) {
    const updated = { ...getConfig(), ...partial };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));
    return updated;
}

module.exports = { getConfig, setConfig };
