# Serverless Kubeless Offline Plugin

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

This [Serverless](https://github.com/serverless/serverless) plugin emulates [Kubeless](https://kubeless.io) on your local machine without minikube to speed up your development cycles.
To do so, it starts an HTTP server that handles the request's lifecycle like Kubeless does and invokes your handlers.

**Features:**

* NodeJS only.
* `serverless-webpack` support
* Lazy loading of your files with require cache invalidation: no need for a reloading tool like Nodemon.

## Documentation

* [Installation](#installation)
* [Usage and command line options](#usage-and-command-line-options)
* [Usage with serverless-webpack plugin](#usage-with-serverless-webpack-plugin)
* [Debug process](#debug-process)
* [Simulation quality](#simulation-quality)
* [Inspiration/Prior Art](#inspiration-prior-art)
* [Contributing](#contributing)
* [License](#license)

## Installation

For Serverless v1.x only.

First, add Serverless Kubeless Offline to your project:

`npm install serverless-kubeless-offline --save-dev`

Then inside your project's `serverless.yml` file add following entry to the plugins section: `serverless-kubeless-offline`. If there is no plugin section you will need to add it to the file.

It should look something like this:

```YAML
plugins:
  - serverless-kubeless-offline
```

You can check wether you have successfully installed the plugin by running the serverless command line:

`serverless`

the console should display _KubelessOfflinePlugin_ as one of the plugins now available in your Serverless project.

## Usage and command line options

In your project root run:

`serverless offline start` or `sls offline start`.

to list all the options for the plugin run:

`sls offline --help`

All CLI options are optional:

```
--port                  -p  Port to listen on. Default: 3000
```

Any of the CLI options can be added to your `serverless.yml`. For example:

```
custom:
  serverless-kubeless-offline:
    port: 4000
```

Options passed on the command line override YAML options.

By default you can send your requests to `http://localhost:3000/`. Please note that:

* You'll need to restart the plugin if you modify your `serverless.yml`.
* Kubeless allows all HTTP methods to direct to your handler, and so does the plugin.
* Kubeless automatically handles CORs pre-flight (`OPTIONS`) requests for you, but additional CORs headers for your responses should be set by your handlers.
* In your handler, `process.env.IS_OFFLINE` is `true`.
* When the `Content-Type` header is set to `'application/json'` on a request, Kubeless will `JSON.parse` the body and place it at `event.data`, and so does the plugin.
  But if you send any other `Content-Type`, Kubeless and this plugin will parse the body as a string and place it at `event.data`. You can always acess the request and response objects directly in a Kubeless environment through `event.extensions.request` and `event.extensions.response`.

## Usage with serverless-webpack plugin

Running the `serverless kubeless start` command will fire an `init` and a `end` lifecycle hook which is needed for `serverless-offline` to switch off resources.

Add plugins to your `serverless.yml` file:

```yaml
plugins:
  - serverless-webpack
  - serverless-kubeless
  - serverless-kubeless-offline #serverless-kubeless-offline needs to be last in the list
```

## Debug process

Serverless Kubeless Offline plugin will respond to the overall framework settings and output additional information to the console in debug mode. In order to do this you will have to set the `SLS_DEBUG` environmental variable. You can run the following in the command line to switch to debug mode execution.

> Unix: `export SLS_DEBUG=*`

> Windows: `SET SLS_DEBUG=*`

Interactive debugging is also possible for your project if you have installed the node-inspector module and chrome browser. You can then run the following command line inside your project's root.

Initial installation:
`npm install -g node-inspector`

For each debug run:
`node-debug sls offline`

The system will start in wait status. This will also automatically start the chrome browser and wait for you to set breakpoints for inspection. Set the breakpoints as needed and, then, click the play button for the debugging to continue.

Depending on the breakpoint, you may need to call the URL path for your function in seperate browser window for your serverless function to be run and made available for debugging.

## Simulation quality

This plugin simulates the NodeJS runtime in Kubeless for many practical purposes, good enough for development - but is not a perfect simulator.
Specifically, Kubeless currently runs on Node v6.x and v8.x, whereas _Kubeless Offline_ runs on your own runtime where no memory limits are enforced.

The HTTP server in this plugin mimics (the NodeJS server)[https://github.com/kubeless/kubeless/blob/master/docker/runtime/nodejs/kubeless.js] in the Kubeless runtime as closely as possible. If you find any discrepancies, please file an issue.

## Inspiration/Prior Art

This plugin is heavily inspired by (especially this README): [Serverless Offline Plugin](https://github.com/dherault/serverless-offline). A big thank you to all the contributors there!

It is also mutually incompatible with the Serverless Offline Plugin since they both define and emit the same events in order to be compatible with `serverless-webpack`. You cannot add both this plugin and the standard `Serverless Offline Plugin` which simulates AWS Lambda/API Gateway to the same Serverless service.

The vast majority of the actual server code is taken from the (Kubeless' team's)[https://github.com/kubeless] NodeJS runtime server. Without them, this plugin wouldn't even make sense. Thanks for making it worth the time to build tools around your tools. ;)

## Contributing

Yes, thank you!
Please update the docs and tests and add your name to the package.json file.

## License

MIT
