const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow bundling the web app HTML as an asset so it can be loaded in a WebView.
config.resolver.assetExts.push('html');

module.exports = config;
