'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _stringify = require('babel-runtime/core-js/json/stringify');

var _stringify2 = _interopRequireDefault(_stringify);

var _promise = require('babel-runtime/core-js/promise');

var _promise2 = _interopRequireDefault(_promise);

var _async = require('async');

var _async2 = _interopRequireDefault(_async);

var _moment = require('moment');

var _moment2 = _interopRequireDefault(_moment);

var _child_process = require('child_process');

var _child_process2 = _interopRequireDefault(_child_process);

var _csvParser = require('csv-parser');

var _csvParser2 = _interopRequireDefault(_csvParser);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// import DataSourceBuilder from './builders/datasource-builder';
/**
  * Bulk Import Mixin
  * @Author Jonathan Casarrubias
  * @See <https://twitter.com/johncasarrubias>
  * @See <https://www.npmjs.com/package/loopback-import-mixin>
  * @See <https://github.com/jonathan-casarrubias/loopback-import-mixin>
  * @Description
  *
  * The following mixin will add bulk importing functionallity to models which includes
  * this module.
  *
  * Default Configuration
  *
  * "Import": {
  *   "models": {
  *     "ImportContainer": "Model",
  *     "ImportLog": "Model"
  *   }
  * }
  **/

exports.default = function (Model, ctx) {
  ctx.Model = Model;
  ctx.method = ctx.method || 'import';
  ctx.endpoint = ctx.endpoint || ['/', ctx.method].join('');
  // Create dynamic statistic method
  Model[ctx.method] = function StatMethod(req, finish) {
    // Set model names
    var ImportContainerName = ctx.models && ctx.models.ImportContainer || 'ImportContainer';
    var ImportLogName = ctx.models && ctx.models.ImportLog || 'ImportLog';
    var ImportContainer = Model.app.models[ImportContainerName];
    var ImportLog = Model.app.models[ImportLogName];
    var containerName = Model.definition.name + '-' + Math.round(Date.now()) + '-' + Math.round(Math.random() * 1000);
    if (!ImportContainer || !ImportLog) {
      return finish(new Error('(loopback-import-mixin) Missing required models, verify your setup and configuration'));
    }
    return new _promise2.default(function (resolve, reject) {
      _async2.default.waterfall([
      // Create container
      function (next) {
        return ImportContainer.createContainer({ name: containerName }, next);
      },
      // Upload File
      function (container, next) {
        req.params.container = containerName;
        ImportContainer.upload(req, {}, next);
      },
      // Persist process in db and run in fork process
      function (fileContainer, next) {
        if (fileContainer.files.file[0].type !== 'text/csv') {
          ImportContainer.destroyContainer(containerName);
          return next(new Error('The file you selected is not csv format'));
        }
        // Store the state of the import process in the database
        ImportLog.create({
          date: (0, _moment2.default)().toISOString(),
          model: Model.definition.name,
          status: 'PENDING'
        }, function (err, fileUpload) {
          return next(err, fileContainer, fileUpload);
        });
      }], function (err, fileContainer, fileUpload) {
        if (err) {
          if (typeof finish === 'function') finish(err, fileContainer);
          return reject(err);
        }
        // Launch a fork node process that will handle the import
        _child_process2.default.fork(__dirname + '/processes/import-process.js', [(0, _stringify2.default)({
          method: ctx.method,
          scope: Model.definition.name,
          fileUploadId: fileUpload.id,
          root: Model.app.datasources.container.settings.root,
          container: fileContainer.files.file[0].container,
          file: fileContainer.files.file[0].name,
          ImportContainer: ImportContainerName,
          ImportLog: ImportLogName,
          relations: ctx.relations
        })]);
        if (typeof finish === 'function') finish(null, fileContainer);
        resolve(fileContainer);
      });
    });
  };
  /**
   * Create import method (Not Available through REST)
   **/
  Model['import' + ctx.method] = function ImportMethod(container, file, options, finish) {
    var filePath = __dirname + '/../../../' + options.root + '/' + options.container + '/' + options.file;
    var ImportContainer = Model.app.models[options.ImportContainer];
    var ImportLog = Model.app.models[options.ImportLog];
    _async2.default.waterfall([
    // Get ImportLog
    function (next) {
      return ImportLog.findById(options.fileUploadId, next);
    },
    // Set importUpload status as processing
    function (importLog, next) {
      ctx.importLog = importLog;
      ctx.importLog.status = 'PROCESSING';
      ctx.importLog.save(next);
    },
    // Import Data
    function (importLog, next) {
      // This line opens the file as a readable stream
      var series = [];
      var i = 1; // Starts in one to discount column names
      _fs2.default.createReadStream(filePath).pipe((0, _csvParser2.default)()).on('data', function (row) {
        i++;
        (function (i) {
          var obj = { importId: options.file + ':' + i };
          for (var key in ctx.map) {
            var isObj = (0, _typeof3.default)(ctx.map[key]) === 'object';
            var columnKey = isObj ? ctx.map[key].map : ctx.map[key];
            if (row[columnKey]) {
              obj[key] = row[columnKey];
              if (isObj) {
                switch (ctx.map[key].type) {
                  case 'date':
                    obj[key] = (0, _moment2.default)(obj[key], 'MM-DD-YYYY').toISOString();
                    break;
                  default:
                    obj[key] = obj[key];
                }
              }
            }
          }
          var query = {};
          if (ctx.pk && obj[ctx.pk]) query[ctx.pk] = obj[ctx.pk];
          // Lets set each row a flow
          series.push(function (nextSerie) {
            _async2.default.waterfall([
            // See in DB for existing persisted instance
            function (nextFall) {
              if (!ctx.pk) return nextFall(null, null);
              Model.findOne({ where: query }, nextFall);
            },
            // If we get an instance we just set a warning into the log
            function (instance, nextFall) {
              if (instance) {
                ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                for (var _key in obj) {
                  if (obj.hasOwnProperty(_key)) instance[_key] = obj[_key];
                }
                instance.save(nextFall);
              } else {
                nextFall(null, null);
              }
            },
            // Otherwise we create a new instance
            function (instance, nextFall) {
              if (instance) return nextFall(null, instance);
              Model.create(obj, nextFall);
            },
            // Work on relations
            function (instance, nextFall) {
              // Finall parallel process container
              var parallel = [];
              var setupRelation = void 0;
              var ensureRelation = void 0;
              var linkRelation = void 0;
              var createRelation = void 0;
              // Iterates through existing relations in model
              setupRelation = function sr(expectedRelation) {
                for (var existingRelation in Model.definition.settings.relations) {
                  if (Model.definition.settings.relations.hasOwnProperty(existingRelation)) {
                    ensureRelation(expectedRelation, existingRelation);
                  }
                }
              };
              // Makes sure the relation exist
              ensureRelation = function er(expectedRelation, existingRelation) {
                if (expectedRelation === existingRelation) {
                  parallel.push(function (nextParallel) {
                    switch (ctx.relations[expectedRelation].type) {
                      case 'link':
                        linkRelation(expectedRelation, existingRelation, nextParallel);
                        break;
                      case 'create':
                        createRelation(expectedRelation, existingRelation, nextParallel);
                        break;
                      default:
                        throw new Error('Type of relation needs to be defined');
                    }
                  });
                }
              };
              // Create Relation
              createRelation = function cr(expectedRelation, existingRelation, nextParallel) {
                var createObj = {};
                for (var _key2 in ctx.relations[expectedRelation].map) {
                  if (typeof ctx.relations[expectedRelation].map[_key2] === 'string' && row[ctx.relations[expectedRelation].map[_key2]]) {
                    createObj[_key2] = row[ctx.relations[expectedRelation].map[_key2]];
                  } else if ((0, _typeof3.default)(ctx.relations[expectedRelation].map[_key2]) === 'object') {
                    switch (ctx.relations[expectedRelation].map[_key2].type) {
                      case 'date':
                        createObj[_key2] = (0, _moment2.default)(row[ctx.relations[expectedRelation].map[_key2].map], 'MM-DD-YYYY').toISOString();
                        break;
                      default:
                        createObj[_key2] = row[ctx.relations[expectedRelation].map[_key2]];
                    }
                  }
                }
                createObj.importId = options.file + ':' + i;
                var pk = ctx.relations[expectedRelation].pk;
                var where = {};
                where[pk] = createObj[pk];
                instance[expectedRelation]({ where: where }, function (err, result) {
                  if (result && Array.isArray(result) && result.length > 0) {
                    (function () {
                      var relatedInstance = result.pop();
                      (0, _keys2.default)(createObj).forEach(function (objKey) {
                        relatedInstance[objKey] = createObj[objKey];
                      });
                      relatedInstance.save(nextParallel);
                    })();
                  } else {
                    instance[expectedRelation].create(createObj, nextParallel);
                  }
                });
              };
              // Link Relations
              linkRelation = function lr(expectedRelation, existingRelation, nextParallel) {
                var relQry = { where: {} };
                for (var property in ctx.relations[expectedRelation].where) {
                  if (ctx.relations[expectedRelation].where.hasOwnProperty(property)) {
                    relQry.where[property] = row[ctx.relations[expectedRelation].where[property]];
                  }
                }
                Model.app.models[Model.definition.settings.relations[existingRelation].model].findOne(relQry, function (relErr, relInstance) {
                  if (relErr) return nextParallel(relErr);
                  if (!relInstance) {
                    ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                    ctx.importLog.warnings.push({
                      row: row,
                      message: Model.definition.name + '.' + expectedRelation + ' tried to relate unexisting instance of ' + expectedRelation
                    });
                    return nextParallel();
                  }
                  switch (Model.definition.settings.relations[existingRelation].type) {
                    case 'hasMany':
                      /** Does not work, it needs to moved to other point in the flow
                       instance[expectedRelation].findById(relInstance.id, (relErr2, exist) => {
                         if (exist) {
                           ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                           ctx.importLog.warnings.push({
                             row: row,
                             message: Model.definition.name + '.' + expectedRelation + ' tried to create existing relation.',
                           });
                           return nextParallel();
                         }
                         instance[expectedRelation].create(relInstance, nextParallel);
                       });
                       **/
                      nextParallel();
                      break;
                    case 'hasManyThrough':
                    case 'hasAndBelongsToMany':
                      instance[expectedRelation].findById(relInstance.id, function (relErr2, exist) {
                        if (exist) {
                          ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                          ctx.importLog.warnings.push({
                            row: row,
                            message: Model.definition.name + '.' + expectedRelation + ' tried to relate existing relation.'
                          });
                          return nextParallel();
                        }
                        instance[expectedRelation].add(relInstance, nextParallel);
                      });
                      break;
                    case 'belongsTo':
                      // instance[expectedRelation](relInstance, nextParallel);
                      // For some reason does not work, no errors but no relationship is created
                      // Ugly fix needed to be implemented
                      var autoId = Model.definition.settings.relations[existingRelation].model;
                      autoId = autoId.charAt(0).toLowerCase() + autoId.slice(1) + 'Id';
                      instance[Model.definition.settings.relations[existingRelation].foreignKey || autoId] = relInstance.id;
                      instance.save(nextParallel);
                      break;
                    default:
                      nextParallel();
                  }
                });
              };
              // Work on defined relationships
              for (var ers in options.relations) {
                if (options.relations.hasOwnProperty(ers)) {
                  setupRelation(ers);
                }
              }
              // Run the relations process in parallel
              _async2.default.parallel(parallel, nextFall);
            }],
            // If there are any error in this serie we log it into the errors array of objects
            function (err) {
              if (err) {
                // TODO Verify why can not set errors into the log
                if (Array.isArray(ctx.importLog.errors)) {
                  ctx.importLog.errors.push({ row: row, message: err });
                } else {
                  console.error('IMPORT ERROR: ', { row: row, message: err });
                }
              }
              nextSerie();
            });
          });
        })(i);
      }).on('end', function () {
        _async2.default.series(series, function (err) {
          series = null;
          next(err);
        });
      });
    },
    // Remove Container
    function (next) {
      console.log('Trying to destroy container: %s', options.container);
      ImportContainer.destroyContainer(options.container, next);
    },
    // Set status as finished
    function (next) {
      ctx.importLog.status = 'FINISHED';
      ctx.importLog.save(next);
    }], function (err) {
      if (err) {
        console.log('Trying to destroy container: %s', options.container);
        ImportContainer.destroyContainer(options.container, next);
        throw new Error('DB-TIMEOUT');
        //ctx.importLog.save();
      } else {}
      // TODO, Add more valuable data to pass, maybe a better way to pass errors
      Model.app.emit(ctx.method + ':done', {});
      finish(err);
    });
  };
  /**
   * Register Import Method
   */
  Model.remoteMethod(ctx.method, {
    http: { path: ctx.endpoint, verb: 'post' },
    accepts: [{
      arg: 'req',
      type: 'object',
      http: { source: 'req' }
    }],
    returns: { type: 'object', root: true },
    description: ctx.description
  });
}; /**
    * Stats Mixin Dependencies
    */


