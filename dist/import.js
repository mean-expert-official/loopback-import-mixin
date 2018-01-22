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
          var where = {};
          if (ctx.pk) {
            if (Array.isArray(ctx.pk)) {
              ctx.pk.forEach(function (pk) {
                if (obj[pk]) {
                  where[pk] = obj[pk];
                }
              });
            } else if (obj[ctx.pk]) {
              where[ctx.pk] = obj[ctx.pk];
            }
          }
          // Lets set each row a flow
          series.push(function (nextSerie) {
            _async2.default.waterfall([
            // See in DB for existing persisted instance
            function (nextFall) {
              if (!ctx.pk) return nextFall(null, null);
              Model.findOne({ where: where }, nextFall);
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
                var where = {};
                var pk = ctx.relations[expectedRelation].pk;
                if (pk) {
                  if (Array.isArray(pk)) {
                    pk.forEach(function (_pk) {
                      if (createObj[_pk]) where[_pk] = createObj[_pk];
                    });
                  } else if (createObj[pk]) {
                    where[pk] = createObj[pk];
                  }
                }
                instance[expectedRelation]({ where: where }, function (err, result) {
                  if (result && Array.isArray(result) && result.length > 0) {
                    var relatedInstance = result.pop();
                    (0, _keys2.default)(createObj).forEach(function (objKey) {
                      relatedInstance[objKey] = createObj[objKey];
                    });
                    relatedInstance.save(nextParallel);
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
            }], function (err) {
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC5qcyJdLCJuYW1lcyI6WyJNb2RlbCIsImN0eCIsIm1ldGhvZCIsImVuZHBvaW50Iiwiam9pbiIsIlN0YXRNZXRob2QiLCJyZXEiLCJmaW5pc2giLCJJbXBvcnRDb250YWluZXJOYW1lIiwibW9kZWxzIiwiSW1wb3J0Q29udGFpbmVyIiwiSW1wb3J0TG9nTmFtZSIsIkltcG9ydExvZyIsImFwcCIsImNvbnRhaW5lck5hbWUiLCJkZWZpbml0aW9uIiwibmFtZSIsIk1hdGgiLCJyb3VuZCIsIkRhdGUiLCJub3ciLCJyYW5kb20iLCJFcnJvciIsInJlc29sdmUiLCJyZWplY3QiLCJ3YXRlcmZhbGwiLCJjcmVhdGVDb250YWluZXIiLCJuZXh0IiwiY29udGFpbmVyIiwicGFyYW1zIiwidXBsb2FkIiwiZmlsZUNvbnRhaW5lciIsImZpbGVzIiwiZmlsZSIsInR5cGUiLCJkZXN0cm95Q29udGFpbmVyIiwiY3JlYXRlIiwiZGF0ZSIsInRvSVNPU3RyaW5nIiwibW9kZWwiLCJzdGF0dXMiLCJlcnIiLCJmaWxlVXBsb2FkIiwiZm9yayIsIl9fZGlybmFtZSIsInNjb3BlIiwiZmlsZVVwbG9hZElkIiwiaWQiLCJyb290IiwiZGF0YXNvdXJjZXMiLCJzZXR0aW5ncyIsInJlbGF0aW9ucyIsIkltcG9ydE1ldGhvZCIsIm9wdGlvbnMiLCJmaWxlUGF0aCIsImZpbmRCeUlkIiwiaW1wb3J0TG9nIiwic2F2ZSIsInNlcmllcyIsImkiLCJjcmVhdGVSZWFkU3RyZWFtIiwicGlwZSIsIm9uIiwib2JqIiwiaW1wb3J0SWQiLCJrZXkiLCJtYXAiLCJpc09iaiIsImNvbHVtbktleSIsInJvdyIsIndoZXJlIiwicGsiLCJBcnJheSIsImlzQXJyYXkiLCJmb3JFYWNoIiwicHVzaCIsIm5leHRGYWxsIiwiZmluZE9uZSIsImluc3RhbmNlIiwid2FybmluZ3MiLCJfa2V5IiwiaGFzT3duUHJvcGVydHkiLCJwYXJhbGxlbCIsInNldHVwUmVsYXRpb24iLCJlbnN1cmVSZWxhdGlvbiIsImxpbmtSZWxhdGlvbiIsImNyZWF0ZVJlbGF0aW9uIiwic3IiLCJleHBlY3RlZFJlbGF0aW9uIiwiZXhpc3RpbmdSZWxhdGlvbiIsImVyIiwibmV4dFBhcmFsbGVsIiwiY3IiLCJjcmVhdGVPYmoiLCJfcGsiLCJyZXN1bHQiLCJsZW5ndGgiLCJyZWxhdGVkSW5zdGFuY2UiLCJwb3AiLCJvYmpLZXkiLCJsciIsInJlbFFyeSIsInByb3BlcnR5IiwicmVsRXJyIiwicmVsSW5zdGFuY2UiLCJtZXNzYWdlIiwicmVsRXJyMiIsImV4aXN0IiwiYWRkIiwiYXV0b0lkIiwiY2hhckF0IiwidG9Mb3dlckNhc2UiLCJzbGljZSIsImZvcmVpZ25LZXkiLCJlcnMiLCJlcnJvcnMiLCJjb25zb2xlIiwiZXJyb3IiLCJuZXh0U2VyaWUiLCJsb2ciLCJlbWl0IiwicmVtb3RlTWV0aG9kIiwiaHR0cCIsInBhdGgiLCJ2ZXJiIiwiYWNjZXB0cyIsImFyZyIsInNvdXJjZSIsInJldHVybnMiLCJkZXNjcmlwdGlvbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUdBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7OztBQUNBO0FBQ0E7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztrQkFxQmUsVUFBQ0EsS0FBRCxFQUFRQyxHQUFSLEVBQWdCO0FBQzdCQSxNQUFJRCxLQUFKLEdBQVlBLEtBQVo7QUFDQUMsTUFBSUMsTUFBSixHQUFhRCxJQUFJQyxNQUFKLElBQWMsUUFBM0I7QUFDQUQsTUFBSUUsUUFBSixHQUFlRixJQUFJRSxRQUFKLElBQWdCLENBQUMsR0FBRCxFQUFNRixJQUFJQyxNQUFWLEVBQWtCRSxJQUFsQixDQUF1QixFQUF2QixDQUEvQjtBQUNBO0FBQ0FKLFFBQU1DLElBQUlDLE1BQVYsSUFBb0IsU0FBU0csVUFBVCxDQUFvQkMsR0FBcEIsRUFBeUJDLE1BQXpCLEVBQWlDO0FBQ25EO0FBQ0EsUUFBTUMsc0JBQXVCUCxJQUFJUSxNQUFKLElBQWNSLElBQUlRLE1BQUosQ0FBV0Ms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ZW50IjpbIi8qKlxuICogU3RhdHMgTWl4aW4gRGVwZW5kZW5jaWVzXG4gKi9cbmltcG9ydCBhc3luYyBmcm9tICdhc3luYyc7XG5pbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgY2hpbGRQcm9jZXNzIGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IGNzdiBmcm9tICdjc3YtcGFyc2VyJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG4vLyBpbXBvcnQgRGF0YVNvdXJjZUJ1aWxkZXIgZnJvbSAnLi9idWlsZGVycy9kYXRhc291cmNlLWJ1aWxkZXInO1xuLyoqXG4gICogQnVsayBJbXBvcnQgTWl4aW5cbiAgKiBAQXV0aG9yIEpvbmF0aGFuIENhc2FycnViaWFzXG4gICogQFNlZSA8aHR0cHM6Ly90d2l0dGVyLmNvbS9qb2huY2FzYXJydWJpYXM+XG4gICogQFNlZSA8aHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBTZWUgPGh0dHBzOi8vZ2l0aHViLmNvbS9qb25hdGhhbi1jYXNhcnJ1Ymlhcy9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQERlc2NyaXB0aW9uXG4gICpcbiAgKiBUaGUgZm9sbG93aW5nIG1peGluIHdpbGwgYWRkIGJ1bGsgaW1wb3J0aW5nIGZ1bmN0aW9uYWxsaXR5IHRvIG1vZGVscyB3aGljaCBpbmNsdWRlc1xuICAqIHRoaXMgbW9kdWxlLlxuICAqXG4gICogRGVmYXVsdCBDb25maWd1cmF0aW9uXG4gICpcbiAgKiBcIkltcG9ydFwiOiB7XG4gICogICBcIm1vZGVsc1wiOiB7XG4gICogICAgIFwiSW1wb3J0Q29udGFpbmVyXCI6IFwiTW9kZWxcIixcbiAgKiAgICAgXCJJbXBvcnRMb2dcIjogXCJNb2RlbFwiXG4gICogICB9XG4gICogfVxuICAqKi9cblxuZXhwb3J0IGRlZmF1bHQgKE1vZGVsLCBjdHgpID0+IHtcbiAgY3R4Lk1vZGVsID0gTW9kZWw7XG4gIGN0eC5tZXRob2QgPSBjdHgubWV0aG9kIHx8ICdpbXBvcnQnO1xuICBjdHguZW5kcG9pbnQgPSBjdHguZW5kcG9pbnQgfHwgWycvJywgY3R4Lm1ldGhvZF0uam9pbignJyk7XG4gIC8vIENyZWF0ZSBkeW5hbWljIHN0YXRpc3RpYyBtZXRob2RcbiAgTW9kZWxbY3R4Lm1ldGhvZF0gPSBmdW5jdGlvbiBTdGF0TWV0aG9kKHJlcSwgZmluaXNoKSB7XG4gICAgLy8gU2V0IG1vZGVsIG5hbWVzXG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0Q29udGFpbmVyKSB8fCAnSW1wb3J0Q29udGFpbmVyJztcbiAgICBjb25zdCBJbXBvcnRMb2dOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRMb2cpIHx8ICdJbXBvcnRMb2cnO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0Q29udGFpbmVyTmFtZV07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRMb2dOYW1lXTtcbiAgICBjb25zdCBjb250YWluZXJOYW1lID0gTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy0nICsgTWF0aC5yb3VuZChEYXRlLm5vdygpKSArICctJyArIE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwMDApO1xuICAgIGlmICghSW1wb3J0Q29udGFpbmVyIHx8ICFJbXBvcnRMb2cpIHtcbiAgICAgIHJldHVybiBmaW5pc2gobmV3IEVycm9yKCcobG9vcGJhY2staW1wb3J0LW1peGluKSBNaXNzaW5nIHJlcXVpcmVkIG1vZGVscywgdmVyaWZ5IHlvdXIgc2V0dXAgYW5kIGNvbmZpZ3VyYXRpb24nKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBDcmVhdGUgY29udGFpbmVyXG4gICAgICAgIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmNyZWF0ZUNvbnRhaW5lcih7IG5hbWU6IGNvbnRhaW5lck5hbWUgfSwgbmV4dCksXG4gICAgICAgIC8vIFVwbG9hZCBGaWxlXG4gICAgICAgIChjb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICByZXEucGFyYW1zLmNvbnRhaW5lciA9IGNvbnRhaW5lck5hbWU7XG4gICAgICAgICAgSW1wb3J0Q29udGFpbmVyLnVwbG9hZChyZXEsIHt9LCBuZXh0KTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGVyc2lzdCBwcm9jZXNzIGluIGRiIGFuZCBydW4gaW4gZm9yayBwcm9jZXNzXG4gICAgICAgIChmaWxlQ29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS50eXBlICE9PSAndGV4dC9jc3YnKSB7XG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihjb250YWluZXJOYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KG5ldyBFcnJvcignVGhlIGZpbGUgeW91IHNlbGVjdGVkIGlzIG5vdCBjc3YgZm9ybWF0JykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBTdG9yZSB0aGUgc3RhdGUgb2YgdGhlIGltcG9ydCBwcm9jZXNzIGluIHRoZSBkYXRhYmFzZVxuICAgICAgICAgIEltcG9ydExvZy5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0ZTogbW9tZW50KCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIG1vZGVsOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBzdGF0dXM6ICdQRU5ESU5HJyxcbiAgICAgICAgICB9LCAoZXJyLCBmaWxlVXBsb2FkKSA9PiBuZXh0KGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkpO1xuICAgICAgICB9LFxuICAgICAgXSwgKGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChlcnIsIGZpbGVDb250YWluZXIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBMYXVuY2ggYSBmb3JrIG5vZGUgcHJvY2VzcyB0aGF0IHdpbGwgaGFuZGxlIHRoZSBpbXBvcnRcbiAgICAgICAgY2hpbGRQcm9jZXNzLmZvcmsoX19kaXJuYW1lICsgJy9wcm9jZXNzZXMvaW1wb3J0LXByb2Nlc3MuanMnLCBbXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgbWV0aG9kOiBjdHgubWV0aG9kLFxuICAgICAgICAgICAgc2NvcGU6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIGZpbGVVcGxvYWRJZDogZmlsZVVwbG9hZC5pZCxcbiAgICAgICAgICAgIHJvb3Q6IE1vZGVsLmFwcC5kYXRhc291cmNlcy5jb250YWluZXIuc2V0dGluZ3Mucm9vdCxcbiAgICAgICAgICAgIGNvbnRhaW5lcjogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGZpbGU6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5uYW1lLFxuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyOiBJbXBvcnRDb250YWluZXJOYW1lLFxuICAgICAgICAgICAgSW1wb3J0TG9nOiBJbXBvcnRMb2dOYW1lLFxuICAgICAgICAgICAgcmVsYXRpb25zOiBjdHgucmVsYXRpb25zXG4gICAgICAgICAgfSldKTtcbiAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChudWxsLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgcmVzb2x2ZShmaWxlQ29udGFpbmVyKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogQ3JlYXRlIGltcG9ydCBtZXRob2QgKE5vdCBBdmFpbGFibGUgdGhyb3VnaCBSRVNUKVxuICAgKiovXG4gIE1vZGVsWydpbXBvcnQnICsgY3R4Lm1ldGhvZF0gPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IF9fZGlybmFtZSArICcvLi4vLi4vLi4vJyArIG9wdGlvbnMucm9vdCArICcvJyArIG9wdGlvbnMuY29udGFpbmVyICsgJy8nICsgb3B0aW9ucy5maWxlO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRDb250YWluZXJdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRMb2ddO1xuICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAvLyBHZXQgSW1wb3J0TG9nXG4gICAgICBuZXh0ID0+IEltcG9ydExvZy5maW5kQnlJZChvcHRpb25zLmZpbGVVcGxvYWRJZCwgbmV4dCksXG4gICAgICAvLyBTZXQgaW1wb3J0VXBsb2FkIHN0YXR1cyBhcyBwcm9jZXNzaW5nXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cgPSBpbXBvcnRMb2c7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ1BST0NFU1NJTkcnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgICAgLy8gSW1wb3J0IERhdGFcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgLy8gVGhpcyBsaW5lIG9wZW5zIHRoZSBmaWxlIGFzIGEgcmVhZGFibGUgc3RyZWFtXG4gICAgICAgIGxldCBzZXJpZXMgPSBbXTtcbiAgICAgICAgbGV0IGkgPSAxOyAvLyBTdGFydHMgaW4gb25lIHRvIGRpc2NvdW50IGNvbHVtbiBuYW1lc1xuICAgICAgICBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKVxuICAgICAgICAgIC5waXBlKGNzdigpKVxuICAgICAgICAgIC5vbignZGF0YScsIHJvdyA9PiB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAoZnVuY3Rpb24gKGkpIHtcbiAgICAgICAgICAgICAgY29uc3Qgb2JqID0geyBpbXBvcnRJZDogb3B0aW9ucy5maWxlICsgJzonICsgaSB9O1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgICAgbGV0IGlzT2JqID0gKHR5cGVvZiBjdHgubWFwW2tleV0gPT09ICdvYmplY3QnKTtcbiAgICAgICAgICAgICAgICBsZXQgY29sdW1uS2V5ID0gaXNPYmogPyBjdHgubWFwW2tleV0ubWFwIDogY3R4Lm1hcFtrZXldO1xuICAgICAgICAgICAgICAgIGlmIChyb3dbY29sdW1uS2V5XSkge1xuICAgICAgICAgICAgICAgICAgb2JqW2tleV0gPSByb3dbY29sdW1uS2V5XTtcbiAgICAgICAgICAgICAgICAgIGlmIChpc09iaikge1xuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG1vbWVudChvYmpba2V5XSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gb2JqW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3Qgd2hlcmUgPSB7fTtcbiAgICAgICAgICAgICAgaWYgKGN0eC5waykge1xuICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGN0eC5waykpIHtcbiAgICAgICAgICAgICAgICAgIGN0eC5way5mb3JFYWNoKChwaykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAob2JqW3BrXSkge1xuICAgICAgICAgICAgICAgICAgICAgIHdoZXJlW3BrXSA9IG9ialtwa107XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAob2JqW2N0eC5wa10pIHtcbiAgICAgICAgICAgICAgICAgIHdoZXJlW2N0eC5wa10gPSBvYmpbY3R4LnBrXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghY3R4LnBrKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmZpbmRPbmUoeyB3aGVyZSB9LCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBfa2V5IGluIG9iaikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShfa2V5KSkgaW5zdGFuY2VbX2tleV0gPSBvYmpbX2tleV07XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZVxuICAgICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHJldHVybiBuZXh0RmFsbChudWxsLCBpbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmNyZWF0ZShvYmosIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIHJlbGF0aW9uc1xuICAgICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyYWxsZWwgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHNldHVwUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGxpbmtSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGNyZWF0ZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICAvLyBJdGVyYXRlcyB0aHJvdWdoIGV4aXN0aW5nIHJlbGF0aW9ucyBpbiBtb2RlbFxuICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uID0gZnVuY3Rpb24gc3IoZXhwZWN0ZWRSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhpc3RpbmdSZWxhdGlvbiBpbiBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zLmhhc093blByb3BlcnR5KGV4aXN0aW5nUmVsYXRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gTWFrZXMgc3VyZSB0aGUgcmVsYXRpb24gZXhpc3RcbiAgICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24gPSBmdW5jdGlvbiBlcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkUmVsYXRpb24gPT09IGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFsbGVsLnB1c2gobmV4dFBhcmFsbGVsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdsaW5rJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUeXBlIG9mIHJlbGF0aW9uIG5lZWRzIHRvIGJlIGRlZmluZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgUmVsYXRpb25cbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24gPSBmdW5jdGlvbiBjcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uLCBuZXh0UGFyYWxsZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVPYmogPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnc3RyaW5nJyAmJiByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSBtb21lbnQocm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0ubWFwXSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9iai5pbXBvcnRJZCA9IG9wdGlvbnMuZmlsZSArICc6JyArIGk7XG4gICAgICAgICAgICAgICAgICAgICAgbGV0IHdoZXJlID0ge307XG4gICAgICAgICAgICAgICAgICAgICAgbGV0IHBrID0gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5waztcbiAgICAgICAgICAgICAgICAgICAgICBpZiAocGspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHBrKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBway5mb3JFYWNoKChfcGspID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3JlYXRlT2JqW19wa10pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aGVyZVtfcGtdID0gY3JlYXRlT2JqW19wa107XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChjcmVhdGVPYmpbcGtdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHdoZXJlW3BrXSA9IGNyZWF0ZU9ialtwa107XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dKHsgd2hlcmUgfSwgZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0ICYmIEFycmF5LmlzQXJyYXkocmVzdWx0KSAmJiByZXN1bHQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVsYXRlZEluc3RhbmNlID0gcmVzdWx0LnBvcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBPYmplY3Qua2V5cyhjcmVhdGVPYmopLmZvckVhY2goZnVuY3Rpb24gKG9iaktleSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbGF0ZWRJbnN0YW5jZVtvYmpLZXldID0gY3JlYXRlT2JqW29iaktleV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZWxhdGVkSW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gTGluayBSZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsUXJ5ID0geyB3aGVyZToge30gfTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHByb3BlcnR5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZWxRcnkud2hlcmVbcHJvcGVydHldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmVbcHJvcGVydHldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgTW9kZWwuYXBwLm1vZGVsc1tNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbF0uZmluZE9uZShyZWxRcnksIChyZWxFcnIsIHJlbEluc3RhbmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVsRXJyKSByZXR1cm4gbmV4dFBhcmFsbGVsKHJlbEVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSB1bmV4aXN0aW5nIGluc3RhbmNlIG9mICcgKyBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8qKiBEb2VzIG5vdCB3b3JrLCBpdCBuZWVkcyB0byBtb3ZlZCB0byBvdGhlciBwb2ludCBpbiB0aGUgZmxvd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byBjcmVhdGUgZXhpc3RpbmcgcmVsYXRpb24uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqKi9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzTWFueVRocm91Z2gnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNBbmRCZWxvbmdzVG9NYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2JlbG9uZ3NUbyc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0ocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHNvbWUgcmVhc29uIGRvZXMgbm90IHdvcmssIG5vIGVycm9ycyBidXQgbm8gcmVsYXRpb25zaGlwIGlzIGNyZWF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVZ2x5IGZpeCBuZWVkZWQgdG8gYmUgaW1wbGVtZW50ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgYXV0b0lkID0gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXV0b0lkID0gYXV0b0lkLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgYXV0b0lkLnNsaWNlKDEpICsgJ0lkJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5mb3JlaWduS2V5IHx8IGF1dG9JZF0gPSByZWxJbnN0YW5jZS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIG9wdGlvbnMucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMucmVsYXRpb25zLmhhc093blByb3BlcnR5KGVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICBhc3luYy5wYXJhbGxlbChwYXJhbGxlbCwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgICBdLCBlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycy5wdXNoKHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJTVBPUlQgRVJST1I6ICcsIHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV4dFNlcmllKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkoaSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGFzeW5jLnNlcmllcyhzZXJpZXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgc2VyaWVzID0gbnVsbDtcbiAgICAgICAgICAgICAgbmV4dChlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgLy8gUmVtb3ZlIENvbnRhaW5lclxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgIH0sXG4gICAgICAvLyBTZXQgc3RhdHVzIGFzIGZpbmlzaGVkXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnRklOSVNIRUQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgIF0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEQi1USU1FT1VUJyk7XG4gICAgICAgIC8vY3R4LmltcG9ydExvZy5zYXZlKCk7XG4gICAgICB9IGVsc2UgeyB9XG4gICAgICAvLyBUT0RPLCBBZGQgbW9yZSB2YWx1YWJsZSBkYXRhIHRvIHBhc3MsIG1heWJlIGEgYmV0dGVyIHdheSB0byBwYXNzIGVycm9yc1xuICAgICAgTW9kZWwuYXBwLmVtaXQoY3R4Lm1ldGhvZCArICc6ZG9uZScsIHt9KTtcbiAgICAgIGZpbmlzaChlcnIpO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogUmVnaXN0ZXIgSW1wb3J0IE1ldGhvZFxuICAgKi9cbiAgTW9kZWwucmVtb3RlTWV0aG9kKGN0eC5tZXRob2QsIHtcbiAgICBodHRwOiB7IHBhdGg6IGN0eC5lbmRwb2ludCwgdmVyYjogJ3Bvc3QnIH0sXG4gICAgYWNjZXB0czogW3tcbiAgICAgIGFyZzogJ3JlcScsXG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIGh0dHA6IHsgc291cmNlOiAncmVxJyB9LFxuICAgIH1dLFxuICAgIHJldHVybnM6IHsgdHlwZTogJ29iamVjdCcsIHJvb3Q6IHRydWUgfSxcbiAgICBkZXNjcmlwdGlvbjogY3R4LmRlc2NyaXB0aW9uLFxuICB9KTtcbn07XG4iXX0=
