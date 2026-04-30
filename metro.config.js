const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  'escape-string-regexp': path.resolve(
    __dirname,
    'node_modules/react-native-webview/node_modules/escape-string-regexp'
  ),
};

module.exports = config;
