'use strict';

var Squeeze = require('good-squeeze').Squeeze;
var Through = require('through2');
var bunyan = require('bunyan');
var Joi = require('joi');
var _ = require('lodash');

var availableLevels = Object.keys(bunyan.levelFromName).reverse();

var defaultFormatters = {
  ops: function (data) {
    return [{
      memory: Math.round(data.proc.mem.rss / (1024 * 1024)) + 'Mb',
      uptime: data.proc.uptime + 's',
      load: data.os.load.join(', ')
    }, '[ops]'];
  },
  response: function (data) {
    var query = data.query ? JSON.stringify(data.query) : '';
    var responsePayload = '';
    if (typeof data.responsePayload === 'object' && data.responsePayload) {
      responsePayload = 'response payload: ' + JSON.stringify(data.responsePayload);
    }

    return [{
      instance: data.instance,
      method: data.method,
      path: data.path,
      query: query,
      statusCode: data.statusCode,
      responseTime: data.responseTime + 'ms',
      responsePayload: responsePayload
    }, '[response]'];
  },
  error: function (data) {
    return [{
      err: data.error
    }, '[error]', data.error.message];
  },
  log: function (data) {
    return [data.data, '[log]'];
  },
  request: function (data) {
    return [data.data, '[request]'];
  }
};

var settingsSchema = Joi.object().keys({
  levels: Joi.object().keys({
    ops: Joi.string().valid(availableLevels).default('trace'),
    response: Joi.string().valid(availableLevels).default('trace'),
    error: Joi.string().valid(availableLevels).default('error'),
    log: Joi.string().valid(availableLevels).default('info'),
    request: Joi.string().valid(availableLevels).default('trace')
  }),
  formatters: Joi.object().keys({
    ops: Joi.func().default(defaultFormatters.ops),
    response: Joi.func().default(defaultFormatters.response),
    log: Joi.func().default(defaultFormatters.log),
    error: Joi.func().default(defaultFormatters.error),
    request: Joi.func().default(defaultFormatters.request)
  }),
  logger: Joi.object().type(bunyan).required()
});

var GoodBunyan = function GoodBunyan (events, config) {
  var self = this;
  this.logger = config.logger;

  if (!(this instanceof GoodBunyan)) {
    return new GoodBunyan(events, config);
  }

  config.levels = config.levels || {};
  config.formatters = config.formatters || {};

  Joi.validate(config, settingsSchema, function (err, value) {
    if (err) {
      throw err;
    }

    self.settings = value;
  });

  this._filter = new Squeeze(events);
};

GoodBunyan.prototype.init = function (stream, emitter, callback) {
  var self = this;

  if (!stream._readableState.objectMode) {
    return callback(new Error('stream must be in object mode'));
  }

  stream.pipe(this._filter).pipe(Through.obj(function goodBunyanTransform (data, enc, next) {
    var eventName = data.event;

    if (self.settings.levels[eventName]) {
      var level = self.settings.levels[eventName];
      if(!!data.tags) {
        var intersection = _.intersection(data.tags, availableLevels);
        level = intersection.length > 0 ? intersection[0] : level;
      }

      var formatted = self.settings.formatters[eventName](data);

      if (formatted instanceof Array) {
        self.logger[level].apply(self.logger, formatted);
        return next();
      }

      self.logger[level](formatted);
      return next();
    }

    self.logger.trace(data, '[' + eventName + '] (unknown event)');

    return next();
  })).pipe(process.stdout);

  callback();
};

module.exports = GoodBunyan;
