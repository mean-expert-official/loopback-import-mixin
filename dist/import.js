'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

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
  Model.importProcessor = function ImportMethod(container, file, options, finish) {
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
      var i = 0;
      _fs2.default.createReadStream(filePath).pipe((0, _csvParser2.default)()).on('data', function (row) {
        i++;
        var obj = {};
        for (var key in ctx.map) {
          if (row[ctx.map[key]]) {
            obj[key] = row[ctx.map[key]];
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
            obj.importId = options.file + ':' + i;
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
              instance[expectedRelation].create(createObj, nextParallel);
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
        ctx.importLog.status = 'DB-TIMEOUT';
        ctx.importLog.save();
      } else {}
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
//# sourceMappingURL=data:application/json;base64,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LE1BQUosRUFBWTtBQUM3QixVQUFNLEVBQUUsTUFBTSxJQUFJLFFBQUosRUFBYyxNQUFNLE1BQU4sRUFBNUI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSxJQUFJLFdBQUo7R0FSZixFQXBTNkI7Q0FBaEIiLCJmaWxlIjoiaW1wb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdGF0cyBNaXhpbiBEZXBlbmRlbmNpZXNcbiAqL1xuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCBjaGlsZFByb2Nlc3MgZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgY3N2IGZyb20gJ2Nzdi1wYXJzZXInO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydExvZ1wiOiBcIk1vZGVsXCJcbiAgKiAgIH1cbiAgKiB9XG4gICoqL1xuXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICBjdHguTW9kZWwgPSBNb2RlbDtcbiAgY3R4Lm1ldGhvZCA9IGN0eC5tZXRob2QgfHwgJ2ltcG9ydCc7XG4gIGN0eC5lbmRwb2ludCA9IGN0eC5lbmRwb2ludCB8fCBbJy8nLCBjdHgubWV0aG9kXS5qb2luKCcnKTtcbiAgLy8gQ3JlYXRlIGR5bmFtaWMgc3RhdGlzdGljIG1ldGhvZFxuICBNb2RlbFtjdHgubWV0aG9kXSA9IGZ1bmN0aW9uIFN0YXRNZXRob2QocmVxLCBmaW5pc2gpIHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydExvZ05hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydExvZykgfHwgJ0ltcG9ydExvZyc7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRDb250YWluZXJOYW1lXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydExvZ05hbWVdO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydExvZykge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0TG9nLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRMb2c6IEltcG9ydExvZ05hbWUsXG4gICAgICAgICAgICByZWxhdGlvbnM6IGN0eC5yZWxhdGlvbnNcbiAgICAgICAgICB9KV0pO1xuICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKG51bGwsIGZpbGVDb250YWluZXIpO1xuICAgICAgICByZXNvbHZlKGZpbGVDb250YWluZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBDcmVhdGUgaW1wb3J0IG1ldGhvZCAoTm90IEF2YWlsYWJsZSB0aHJvdWdoIFJFU1QpXG4gICAqKi9cbiAgTW9kZWwuaW1wb3J0UHJvY2Vzc29yID0gZnVuY3Rpb24gSW1wb3J0TWV0aG9kKGNvbnRhaW5lciwgZmlsZSwgb3B0aW9ucywgZmluaXNoKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBfX2Rpcm5hbWUgKyAnLy4uLy4uLy4uLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0TG9nXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IEltcG9ydExvZ1xuICAgICAgbmV4dCA9PiBJbXBvcnRMb2cuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nID0gaW1wb3J0TG9nO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBsZXQgc2VyaWVzID0gW107XG4gICAgICAgIGxldCBpID0gMDtcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgY29uc3Qgb2JqID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgIGlmIChyb3dbY3R4Lm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2N0eC5tYXBba2V5XV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgICAgICAgICBpZiAoY3R4LnBrICYmIG9ialtjdHgucGtdKSBxdWVyeVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAvLyBMZXRzIHNldCBlYWNoIHJvdyBhIGZsb3dcbiAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgLy8gU2VlIGluIERCIGZvciBleGlzdGluZyBwZXJzaXN0ZWQgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWN0eC5waykgcmV0dXJuIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuZmluZE9uZSh7IHdoZXJlOiBxdWVyeSB9LCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBJZiB3ZSBnZXQgYW4gaW5zdGFuY2Ugd2UganVzdCBzZXQgYSB3YXJuaW5nIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBfa2V5IGluIG9iaikge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoX2tleSkpIGluc3RhbmNlW19rZXldID0gb2JqW19rZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBPdGhlcndpc2Ugd2UgY3JlYXRlIGEgbmV3IGluc3RhbmNlXG4gICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgaW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgICAgb2JqLmltcG9ydElkID0gb3B0aW9ucy5maWxlICsgJzonK2k7XG4gICAgICAgICAgICAgICAgICBNb2RlbC5jcmVhdGUob2JqLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIHJlbGF0aW9uc1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIEZpbmFsbCBwYXJhbGxlbCBwcm9jZXNzIGNvbnRhaW5lclxuICAgICAgICAgICAgICAgICAgY29uc3QgcGFyYWxsZWwgPSBbXTtcbiAgICAgICAgICAgICAgICAgIGxldCBzZXR1cFJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGVuc3VyZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGxpbmtSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBjcmVhdGVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIC8vIEl0ZXJhdGVzIHRocm91Z2ggZXhpc3RpbmcgcmVsYXRpb25zIGluIG1vZGVsXG4gICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uID0gZnVuY3Rpb24gc3IoZXhwZWN0ZWRSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUmVsYXRpb24gaW4gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXhpc3RpbmdSZWxhdGlvbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIE1ha2VzIHN1cmUgdGhlIHJlbGF0aW9uIGV4aXN0XG4gICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbiA9IGZ1bmN0aW9uIGVyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkUmVsYXRpb24gPT09IGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBwYXJhbGxlbC5wdXNoKG5leHRQYXJhbGxlbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnbGluayc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVHlwZSBvZiByZWxhdGlvbiBuZWVkcyB0byBiZSBkZWZpbmVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgUmVsYXRpb25cbiAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uID0gZnVuY3Rpb24gY3IoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNyZWF0ZU9iaiA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcCkge1xuICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ3N0cmluZycgJiYgcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IG1vbWVudChyb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS5tYXBdLCAnTU0tREQtWVlZWScpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9iai5pbXBvcnRJZCA9IG9wdGlvbnMuZmlsZSArICc6JytpO1xuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUoY3JlYXRlT2JqLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIExpbmsgUmVsYXRpb25zXG4gICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24gPSBmdW5jdGlvbiBscihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uLCBuZXh0UGFyYWxsZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsUXJ5ID0geyB3aGVyZToge30gfTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUuaGFzT3duUHJvcGVydHkocHJvcGVydHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWxRcnkud2hlcmVbcHJvcGVydHldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmVbcHJvcGVydHldXTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgTW9kZWwuYXBwLm1vZGVsc1tNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbF0uZmluZE9uZShyZWxRcnksIChyZWxFcnIsIHJlbEluc3RhbmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbEVycikgcmV0dXJuIG5leHRQYXJhbGxlbChyZWxFcnIpO1xuICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVsSW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSB1bmV4aXN0aW5nIGluc3RhbmNlIG9mICcgKyBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgICAvKiogRG9lcyBub3Qgd29yaywgaXQgbmVlZHMgdG8gbW92ZWQgdG8gb3RoZXIgcG9pbnQgaW4gdGhlIGZsb3dcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmZpbmRCeUlkKHJlbEluc3RhbmNlLmlkLCAocmVsRXJyMiwgZXhpc3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gY3JlYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmNyZWF0ZShyZWxJbnN0YW5jZSwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgKiovXG4gICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnlUaHJvdWdoJzpcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNBbmRCZWxvbmdzVG9NYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmZpbmRCeUlkKHJlbEluc3RhbmNlLmlkLCAocmVsRXJyMiwgZXhpc3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmFkZChyZWxJbnN0YW5jZSwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnYmVsb25nc1RvJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHNvbWUgcmVhc29uIGRvZXMgbm90IHdvcmssIG5vIGVycm9ycyBidXQgbm8gcmVsYXRpb25zaGlwIGlzIGNyZWF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVnbHkgZml4IG5lZWRlZCB0byBiZSBpbXBsZW1lbnRlZFxuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGF1dG9JZCA9IE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXV0b0lkID0gYXV0b0lkLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgYXV0b0lkLnNsaWNlKDEpICsgJ0lkJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW01vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLmZvcmVpZ25LZXkgfHwgYXV0b0lkXSA9IHJlbEluc3RhbmNlLmlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gV29yayBvbiBkZWZpbmVkIHJlbGF0aW9uc2hpcHNcbiAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIG9wdGlvbnMucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChvcHRpb25zLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShlcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbihlcnMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAvLyBSdW4gdGhlIHJlbGF0aW9ucyBwcm9jZXNzIGluIHBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICBhc3luYy5wYXJhbGxlbChwYXJhbGxlbCwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGFueSBlcnJvciBpbiB0aGlzIHNlcmllIHdlIGxvZyBpdCBpbnRvIHRoZSBlcnJvcnMgYXJyYXkgb2Ygb2JqZWN0c1xuICAgICAgICAgICAgICBdLCBlcnIgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgIC8vIFRPRE8gVmVyaWZ5IHdoeSBjYW4gbm90IHNldCBlcnJvcnMgaW50byB0aGUgbG9nXG4gICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy5lcnJvcnMucHVzaCh7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJTVBPUlQgRVJST1I6ICcsIHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbmV4dFNlcmllKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGFzeW5jLnNlcmllcyhzZXJpZXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgc2VyaWVzID0gbnVsbDtcbiAgICAgICAgICAgICAgbmV4dChlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgLy8gUmVtb3ZlIENvbnRhaW5lclxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgIH0sXG4gICAgICAvLyBTZXQgc3RhdHVzIGFzIGZpbmlzaGVkXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnRklOSVNIRUQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgIF0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0RCLVRJTUVPVVQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUoKTtcbiAgICAgIH0gZWxzZSB7fVxuICAgICAgZmluaXNoKGVycik7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBSZWdpc3RlciBJbXBvcnQgTWV0aG9kXG4gICAqL1xuICBNb2RlbC5yZW1vdGVNZXRob2QoY3R4Lm1ldGhvZCwge1xuICAgIGh0dHA6IHsgcGF0aDogY3R4LmVuZHBvaW50LCB2ZXJiOiAncG9zdCcgfSxcbiAgICBhY2NlcHRzOiBbe1xuICAgICAgYXJnOiAncmVxJyxcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgaHR0cDogeyBzb3VyY2U6ICdyZXEnIH0sXG4gICAgfV0sXG4gICAgcmV0dXJuczogeyB0eXBlOiAnb2JqZWN0Jywgcm9vdDogdHJ1ZSB9LFxuICAgIGRlc2NyaXB0aW9uOiBjdHguZGVzY3JpcHRpb24sXG4gIH0pO1xufTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
