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
          ImportLog: ImportLogName
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
    // const ImportContainer = Model.app.models[options.ImportContainer];
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
      _fs2.default.createReadStream(filePath).pipe((0, _csvParser2.default)()).on('data', function (row) {
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
              ctx.importLog.warnings.push({
                row: row,
                message: Model.definition.name + '.' + ctx.pk + ' ' + obj[ctx.pk] + ' already exists, updating fields to new values.'
              });
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
            for (var ers in ctx.relations) {
              if (ctx.relations.hasOwnProperty(ers)) {
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
              ctx.importLog.errors = Array.isArray(ctx.importLog.errors) ? ctx.importLog.errors : [];
              ctx.importLog.errors.push({ row: row, message: err });
            }
            nextSerie();
          });
        });
      }).on('end', function () {
        _async2.default.series(series, next);
      });
    },
    // Remove Container
    // next => ImportContainer.destroyContainer({ container: options.container }, next),
    // Set status as finished
    function (next) {
      ctx.importLog.status = 'FINISHED';
      ctx.importLog.save(next);
    }], function (err) {
      if (err) throw new Error(err);
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
//# sourceMappingURL=data:application/json;base64,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YyxNQUFkLEdBQXVCLEVBQTdELENBRmhCO0FBR1Asa0JBQUksU0FBSixDQUFjLE1BQWQsQ0FBcUIsSUFBckIsQ0FBMEIsRUFBRSxLQUFLLEdBQUwsRUFBVSxTQUFTLEdBQVQsRUFBdEMsRUFITzthQUFUO0FBS0Esd0JBTlE7V0FBUCxDQWhKSCxDQUR1QjtTQUFiLENBQVosQ0FWaUI7T0FBUCxDQUZkLENBdUtHLEVBdktILENBdUtNLEtBdktOLEVBdUthLFlBQU07QUFDZix3QkFBTSxNQUFOLENBQWEsTUFBYixFQUFxQixJQUFyQixFQURlO09BQU4sQ0F2S2IsQ0FIbUI7S0FBckI7Ozs7QUFpTEEsb0JBQVE7QUFDTixVQUFJLFNBQUosQ0FBYyxNQUFkLEdBQXVCLFVBQXZCLENBRE07QUFFTixVQUFJLFNBQUosQ0FBYyxJQUFkLENBQW1CLElBQW5CLEVBRk07S0FBUixDQTNMRixFQStMRyxlQUFPO0FBQ1IsVUFBSSxHQUFKLEVBQVMsTUFBTSxJQUFJLEtBQUosQ0FBVSxHQUFWLENBQU4sQ0FBVDtBQUNBLGFBQU8sR0FBUCxFQUZRO0tBQVAsQ0EvTEgsQ0FKOEU7R0FBeEQ7Ozs7QUE3REssT0F3UTdCLENBQU0sWUFBTixDQUFtQixJQUFJLE1BQUosRUFBWTtBQUM3QixVQUFNLEVBQUUsTUFBTSxJQUFJLFFBQUosRUFBYyxNQUFNLE1BQU4sRUFBNUI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSxJQUFJLFdBQUo7R0FSZixFQXhRNkI7Q0FBaEIiLCJmaWxlIjoiaW1wb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdGF0cyBNaXhpbiBEZXBlbmRlbmNpZXNcbiAqL1xuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCBjaGlsZFByb2Nlc3MgZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgY3N2IGZyb20gJ2Nzdi1wYXJzZXInO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydExvZ1wiOiBcIk1vZGVsXCJcbiAgKiAgIH1cbiAgKiB9XG4gICoqL1xuXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICBjdHguTW9kZWwgPSBNb2RlbDtcbiAgY3R4Lm1ldGhvZCA9IGN0eC5tZXRob2QgfHwgJ2ltcG9ydCc7XG4gIGN0eC5lbmRwb2ludCA9IGN0eC5lbmRwb2ludCB8fCBbJy8nLCBjdHgubWV0aG9kXS5qb2luKCcnKTtcbiAgLy8gQ3JlYXRlIGR5bmFtaWMgc3RhdGlzdGljIG1ldGhvZFxuICBNb2RlbFtjdHgubWV0aG9kXSA9IGZ1bmN0aW9uIFN0YXRNZXRob2QocmVxLCBmaW5pc2gpIHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydExvZ05hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydExvZykgfHwgJ0ltcG9ydExvZyc7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRDb250YWluZXJOYW1lXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydExvZ05hbWVdO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydExvZykge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0TG9nLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRMb2c6IEltcG9ydExvZ05hbWUsXG4gICAgICAgICAgfSldKTtcbiAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChudWxsLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgcmVzb2x2ZShmaWxlQ29udGFpbmVyKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogQ3JlYXRlIGltcG9ydCBtZXRob2QgKE5vdCBBdmFpbGFibGUgdGhyb3VnaCBSRVNUKVxuICAgKiovXG4gIE1vZGVsLmltcG9ydFByb2Nlc3NvciA9IGZ1bmN0aW9uIEltcG9ydE1ldGhvZChjb250YWluZXIsIGZpbGUsIG9wdGlvbnMsIGZpbmlzaCkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gX19kaXJuYW1lICsgJy8uLi8uLi8uLi8nICsgb3B0aW9ucy5yb290ICsgJy8nICsgb3B0aW9ucy5jb250YWluZXIgKyAnLycgKyBvcHRpb25zLmZpbGU7XG4gICAgLy8gY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydENvbnRhaW5lcl07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydExvZ107XG4gICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgIC8vIEdldCBJbXBvcnRMb2dcbiAgICAgIG5leHQgPT4gSW1wb3J0TG9nLmZpbmRCeUlkKG9wdGlvbnMuZmlsZVVwbG9hZElkLCBuZXh0KSxcbiAgICAgIC8vIFNldCBpbXBvcnRVcGxvYWQgc3RhdHVzIGFzIHByb2Nlc3NpbmdcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZyA9IGltcG9ydExvZztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnUFJPQ0VTU0lORyc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgICAvLyBJbXBvcnQgRGF0YVxuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICAvLyBUaGlzIGxpbmUgb3BlbnMgdGhlIGZpbGUgYXMgYSByZWFkYWJsZSBzdHJlYW1cbiAgICAgICAgY29uc3Qgc2VyaWVzID0gW107XG4gICAgICAgIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpXG4gICAgICAgICAgLnBpcGUoY3N2KCkpXG4gICAgICAgICAgLm9uKCdkYXRhJywgcm93ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9iaiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICBpZiAocm93W2N0eC5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICBvYmpba2V5XSA9IHJvd1tjdHgubWFwW2tleV1dO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgaWYgKGN0eC5wayAmJiBvYmpbY3R4LnBrXSkgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKCFjdHgucGspIHJldHVybiBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgIE1vZGVsLmZpbmRPbmUoeyB3aGVyZTogcXVlcnkgfSwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgY3R4LnBrICsgJyAnICsgb2JqW2N0eC5wa10gKyAnIGFscmVhZHkgZXhpc3RzLCB1cGRhdGluZyBmaWVsZHMgdG8gbmV3IHZhbHVlcy4nLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBfa2V5IGluIG9iaikge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoX2tleSkpIGluc3RhbmNlW19rZXldID0gb2JqW19rZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBPdGhlcndpc2Ugd2UgY3JlYXRlIGEgbmV3IGluc3RhbmNlXG4gICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgaW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuY3JlYXRlKG9iaiwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICBsZXQgc2V0dXBSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBsaW5rUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICBsZXQgY3JlYXRlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAvLyBJdGVyYXRlcyB0aHJvdWdoIGV4aXN0aW5nIHJlbGF0aW9ucyBpbiBtb2RlbFxuICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbiA9IGZ1bmN0aW9uIHNyKGV4cGVjdGVkUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JlbGF0aW9uIGluIE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zLmhhc093blByb3BlcnR5KGV4aXN0aW5nUmVsYXRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBNYWtlcyBzdXJlIHRoZSByZWxhdGlvbiBleGlzdFxuICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24gPSBmdW5jdGlvbiBlcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZFJlbGF0aW9uID09PSBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgcGFyYWxsZWwucHVzaChuZXh0UGFyYWxsZWwgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2xpbmsnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb2YgcmVsYXRpb24gbmVlZHMgdG8gYmUgZGVmaW5lZCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIFJlbGF0aW9uXG4gICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbiA9IGZ1bmN0aW9uIGNyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVPYmogPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdzdHJpbmcnICYmIHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSBtb21lbnQocm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0ubWFwXSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUoY3JlYXRlT2JqLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIExpbmsgUmVsYXRpb25zXG4gICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24gPSBmdW5jdGlvbiBscihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uLCBuZXh0UGFyYWxsZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsUXJ5ID0geyB3aGVyZToge30gfTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUuaGFzT3duUHJvcGVydHkocHJvcGVydHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWxRcnkud2hlcmVbcHJvcGVydHldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmVbcHJvcGVydHldXTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgTW9kZWwuYXBwLm1vZGVsc1tNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbF0uZmluZE9uZShyZWxRcnksIChyZWxFcnIsIHJlbEluc3RhbmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbEVycikgcmV0dXJuIG5leHRQYXJhbGxlbChyZWxFcnIpO1xuICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVsSW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSB1bmV4aXN0aW5nIGluc3RhbmNlIG9mICcgKyBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnlUaHJvdWdoJzpcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNBbmRCZWxvbmdzVG9NYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmZpbmRCeUlkKHJlbEluc3RhbmNlLmlkLCAocmVsRXJyMiwgZXhpc3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmFkZChyZWxJbnN0YW5jZSwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnYmVsb25nc1RvJzpcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHNvbWUgcmVhc29uIGRvZXMgbm90IHdvcmssIG5vIGVycm9ycyBidXQgbm8gcmVsYXRpb25zaGlwIGlzIGNyZWF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVnbHkgZml4IG5lZWRlZCB0byBiZSBpbXBsZW1lbnRlZFxuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGF1dG9JZCA9IE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXV0b0lkID0gYXV0b0lkLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgYXV0b0lkLnNsaWNlKDEpICsgJ0lkJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW01vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLmZvcmVpZ25LZXkgfHwgYXV0b0lkXSA9IHJlbEluc3RhbmNlLmlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gV29yayBvbiBkZWZpbmVkIHJlbGF0aW9uc2hpcHNcbiAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIGN0eC5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGN0eC5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy5lcnJvcnMgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cuZXJyb3JzKSA/IGN0eC5pbXBvcnRMb2cuZXJyb3JzIDogW107XG4gICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycy5wdXNoKHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbmV4dFNlcmllKCk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGFzeW5jLnNlcmllcyhzZXJpZXMsIG5leHQpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIC8vIFJlbW92ZSBDb250YWluZXJcbiAgICAgIC8vIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIoeyBjb250YWluZXI6IG9wdGlvbnMuY29udGFpbmVyIH0sIG5leHQpLFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBlcnIgPT4ge1xuICAgICAgaWYgKGVycikgdGhyb3cgbmV3IEVycm9yKGVycik7XG4gICAgICBmaW5pc2goZXJyKTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZChjdHgubWV0aG9kLCB7XG4gICAgaHR0cDogeyBwYXRoOiBjdHguZW5kcG9pbnQsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246IGN0eC5kZXNjcmlwdGlvbixcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
