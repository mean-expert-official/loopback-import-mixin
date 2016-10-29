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
//# sourceMappingURL=data:application/json;base64,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WixFQUErQyxRQUFRLFNBQVIsQ0FBL0MsQ0FETTtBQUVOLHNCQUFnQixnQkFBaEIsQ0FBaUMsUUFBUSxTQUFSLEVBQW1CLElBQXBELEVBRk07S0FBUjs7QUFLQSxvQkFBUTtBQUNOLFVBQUksU0FBSixDQUFjLE1BQWQsR0FBdUIsVUFBdkIsQ0FETTtBQUVOLFVBQUksU0FBSixDQUFjLElBQWQsQ0FBbUIsSUFBbkIsRUFGTTtLQUFSLENBL05GLEVBbU9HLGVBQU87QUFDUixVQUFJLEdBQUosRUFBUztBQUNQLGdCQUFRLEdBQVIsQ0FBWSxpQ0FBWixFQUErQyxRQUFRLFNBQVIsQ0FBL0MsQ0FETztBQUVQLHdCQUFnQixnQkFBaEIsQ0FBaUMsUUFBUSxTQUFSLEVBQW1CLElBQXBELEVBRk87QUFHUCxjQUFNLElBQUksS0FBSixDQUFVLFlBQVYsQ0FBTjs7QUFITyxPQUFULE1BS08sRUFMUDtBQU1BLGFBQU8sR0FBUCxFQVBRO0tBQVAsQ0FuT0gsQ0FKOEU7R0FBeEQ7Ozs7QUE5REssT0FrVDdCLENBQU0sWUFBTixDQUFtQixJQUFJLE1BQUosRUFBWTtBQUM3QixVQUFNLEVBQUUsTUFBTSxJQUFJLFFBQUosRUFBYyxNQUFNLE1BQU4sRUFBNUI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSxJQUFJLFdBQUo7R0FSZixFQWxUNkI7Q0FBaEIiLCJmaWxlIjoiaW1wb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdGF0cyBNaXhpbiBEZXBlbmRlbmNpZXNcbiAqL1xuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCBjaGlsZFByb2Nlc3MgZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgY3N2IGZyb20gJ2Nzdi1wYXJzZXInO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydExvZ1wiOiBcIk1vZGVsXCJcbiAgKiAgIH1cbiAgKiB9XG4gICoqL1xuXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICBjdHguTW9kZWwgPSBNb2RlbDtcbiAgY3R4Lm1ldGhvZCA9IGN0eC5tZXRob2QgfHwgJ2ltcG9ydCc7XG4gIGN0eC5lbmRwb2ludCA9IGN0eC5lbmRwb2ludCB8fCBbJy8nLCBjdHgubWV0aG9kXS5qb2luKCcnKTtcbiAgLy8gQ3JlYXRlIGR5bmFtaWMgc3RhdGlzdGljIG1ldGhvZFxuICBNb2RlbFtjdHgubWV0aG9kXSA9IGZ1bmN0aW9uIFN0YXRNZXRob2QocmVxLCBmaW5pc2gpIHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydExvZ05hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydExvZykgfHwgJ0ltcG9ydExvZyc7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRDb250YWluZXJOYW1lXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydExvZ05hbWVdO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydExvZykge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0TG9nLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRMb2c6IEltcG9ydExvZ05hbWUsXG4gICAgICAgICAgICByZWxhdGlvbnM6IGN0eC5yZWxhdGlvbnNcbiAgICAgICAgICB9KV0pO1xuICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKG51bGwsIGZpbGVDb250YWluZXIpO1xuICAgICAgICByZXNvbHZlKGZpbGVDb250YWluZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBDcmVhdGUgaW1wb3J0IG1ldGhvZCAoTm90IEF2YWlsYWJsZSB0aHJvdWdoIFJFU1QpXG4gICAqKi9cbiAgTW9kZWwuaW1wb3J0UHJvY2Vzc29yID0gZnVuY3Rpb24gSW1wb3J0TWV0aG9kKGNvbnRhaW5lciwgZmlsZSwgb3B0aW9ucywgZmluaXNoKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBfX2Rpcm5hbWUgKyAnLy4uLy4uLy4uLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0TG9nXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IEltcG9ydExvZ1xuICAgICAgbmV4dCA9PiBJbXBvcnRMb2cuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nID0gaW1wb3J0TG9nO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBsZXQgc2VyaWVzID0gW107XG4gICAgICAgIGxldCBpID0gMTsgLy8gU3RhcnRzIGluIG9uZSB0byBkaXNjb3VudCBjb2x1bW4gbmFtZXNcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgKGZ1bmN0aW9uIChpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IG9iaiA9IHsgaW1wb3J0SWQ6IG9wdGlvbnMuZmlsZSArICc6JyArIGkgfTtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICAgIGxldCBpc09iaiA9ICh0eXBlb2YgY3R4Lm1hcFtrZXldID09PSAnb2JqZWN0Jyk7XG4gICAgICAgICAgICAgICAgbGV0IGNvbHVtbktleSA9IGlzT2JqID8gY3R4Lm1hcFtrZXldLm1hcCA6IGN0eC5tYXBba2V5XTtcbiAgICAgICAgICAgICAgICBpZiAocm93W2NvbHVtbktleV0pIHtcbiAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2NvbHVtbktleV07XG4gICAgICAgICAgICAgICAgICBpZiAoaXNPYmopIHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgubWFwW2tleV0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgb2JqW2tleV0gPSBtb21lbnQob2JqW2tleV0sICdNTS1ERC1ZWVlZJykudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG9ialtrZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgICAgICAgICAgIGlmIChjdHgucGsgJiYgb2JqW2N0eC5wa10pIHF1ZXJ5W2N0eC5wa10gPSBvYmpbY3R4LnBrXTtcbiAgICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghY3R4LnBrKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmZpbmRPbmUoeyB3aGVyZTogcXVlcnkgfSwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIElmIHdlIGdldCBhbiBpbnN0YW5jZSB3ZSBqdXN0IHNldCBhIHdhcm5pbmcgaW50byB0aGUgbG9nXG4gICAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgX2tleSBpbiBvYmopIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoX2tleSkpIGluc3RhbmNlW19rZXldID0gb2JqW19rZXldO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIE90aGVyd2lzZSB3ZSBjcmVhdGUgYSBuZXcgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgaW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgICAgICBNb2RlbC5jcmVhdGUob2JqLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gRmluYWxsIHBhcmFsbGVsIHByb2Nlc3MgY29udGFpbmVyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICAgIGxldCBzZXR1cFJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICBsZXQgZW5zdXJlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBsaW5rUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBjcmVhdGVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgLy8gSXRlcmF0ZXMgdGhyb3VnaCBleGlzdGluZyByZWxhdGlvbnMgaW4gbW9kZWxcbiAgICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbiA9IGZ1bmN0aW9uIHNyKGV4cGVjdGVkUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUmVsYXRpb24gaW4gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShleGlzdGluZ1JlbGF0aW9uKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIE1ha2VzIHN1cmUgdGhlIHJlbGF0aW9uIGV4aXN0XG4gICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uID0gZnVuY3Rpb24gZXIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZFJlbGF0aW9uID09PSBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJhbGxlbC5wdXNoKG5leHRQYXJhbGxlbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnbGluayc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVHlwZSBvZiByZWxhdGlvbiBuZWVkcyB0byBiZSBkZWZpbmVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIFJlbGF0aW9uXG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uID0gZnVuY3Rpb24gY3IoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlT2JqID0ge307XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ3N0cmluZycgJiYgcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gbW9tZW50KHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLm1hcF0sICdNTS1ERC1ZWVlZJykudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmouaW1wb3J0SWQgPSBvcHRpb25zLmZpbGUgKyAnOicgKyBpO1xuICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmNyZWF0ZShjcmVhdGVPYmosIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIExpbmsgUmVsYXRpb25zXG4gICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbiA9IGZ1bmN0aW9uIGxyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZS5oYXNPd25Qcm9wZXJ0eShwcm9wZXJ0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbEVycikgcmV0dXJuIG5leHRQYXJhbGxlbChyZWxFcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZWxJbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvKiogRG9lcyBub3Qgd29yaywgaXQgbmVlZHMgdG8gbW92ZWQgdG8gb3RoZXIgcG9pbnQgaW4gdGhlIGZsb3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gY3JlYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiovXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnlUaHJvdWdoJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzQW5kQmVsb25nc1RvTWFueSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uYWRkKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdiZWxvbmdzVG8nOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBzb21lIHJlYXNvbiBkb2VzIG5vdCB3b3JrLCBubyBlcnJvcnMgYnV0IG5vIHJlbGF0aW9uc2hpcCBpcyBjcmVhdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVWdseSBmaXggbmVlZGVkIHRvIGJlIGltcGxlbWVudGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGF1dG9JZCA9IE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9JZCA9IGF1dG9JZC5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIGF1dG9JZC5zbGljZSgxKSArICdJZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0uZm9yZWlnbktleSB8fCBhdXRvSWRdID0gcmVsSW5zdGFuY2UuaWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIGRlZmluZWQgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycyBpbiBvcHRpb25zLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvcHRpb25zLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShlcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uKGVycyk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIFJ1biB0aGUgcmVsYXRpb25zIHByb2Nlc3MgaW4gcGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVycm9yIGluIHRoaXMgc2VyaWUgd2UgbG9nIGl0IGludG8gdGhlIGVycm9ycyBhcnJheSBvZiBvYmplY3RzXG4gICAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBWZXJpZnkgd2h5IGNhbiBub3Qgc2V0IGVycm9ycyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy5lcnJvcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy5lcnJvcnMucHVzaCh7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSU1QT1JUIEVSUk9SOiAnLCB7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pKGkpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgIHNlcmllcyA9IG51bGw7XG4gICAgICAgICAgICAgIG5leHQoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIC8vIFJlbW92ZSBDb250YWluZXJcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICB9LFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBlcnIgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignREItVElNRU9VVCcpO1xuICAgICAgICAvL2N0eC5pbXBvcnRMb2cuc2F2ZSgpO1xuICAgICAgfSBlbHNlIHsgfVxuICAgICAgZmluaXNoKGVycik7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBSZWdpc3RlciBJbXBvcnQgTWV0aG9kXG4gICAqL1xuICBNb2RlbC5yZW1vdGVNZXRob2QoY3R4Lm1ldGhvZCwge1xuICAgIGh0dHA6IHsgcGF0aDogY3R4LmVuZHBvaW50LCB2ZXJiOiAncG9zdCcgfSxcbiAgICBhY2NlcHRzOiBbe1xuICAgICAgYXJnOiAncmVxJyxcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgaHR0cDogeyBzb3VyY2U6ICdyZXEnIH0sXG4gICAgfV0sXG4gICAgcmV0dXJuczogeyB0eXBlOiAnb2JqZWN0Jywgcm9vdDogdHJ1ZSB9LFxuICAgIGRlc2NyaXB0aW9uOiBjdHguZGVzY3JpcHRpb24sXG4gIH0pO1xufTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
