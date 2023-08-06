# Contributing guide

You need to install node.js platform (node and npm should be installed)

## Install development dependencies

-   `npm install`

## Build and run extension in debug mode

-   Press `F5` in vscode to run and debug the extension

Don't forget to run `npm run format` before send pull request and create/run tests via `npm run test` if it's necessary

## Build binary and install to local vscode instance

-   `vsce package`
-   Press ctrl/cmd + shift + P -> install from VSIX...
