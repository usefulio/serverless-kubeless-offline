'use strict';

const path = require('path');

const defaults = require('lodash/defaults');
const map = require('lodash/map');
const get = require('lodash/get');
const compact = require('lodash/compact');
const flatten = require('lodash/flatten');

const kubeless = require('./kubeless');

class KubelessOfflinePlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.service = serverless.service;
    this.log = serverless.cli.log.bind(serverless.cli);
    this.options = options;
    this.exitCode = 0;

    this.commands = {
      offline: {
        usage: 'Simulates Kubeless NodeJS runtimes to run call your functions offline.',
        lifecycleEvents: [
          'start',
        ],
        // add start nested options
        commands: {
          start: {
            usage: 'Simulates Kubeless NodeJS to call your Kubeless functions offline using backward compatible initialization.',
            lifecycleEvents: [
              'init',
              'end',
            ],
          },
        },
        options: {
          port: {
            usage:
              'Choose a port to run the offline server on, default 3000 '
              + '(e.g. "--port 3000" or "-p 3000")',
            required: false,
            shortcut: 'p',
          },
        },
      },
    };

    this.hooks = {
      'offline:start:init': this.start.bind(this),
      'offline:start': this.start.bind(this),
      'offline:start:end': this.stop.bind(this),
    };

    this._convertRouteDefinitions.bind(this);
    this._listenForSigInt.bind(this);
    this._buildServer.bind(this);
  }

  /**
   * Converts the serverless.yml function spec into one
   * more easily consumed by Kubeless. The returned array
   * contains objects in the form:
   * ```
   * {
   *  "file": "handlers",
   *  "function": "login",
   *  "route": "login",
   *  "timeout": 300
   * }
   * ```
   * @return {Array<Object>} a set of function+route paths to be consumed by Kubeless
   */
  _convertRouteDefinitions() {
    const functions = get(this.serverless, 'service.functions');

    const routes = compact(flatten(
      map(functions, (spec, name) => {
        const functionEnvironment = Object.assign({}, process.env, this.service.provider.environment, this.service.functions[name].environment);
        if (spec.events) {
          return map(spec.events, event => {
            const route = get(event, "http.path");
            if (route) {
              return {
                file: spec.handler.split('.')[0],
                function: spec.handler.split('.')[1],
                route,
                timeout: spec.timeout,
                env: functionEnvironment,
              };
            }
          })
        }
      })
    ));
    return routes;
  }

  start() {
    return Promise.resolve(this._buildServer())
      .then(() => this._listenForSigInt())
      .then(() => this.stop());
  }

  _listenForSigInt() {
    // Listen for ctrl+c to stop the server
    return new Promise(resolve => {
      process.on('SIGINT', () => {
        this.log('Kubeless offline halting...');
        this.log('Please close all open connections to this server.');
        resolve();
      });
    });
  }

  _buildServer() {
    const routes = this._convertRouteDefinitions();
    const customPath = get(this.serverless, 'service.custom.serverless-offline.location')
    const servicePath = path.join(this.serverless.config.servicePath, customPath);

    const serverConfig = defaults({
      routes,
      FUNC_PORT: this.options.p,
    }, {
      BASE_PATH: servicePath,
      FUNC_RUNTIME: "nodejs8",
      FUNC_MEMORY_LIMIT: 1024,
      FUNC_PORT: 3000,
      logger: {
        log: this.log,
        error: this.log,
        info: this.log,
        warn: this.log,
      },
    })
    
    this.log(`Starting kubeless offline server on port ${serverConfig.FUNC_PORT}`);
    this.log("Loading handlers from:");
    this.log(serverConfig.BASE_PATH);
    this.log("Routes:");
    this.log(JSON.stringify(serverConfig.routes, null, 2));

    // Some users would like to know their environment outside of the handler
    process.env.IS_OFFLINE = true;

    // start the server
    this.server = kubeless(serverConfig);
  }

  stop() {
    this.log('Halting kubeless offline server');
    this.log('Please close all open connections to this server.');
    this.server.close(() => {
      this.log('Kubeless offline server halted.');
      this.server = null;
      process.exit(this.exitCode);
    });
  }
}

module.exports = KubelessOfflinePlugin;