module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,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WUFBVixDQUFOOztBQUhPLE9BQVQsTUFLTyxFQUxQOztBQURRLFdBUVIsQ0FBTSxHQUFOLENBQVUsSUFBVixDQUFlLElBQUksTUFBSixHQUFhLE9BQWIsRUFBc0IsRUFBckMsRUFSUTtBQVNSLGFBQU8sR0FBUCxFQVRRO0tBQVAsQ0FoUEgsQ0FKcUY7R0FBeEQ7Ozs7QUEvREYsT0FrVTdCLENBQU0sWUFBTixDQUFtQixJQUFJLE1BQUosRUFBWTtBQUM3QixVQUFNLEVBQUUsTUFBTSxJQUFJLFFBQUosRUFBYyxNQUFNLE1BQU4sRUFBNUI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSxJQUFJLFdBQUo7R0FSZixFQWxVNkI7Q0FBaEIiLCJmaWxlIjoiaW1wb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdGF0cyBNaXhpbiBEZXBlbmRlbmNpZXNcbiAqL1xuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCBjaGlsZFByb2Nlc3MgZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgY3N2IGZyb20gJ2Nzdi1wYXJzZXInO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydExvZ1wiOiBcIk1vZGVsXCJcbiAgKiAgIH1cbiAgKiB9XG4gICoqL1xuXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICBjdHguTW9kZWwgPSBNb2RlbDtcbiAgY3R4Lm1ldGhvZCA9IGN0eC5tZXRob2QgfHwgJ2ltcG9ydCc7XG4gIGN0eC5lbmRwb2ludCA9IGN0eC5lbmRwb2ludCB8fCBbJy8nLCBjdHgubWV0aG9kXS5qb2luKCcnKTtcbiAgLy8gQ3JlYXRlIGR5bmFtaWMgc3RhdGlzdGljIG1ldGhvZFxuICBNb2RlbFtjdHgubWV0aG9kXSA9IGZ1bmN0aW9uIFN0YXRNZXRob2QocmVxLCBmaW5pc2gpIHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydExvZ05hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydExvZykgfHwgJ0ltcG9ydExvZyc7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRDb250YWluZXJOYW1lXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydExvZ05hbWVdO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydExvZykge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0TG9nLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBtZXRob2Q6IGN0eC5tZXRob2QsXG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRMb2c6IEltcG9ydExvZ05hbWUsXG4gICAgICAgICAgICByZWxhdGlvbnM6IGN0eC5yZWxhdGlvbnNcbiAgICAgICAgICB9KV0pO1xuICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKG51bGwsIGZpbGVDb250YWluZXIpO1xuICAgICAgICByZXNvbHZlKGZpbGVDb250YWluZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBDcmVhdGUgaW1wb3J0IG1ldGhvZCAoTm90IEF2YWlsYWJsZSB0aHJvdWdoIFJFU1QpXG4gICAqKi9cbiAgTW9kZWxbJ2ltcG9ydCcgKyBjdHgubWV0aG9kXSA9IGZ1bmN0aW9uIEltcG9ydE1ldGhvZChjb250YWluZXIsIGZpbGUsIG9wdGlvbnMsIGZpbmlzaCkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gX19kaXJuYW1lICsgJy8uLi8uLi8uLi8nICsgb3B0aW9ucy5yb290ICsgJy8nICsgb3B0aW9ucy5jb250YWluZXIgKyAnLycgKyBvcHRpb25zLmZpbGU7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydENvbnRhaW5lcl07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydExvZ107XG4gICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgIC8vIEdldCBJbXBvcnRMb2dcbiAgICAgIG5leHQgPT4gSW1wb3J0TG9nLmZpbmRCeUlkKG9wdGlvbnMuZmlsZVVwbG9hZElkLCBuZXh0KSxcbiAgICAgIC8vIFNldCBpbXBvcnRVcGxvYWQgc3RhdHVzIGFzIHByb2Nlc3NpbmdcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZyA9IGltcG9ydExvZztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnUFJPQ0VTU0lORyc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgICAvLyBJbXBvcnQgRGF0YVxuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICAvLyBUaGlzIGxpbmUgb3BlbnMgdGhlIGZpbGUgYXMgYSByZWFkYWJsZSBzdHJlYW1cbiAgICAgICAgbGV0IHNlcmllcyA9IFtdO1xuICAgICAgICBsZXQgaSA9IDE7IC8vIFN0YXJ0cyBpbiBvbmUgdG8gZGlzY291bnQgY29sdW1uIG5hbWVzXG4gICAgICAgIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpXG4gICAgICAgICAgLnBpcGUoY3N2KCkpXG4gICAgICAgICAgLm9uKCdkYXRhJywgcm93ID0+IHtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIChmdW5jdGlvbiAoaSkge1xuICAgICAgICAgICAgICBjb25zdCBvYmogPSB7IGltcG9ydElkOiBvcHRpb25zLmZpbGUgKyAnOicgKyBpIH07XG4gICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGN0eC5tYXApIHtcbiAgICAgICAgICAgICAgICBsZXQgaXNPYmogPSAodHlwZW9mIGN0eC5tYXBba2V5XSA9PT0gJ29iamVjdCcpO1xuICAgICAgICAgICAgICAgIGxldCBjb2x1bW5LZXkgPSBpc09iaiA/IGN0eC5tYXBba2V5XS5tYXAgOiBjdHgubWFwW2tleV07XG4gICAgICAgICAgICAgICAgaWYgKHJvd1tjb2x1bW5LZXldKSB7XG4gICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IHJvd1tjb2x1bW5LZXldO1xuICAgICAgICAgICAgICAgICAgaWYgKGlzT2JqKSB7XG4gICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4Lm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gbW9tZW50KG9ialtrZXldLCAnTU0tREQtWVlZWScpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgb2JqW2tleV0gPSBvYmpba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgICBpZiAoY3R4LnBrICYmIG9ialtjdHgucGtdKSBxdWVyeVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAgIC8vIExldHMgc2V0IGVhY2ggcm93IGEgZmxvd1xuICAgICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgICAvLyBTZWUgaW4gREIgZm9yIGV4aXN0aW5nIHBlcnNpc3RlZCBpbnN0YW5jZVxuICAgICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWN0eC5waykgcmV0dXJuIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgICBNb2RlbC5maW5kT25lKHsgd2hlcmU6IHF1ZXJ5IH0sIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBJZiB3ZSBnZXQgYW4gaW5zdGFuY2Ugd2UganVzdCBzZXQgYSB3YXJuaW5nIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IF9rZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KF9rZXkpKSBpbnN0YW5jZVtfa2V5XSA9IG9ialtfa2V5XTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBPdGhlcndpc2Ugd2UgY3JlYXRlIGEgbmV3IGluc3RhbmNlXG4gICAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkgcmV0dXJuIG5leHRGYWxsKG51bGwsIGluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICAgICAgTW9kZWwuY3JlYXRlKG9iaiwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gcmVsYXRpb25zXG4gICAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8vIEZpbmFsbCBwYXJhbGxlbCBwcm9jZXNzIGNvbnRhaW5lclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJhbGxlbCA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBsZXQgc2V0dXBSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGVuc3VyZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICBsZXQgbGlua1JlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICBsZXQgY3JlYXRlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIC8vIEl0ZXJhdGVzIHRocm91Z2ggZXhpc3RpbmcgcmVsYXRpb25zIGluIG1vZGVsXG4gICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24gPSBmdW5jdGlvbiBzcihleHBlY3RlZFJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JlbGF0aW9uIGluIE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXhpc3RpbmdSZWxhdGlvbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24oZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAvLyBNYWtlcyBzdXJlIHRoZSByZWxhdGlvbiBleGlzdFxuICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbiA9IGZ1bmN0aW9uIGVyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhwZWN0ZWRSZWxhdGlvbiA9PT0gZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGFyYWxsZWwucHVzaChuZXh0UGFyYWxsZWwgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2xpbmsnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb2YgcmVsYXRpb24gbmVlZHMgdG8gYmUgZGVmaW5lZCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBSZWxhdGlvblxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbiA9IGZ1bmN0aW9uIGNyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNyZWF0ZU9iaiA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdzdHJpbmcnICYmIHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IG1vbWVudChyb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS5tYXBdLCAnTU0tREQtWVlZWScpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqLmltcG9ydElkID0gb3B0aW9ucy5maWxlICsgJzonICsgaTtcbiAgICAgICAgICAgICAgICAgICAgICBsZXQgcGsgPSBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnBrO1xuICAgICAgICAgICAgICAgICAgICAgIGxldCB3aGVyZSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgIHdoZXJlW3BrXSA9IGNyZWF0ZU9ialtwa107XG4gICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0oeyAgd2hlcmU6IHdoZXJlIH0sIGZ1bmN0aW9uKGVyciwgcmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0ICYmIEFycmF5LmlzQXJyYXkocmVzdWx0KSAmJiByZXN1bHQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVsYXRlZEluc3RhbmNlID0gcmVzdWx0LnBvcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhjcmVhdGVPYmopLmZvckVhY2goZnVuY3Rpb24gKG9iaktleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbGF0ZWRJbnN0YW5jZVtvYmpLZXldID0gY3JlYXRlT2JqW29iaktleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZWxhdGVkSW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gTGluayBSZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsUXJ5ID0geyB3aGVyZToge30gfTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHByb3BlcnR5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZWxRcnkud2hlcmVbcHJvcGVydHldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmVbcHJvcGVydHldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgTW9kZWwuYXBwLm1vZGVsc1tNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbF0uZmluZE9uZShyZWxRcnksIChyZWxFcnIsIHJlbEluc3RhbmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVsRXJyKSByZXR1cm4gbmV4dFBhcmFsbGVsKHJlbEVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSB1bmV4aXN0aW5nIGluc3RhbmNlIG9mICcgKyBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8qKiBEb2VzIG5vdCB3b3JrLCBpdCBuZWVkcyB0byBtb3ZlZCB0byBvdGhlciBwb2ludCBpbiB0aGUgZmxvd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byBjcmVhdGUgZXhpc3RpbmcgcmVsYXRpb24uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqKi9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzTWFueVRocm91Z2gnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNBbmRCZWxvbmdzVG9NYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2JlbG9uZ3NUbyc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0ocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHNvbWUgcmVhc29uIGRvZXMgbm90IHdvcmssIG5vIGVycm9ycyBidXQgbm8gcmVsYXRpb25zaGlwIGlzIGNyZWF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVZ2x5IGZpeCBuZWVkZWQgdG8gYmUgaW1wbGVtZW50ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgYXV0b0lkID0gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXV0b0lkID0gYXV0b0lkLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgYXV0b0lkLnNsaWNlKDEpICsgJ0lkJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5mb3JlaWduS2V5IHx8IGF1dG9JZF0gPSByZWxJbnN0YW5jZS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIG9wdGlvbnMucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMucmVsYXRpb25zLmhhc093blByb3BlcnR5KGVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICBhc3luYy5wYXJhbGxlbChwYXJhbGxlbCwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgICBdLCBlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycy5wdXNoKHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJTVBPUlQgRVJST1I6ICcsIHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV4dFNlcmllKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkoaSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGFzeW5jLnNlcmllcyhzZXJpZXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgc2VyaWVzID0gbnVsbDtcbiAgICAgICAgICAgICAgbmV4dChlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgLy8gUmVtb3ZlIENvbnRhaW5lclxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgIH0sXG4gICAgICAvLyBTZXQgc3RhdHVzIGFzIGZpbmlzaGVkXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnRklOSVNIRUQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgIF0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEQi1USU1FT1VUJyk7XG4gICAgICAgIC8vY3R4LmltcG9ydExvZy5zYXZlKCk7XG4gICAgICB9IGVsc2UgeyB9XG4gICAgICAvLyBUT0RPLCBBZGQgbW9yZSB2YWx1YWJsZSBkYXRhIHRvIHBhc3MsIG1heWJlIGEgYmV0dGVyIHdheSB0byBwYXNzIGVycm9yc1xuICAgICAgTW9kZWwuYXBwLmVtaXQoY3R4Lm1ldGhvZCArICc6ZG9uZScsIHt9KTtcbiAgICAgIGZpbmlzaChlcnIpO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogUmVnaXN0ZXIgSW1wb3J0IE1ldGhvZFxuICAgKi9cbiAgTW9kZWwucmVtb3RlTWV0aG9kKGN0eC5tZXRob2QsIHtcbiAgICBodHRwOiB7IHBhdGg6IGN0eC5lbmRwb2ludCwgdmVyYjogJ3Bvc3QnIH0sXG4gICAgYWNjZXB0czogW3tcbiAgICAgIGFyZzogJ3JlcScsXG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIGh0dHA6IHsgc291cmNlOiAncmVxJyB9LFxuICAgIH1dLFxuICAgIHJldHVybnM6IHsgdHlwZTogJ29iamVjdCcsIHJvb3Q6IHRydWUgfSxcbiAgICBkZXNjcmlwdGlvbjogY3R4LmRlc2NyaXB0aW9uLFxuICB9KTtcbn07XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=
