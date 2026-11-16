// The market logic lives in ../js and is shared with the website and the desktop app,
// so Metro has to watch that folder too.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../js')];

module.exports = config;
