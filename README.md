# Joplin Backstage Plugin

**Import files and images directly from your phone to Joplin app on desktop.**

When taking notes on desktop one issue often breaks our workflow, scanning documents and taking pictures on the go and putting it on our notes. You might just switch to phone completely, but taking long notes on your phone is not always ideal with the limited screen. Well this can be solved if we use cloud sync feature, but synchronisation takes time and its not very ideal to sync your devices everytime you make a small change.

Backstage is a plugin for [joplin](https://github.com/laurent22/joplin) using which you can directly choose your files from your phone and paste it to your note on the desktop. You will scan a QR code displayed on your joplin app using your phone and it will open a locally hosted webpage with options of uploading files and texts from your browser. You choose a file and hit send and it will get pasted to your note on the desktop. No internet required.

- Both desktop and mobile needs to be on the same network for this to work.
- Pair your devices once and keep using your phone as a companion. 
- Works with all combination of devices where joplin can run. You can pair your iPhone, Androids with Windows, MacOS, Linux.
- Disable the service when not needed, your devices remain paired.
- You can also paste texts and links to joplin.

# Development

- `/src/index.ts`, which contains the entry point for the plugin source code.
- `/src/manifest.json`, which is the plugin manifest. It contains information such as the plugin a name, version, etc.

## Building the plugin

The plugin is built using Webpack, which creates the compiled code in `/dist`. A JPL archive will also be created at the root, which can use to distribute the plugin.

To build the plugin, simply run `npm run dist`.

The project is setup to use TypeScript, although you can change the configuration to use plain JavaScript.

## Updating the plugin framework

To update the plugin framework, run `npm run update`.

In general this command tries to do the right thing - in particular it's going to merge the changes in package.json and .gitignore instead of overwriting. It will also leave "/src" as well as README.md untouched.

The file that may cause problem is "webpack.config.js" because it's going to be overwritten. For that reason, if you want to change it, consider creating a separate JavaScript file and include it in webpack.config.js. That way, when you update, you only have to restore the line that include your file.
