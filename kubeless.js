'use strict';
/**
 * This is an almost exact copy of the `kubeless.js` from
 * https://github.com/kubeless/kubeless/blob/master/docker/runtime/nodejs/kubeless.js
 * and should remain in sync.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const Module = require('module');

const bodyParser = require('body-parser');
const client = require('prom-client');
const express = require('express');
const helper = require('./lib/helper');
const morgan = require('morgan');
const https = require('https');

module.exports = function kubeless(options){
  const { 
    routes,
    BASE_PATH,
    FUNC_RUNTIME, 
    FUNC_MEMORY_LIMIT, 
    FUNC_TIMEOUT,
    FUNC_PORT,
    FUNC_SSL,
    logger
  } = options;

  const originalEnvironment = Object.assign({}, process.env);

  const app = express();
  app.use(morgan('combined'));
  
  const bodySizeLimit = Number(process.env.REQ_MB_LIMIT || '1');

  const bodParserOptions = {
    type: req => !req.is('multipart/*'),
    limit: `${bodySizeLimit}mb`,
  };

  app.use(bodyParser.raw(bodParserOptions));
  app.use(bodyParser.json({ limit: `${bodySizeLimit}mb` }));
  app.use(bodyParser.urlencoded({ limit: `${bodySizeLimit}mb`, extended: true }));

  const timeout = Number(FUNC_TIMEOUT || '180');
  const funcPort = Number(FUNC_PORT || '3000');

  const modRootPath = BASE_PATH;

  const { timeHistogram, callsCounter, errorsCounter } = helper.prepareStatistics('method', client);
  helper.routeLivenessProbe(app);
  helper.routeMetrics(app, client);

  function restoreEnvironment () {
    // XXX should this set directly process.env?
    Object.assign(process.env, originalEnvironment);
  }

  function modRequire(p, req, res, end, libDeps, funcHandler, context) {
    if (p === 'kubeless')
      return (handler) => modExecute(handler, req, res, end, funcHandler);
    else if (libDeps.includes(p))
      return require(path.join(libPath, p));
    else if (p.indexOf('./') === 0)
      return require(path.join(path.dirname(modPath), p));
    else
      return require(p);
  }

  function modExecute(handler, req, res, end, funcHandler, context) {
    let func = null;
    switch (typeof handler) {
      case 'function':
        func = handler;
        break;
      case 'object':
        if (handler) func = handler[funcHandler];
        break;
    }
    if (func === null)
      throw new Error(`Unable to load ${handler}`);

    try {
      let data = req.body;
      if (!req.is('multipart/*') && req.body.length > 0) {
        if (req.get('content-type') === 'application/json') {
          data = JSON.parse(req.body.toString('utf-8'))
        } else {
          data = req.body.toString('utf-8')
        }
      }
      const event = {
        'event-type': req.get('event-type'),
        'event-id': req.get('event-id'),
        'event-time': req.get('event-time'),
        'event-namespace': req.get('event-namespace'),
        data,
        'extensions': { request: req, response: res },
      };
      Promise.resolve(func(event, context))
        // Finalize
        .then(rval => modFinalize(rval, res, end))
        // Catch asynchronous errors
        .catch(err => handleError(err, res, funcLabel(req), end))
        ;
    } catch (err) {
      // Catch synchronous errors
      handleError(err, res, funcLabel(req), end);
    }
  }

  function modFinalize(result, res, end) {
    switch (typeof result) {
      case 'string':
        res.end(result);
        break;
      case 'object':
        res.json(result);
        break;
      default:
        res.end(JSON.stringify(result));
    }
    end();
    restoreEnvironment();
  }

  function handleError(err, res, label, end) {
    errorsCounter.labels(label).inc();
    res.status(500).send('Internal Server Error');
    logger.error(`Function failed to execute: ${err.stack}`);
    end();
    restoreEnvironment();
  }

  function funcLabel(req, modName) {
    return modName + '-' + req.method;
  }

  function routeToFunctionSpec(route){
    return routes.find(spec => spec.route === route);
  }

  // remove cached versions of the module
  function clearRequireCache(module) {
    delete require.cache[require.resolve(module)]
    return require(module)
  }

  app.all('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      // CORS preflight support (Allow any method or header requested)
      res.header('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
      res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
      res.end();
    } else {
      // try finding function without leading `/`, and then retry with the leading `/`
      const targetRoute = routeToFunctionSpec(req.path.substr(1)) || routeToFunctionSpec(req.path);

      // request for a route we don't support, e.g. favicon.ico
      if (!targetRoute) {
        return res.status(404).end();
      }

      // set the env for the function
      Object.assign(process.env, targetRoute.env);

      const modName = targetRoute.file;
      const funcHandler = targetRoute.function;
      const modPath = path.join(modRootPath, `${modName}.js`);
      const libPath = path.join(modRootPath, 'node_modules');
      const pkgPath = path.join(modRootPath, 'package.json');
      const libDeps = helper.readDependencies(pkgPath);

      const context = {
        'function-name': funcHandler,
        'timeout': targetRoute.timeout,
        'runtime': FUNC_RUNTIME,
        'memory-limit': FUNC_MEMORY_LIMIT
      };

      const label = funcLabel(req);
      const end = timeHistogram.labels(label).startTimer();
      callsCounter.labels(label).inc();

      const sandbox = Object.assign({}, global, {
        __filename: modPath,
        __dirname: modRootPath,
        console: logger,
        module: new Module(modPath, null),
        require: (p) => modRequire(p, req, res, end, libDeps, funcHandler, context),
      });

      try {
        clearRequireCache(modPath);

        // run the handler
        const script = new vm.Script('\nrequire(\'kubeless\')(require(\'' + modPath + '\'));\n', {
          filename: modPath,
          displayErrors: true,
        });
        script.runInNewContext(sandbox, { timeout: timeout * 1000 });
      } catch (err) {
        if (err.toString().match('Error: Script execution timed out')) {
          res.status(408).send(err);
          // We cannot stop the spawned process (https://github.com/nodejs/node/issues/3020)
          // we need to abruptly stop this process
          logger.error('CRITICAL: Unable to stop spawned process. Exiting');
          process.exit(1);
        } else {
          handleError(err, res, funcLabel, end);
        }
      }
    }
  });

  /**
   * Returns an HTTP or HTTPS server instance
   * that we can use to shutdown
   * programmatically.
   */
  if (FUNC_SSL) {
    return https.createServer(FUNC_SSL, app).listen(funcPort);
  } else {
    return app.listen(funcPort);
  }
}

