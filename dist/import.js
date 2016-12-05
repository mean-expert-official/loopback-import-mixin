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
//# sourceMappingURL=data:application/json;base64,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O0FBZ05BLG9CQUFRO0FBQ04sY0FBUSxHQUFSLENBQVksaUNBQVosRUFBK0MsUUFBUSxTQUFSLENBQS9DLENBRE07QUFFTixzQkFBZ0IsZ0JBQWhCLENBQWlDLFFBQVEsU0FBUixFQUFtQixJQUFwRCxFQUZNO0tBQVI7O0FBS0Esb0JBQVE7QUFDTixVQUFJLFNBQUosQ0FBYyxNQUFkLEdBQXVCLFVBQXZCLENBRE07QUFFTixVQUFJLFNBQUosQ0FBYyxJQUFkLENBQW1CLElBQW5CLEVBRk07S0FBUixDQS9ORixFQW1PRyxlQUFPO0FBQ1IsVUFBSSxHQUFKLEVBQVM7QUFDUCxnQkFBUSxHQUFSLENBQVksaUNBQVosRUFBK0MsUUFBUSxTQUFSLENBQS9DLENBRE87QUFFUCx3QkFBZ0IsZ0JBQWhCLENBQWlDLFFBQVEsU0FBUixFQUFtQixJQUFwRCxFQUZPO0FBR1AsY0FBTSxJQUFJLEtBQUosQ0FBVSxZQUFWLENBQU47O0FBSE8sT0FBVCxNQUtPLEVBTFA7QUFNQSxhQUFPLEdBQVAsRUFQUTtLQUFQLENBbk9ILENBSnFGO0dBQXhEOzs7O0FBL0RGLE9BbVQ3QixDQUFNLFlBQU4sQ0FBbUIsSUFBSSxNQUFKLEVBQVk7QUFDN0IsVUFBTSxFQUFFLE1BQU0sSUFBSSxRQUFKLEVBQWMsTUFBTSxNQUFOLEVBQTVCO0FBQ0EsYUFBUyxDQUFDO0FBQ1IsV0FBSyxLQUFMO0FBQ0EsWUFBTSxRQUFOO0FBQ0EsWUFBTSxFQUFFLFFBQVEsS0FBUixFQUFSO0tBSE8sQ0FBVDtBQUtBLGFBQVMsRUFBRSxNQUFNLFFBQU4sRUFBZ0IsTUFBTSxJQUFOLEVBQTNCO0FBQ0EsaUJBQWEsSUFBSSxXQUFKO0dBUmYsRUFuVDZCO0NBQWhCIiwiZmlsZSI6ImltcG9ydC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RhdHMgTWl4aW4gRGVwZW5kZW5jaWVzXG4gKi9cbmltcG9ydCBhc3luYyBmcm9tICdhc3luYyc7XG5pbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgY2hpbGRQcm9jZXNzIGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IGNzdiBmcm9tICdjc3YtcGFyc2VyJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG4vLyBpbXBvcnQgRGF0YVNvdXJjZUJ1aWxkZXIgZnJvbSAnLi9idWlsZGVycy9kYXRhc291cmNlLWJ1aWxkZXInO1xuLyoqXG4gICogQnVsayBJbXBvcnQgTWl4aW5cbiAgKiBAQXV0aG9yIEpvbmF0aGFuIENhc2FycnViaWFzXG4gICogQFNlZSA8aHR0cHM6Ly90d2l0dGVyLmNvbS9qb2huY2FzYXJydWJpYXM+XG4gICogQFNlZSA8aHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBTZWUgPGh0dHBzOi8vZ2l0aHViLmNvbS9qb25hdGhhbi1jYXNhcnJ1Ymlhcy9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQERlc2NyaXB0aW9uXG4gICpcbiAgKiBUaGUgZm9sbG93aW5nIG1peGluIHdpbGwgYWRkIGJ1bGsgaW1wb3J0aW5nIGZ1bmN0aW9uYWxsaXR5IHRvIG1vZGVscyB3aGljaCBpbmNsdWRlc1xuICAqIHRoaXMgbW9kdWxlLlxuICAqXG4gICogRGVmYXVsdCBDb25maWd1cmF0aW9uXG4gICpcbiAgKiBcIkltcG9ydFwiOiB7XG4gICogICBcIm1vZGVsc1wiOiB7XG4gICogICAgIFwiSW1wb3J0Q29udGFpbmVyXCI6IFwiTW9kZWxcIixcbiAgKiAgICAgXCJJbXBvcnRMb2dcIjogXCJNb2RlbFwiXG4gICogICB9XG4gICogfVxuICAqKi9cblxuZXhwb3J0IGRlZmF1bHQgKE1vZGVsLCBjdHgpID0+IHtcbiAgY3R4Lk1vZGVsID0gTW9kZWw7XG4gIGN0eC5tZXRob2QgPSBjdHgubWV0aG9kIHx8ICdpbXBvcnQnO1xuICBjdHguZW5kcG9pbnQgPSBjdHguZW5kcG9pbnQgfHwgWycvJywgY3R4Lm1ldGhvZF0uam9pbignJyk7XG4gIC8vIENyZWF0ZSBkeW5hbWljIHN0YXRpc3RpYyBtZXRob2RcbiAgTW9kZWxbY3R4Lm1ldGhvZF0gPSBmdW5jdGlvbiBTdGF0TWV0aG9kKHJlcSwgZmluaXNoKSB7XG4gICAgLy8gU2V0IG1vZGVsIG5hbWVzXG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0Q29udGFpbmVyKSB8fCAnSW1wb3J0Q29udGFpbmVyJztcbiAgICBjb25zdCBJbXBvcnRMb2dOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRMb2cpIHx8ICdJbXBvcnRMb2cnO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0Q29udGFpbmVyTmFtZV07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRMb2dOYW1lXTtcbiAgICBjb25zdCBjb250YWluZXJOYW1lID0gTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy0nICsgTWF0aC5yb3VuZChEYXRlLm5vdygpKSArICctJyArIE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwMDApO1xuICAgIGlmICghSW1wb3J0Q29udGFpbmVyIHx8ICFJbXBvcnRMb2cpIHtcbiAgICAgIHJldHVybiBmaW5pc2gobmV3IEVycm9yKCcobG9vcGJhY2staW1wb3J0LW1peGluKSBNaXNzaW5nIHJlcXVpcmVkIG1vZGVscywgdmVyaWZ5IHlvdXIgc2V0dXAgYW5kIGNvbmZpZ3VyYXRpb24nKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBDcmVhdGUgY29udGFpbmVyXG4gICAgICAgIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmNyZWF0ZUNvbnRhaW5lcih7IG5hbWU6IGNvbnRhaW5lck5hbWUgfSwgbmV4dCksXG4gICAgICAgIC8vIFVwbG9hZCBGaWxlXG4gICAgICAgIChjb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICByZXEucGFyYW1zLmNvbnRhaW5lciA9IGNvbnRhaW5lck5hbWU7XG4gICAgICAgICAgSW1wb3J0Q29udGFpbmVyLnVwbG9hZChyZXEsIHt9LCBuZXh0KTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGVyc2lzdCBwcm9jZXNzIGluIGRiIGFuZCBydW4gaW4gZm9yayBwcm9jZXNzXG4gICAgICAgIChmaWxlQ29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS50eXBlICE9PSAndGV4dC9jc3YnKSB7XG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihjb250YWluZXJOYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KG5ldyBFcnJvcignVGhlIGZpbGUgeW91IHNlbGVjdGVkIGlzIG5vdCBjc3YgZm9ybWF0JykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBTdG9yZSB0aGUgc3RhdGUgb2YgdGhlIGltcG9ydCBwcm9jZXNzIGluIHRoZSBkYXRhYmFzZVxuICAgICAgICAgIEltcG9ydExvZy5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0ZTogbW9tZW50KCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIG1vZGVsOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBzdGF0dXM6ICdQRU5ESU5HJyxcbiAgICAgICAgICB9LCAoZXJyLCBmaWxlVXBsb2FkKSA9PiBuZXh0KGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkpO1xuICAgICAgICB9LFxuICAgICAgXSwgKGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChlcnIsIGZpbGVDb250YWluZXIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBMYXVuY2ggYSBmb3JrIG5vZGUgcHJvY2VzcyB0aGF0IHdpbGwgaGFuZGxlIHRoZSBpbXBvcnRcbiAgICAgICAgY2hpbGRQcm9jZXNzLmZvcmsoX19kaXJuYW1lICsgJy9wcm9jZXNzZXMvaW1wb3J0LXByb2Nlc3MuanMnLCBbXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgbWV0aG9kOiBjdHgubWV0aG9kLFxuICAgICAgICAgICAgc2NvcGU6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIGZpbGVVcGxvYWRJZDogZmlsZVVwbG9hZC5pZCxcbiAgICAgICAgICAgIHJvb3Q6IE1vZGVsLmFwcC5kYXRhc291cmNlcy5jb250YWluZXIuc2V0dGluZ3Mucm9vdCxcbiAgICAgICAgICAgIGNvbnRhaW5lcjogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGZpbGU6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5uYW1lLFxuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyOiBJbXBvcnRDb250YWluZXJOYW1lLFxuICAgICAgICAgICAgSW1wb3J0TG9nOiBJbXBvcnRMb2dOYW1lLFxuICAgICAgICAgICAgcmVsYXRpb25zOiBjdHgucmVsYXRpb25zXG4gICAgICAgICAgfSldKTtcbiAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChudWxsLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgcmVzb2x2ZShmaWxlQ29udGFpbmVyKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogQ3JlYXRlIGltcG9ydCBtZXRob2QgKE5vdCBBdmFpbGFibGUgdGhyb3VnaCBSRVNUKVxuICAgKiovXG4gIE1vZGVsWydpbXBvcnQnICsgY3R4Lm1ldGhvZF0gPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IF9fZGlybmFtZSArICcvLi4vLi4vLi4vJyArIG9wdGlvbnMucm9vdCArICcvJyArIG9wdGlvbnMuY29udGFpbmVyICsgJy8nICsgb3B0aW9ucy5maWxlO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRDb250YWluZXJdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRMb2ddO1xuICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAvLyBHZXQgSW1wb3J0TG9nXG4gICAgICBuZXh0ID0+IEltcG9ydExvZy5maW5kQnlJZChvcHRpb25zLmZpbGVVcGxvYWRJZCwgbmV4dCksXG4gICAgICAvLyBTZXQgaW1wb3J0VXBsb2FkIHN0YXR1cyBhcyBwcm9jZXNzaW5nXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cgPSBpbXBvcnRMb2c7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ1BST0NFU1NJTkcnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgICAgLy8gSW1wb3J0IERhdGFcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgLy8gVGhpcyBsaW5lIG9wZW5zIHRoZSBmaWxlIGFzIGEgcmVhZGFibGUgc3RyZWFtXG4gICAgICAgIGxldCBzZXJpZXMgPSBbXTtcbiAgICAgICAgbGV0IGkgPSAxOyAvLyBTdGFydHMgaW4gb25lIHRvIGRpc2NvdW50IGNvbHVtbiBuYW1lc1xuICAgICAgICBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKVxuICAgICAgICAgIC5waXBlKGNzdigpKVxuICAgICAgICAgIC5vbignZGF0YScsIHJvdyA9PiB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICAoZnVuY3Rpb24gKGkpIHtcbiAgICAgICAgICAgICAgY29uc3Qgb2JqID0geyBpbXBvcnRJZDogb3B0aW9ucy5maWxlICsgJzonICsgaSB9O1xuICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgICAgbGV0IGlzT2JqID0gKHR5cGVvZiBjdHgubWFwW2tleV0gPT09ICdvYmplY3QnKTtcbiAgICAgICAgICAgICAgICBsZXQgY29sdW1uS2V5ID0gaXNPYmogPyBjdHgubWFwW2tleV0ubWFwIDogY3R4Lm1hcFtrZXldO1xuICAgICAgICAgICAgICAgIGlmIChyb3dbY29sdW1uS2V5XSkge1xuICAgICAgICAgICAgICAgICAgb2JqW2tleV0gPSByb3dbY29sdW1uS2V5XTtcbiAgICAgICAgICAgICAgICAgIGlmIChpc09iaikge1xuICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG1vbWVudChvYmpba2V5XSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gb2JqW2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY29uc3QgcXVlcnkgPSB7fTtcbiAgICAgICAgICAgICAgaWYgKGN0eC5wayAmJiBvYmpbY3R4LnBrXSkgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgICAvLyBMZXRzIHNldCBlYWNoIHJvdyBhIGZsb3dcbiAgICAgICAgICAgICAgc2VyaWVzLnB1c2gobmV4dFNlcmllID0+IHtcbiAgICAgICAgICAgICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAgICAgICAgICAgLy8gU2VlIGluIERCIGZvciBleGlzdGluZyBwZXJzaXN0ZWQgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICAgIG5leHRGYWxsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjdHgucGspIHJldHVybiBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgICAgTW9kZWwuZmluZE9uZSh7IHdoZXJlOiBxdWVyeSB9LCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBfa2V5IGluIG9iaikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShfa2V5KSkgaW5zdGFuY2VbX2tleV0gPSBvYmpbX2tleV07XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZVxuICAgICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHJldHVybiBuZXh0RmFsbChudWxsLCBpbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmNyZWF0ZShvYmosIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIHJlbGF0aW9uc1xuICAgICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyYWxsZWwgPSBbXTtcbiAgICAgICAgICAgICAgICAgICAgbGV0IHNldHVwUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGxpbmtSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgbGV0IGNyZWF0ZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICAvLyBJdGVyYXRlcyB0aHJvdWdoIGV4aXN0aW5nIHJlbGF0aW9ucyBpbiBtb2RlbFxuICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uID0gZnVuY3Rpb24gc3IoZXhwZWN0ZWRSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhpc3RpbmdSZWxhdGlvbiBpbiBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zLmhhc093blByb3BlcnR5KGV4aXN0aW5nUmVsYXRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gTWFrZXMgc3VyZSB0aGUgcmVsYXRpb24gZXhpc3RcbiAgICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24gPSBmdW5jdGlvbiBlcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkUmVsYXRpb24gPT09IGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhcmFsbGVsLnB1c2gobmV4dFBhcmFsbGVsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdsaW5rJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUeXBlIG9mIHJlbGF0aW9uIG5lZWRzIHRvIGJlIGRlZmluZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgUmVsYXRpb25cbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24gPSBmdW5jdGlvbiBjcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uLCBuZXh0UGFyYWxsZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVPYmogPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnc3RyaW5nJyAmJiByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSBtb21lbnQocm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0ubWFwXSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9iai5pbXBvcnRJZCA9IG9wdGlvbnMuZmlsZSArICc6JyArIGk7XG4gICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gTGluayBSZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVsUXJ5ID0geyB3aGVyZToge30gfTtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHByb3BlcnR5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZWxRcnkud2hlcmVbcHJvcGVydHldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmVbcHJvcGVydHldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgTW9kZWwuYXBwLm1vZGVsc1tNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbF0uZmluZE9uZShyZWxRcnksIChyZWxFcnIsIHJlbEluc3RhbmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVsRXJyKSByZXR1cm4gbmV4dFBhcmFsbGVsKHJlbEVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSB1bmV4aXN0aW5nIGluc3RhbmNlIG9mICcgKyBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8qKiBEb2VzIG5vdCB3b3JrLCBpdCBuZWVkcyB0byBtb3ZlZCB0byBvdGhlciBwb2ludCBpbiB0aGUgZmxvd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byBjcmVhdGUgZXhpc3RpbmcgcmVsYXRpb24uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqKi9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzTWFueVRocm91Z2gnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNBbmRCZWxvbmdzVG9NYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2JlbG9uZ3NUbyc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0ocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHNvbWUgcmVhc29uIGRvZXMgbm90IHdvcmssIG5vIGVycm9ycyBidXQgbm8gcmVsYXRpb25zaGlwIGlzIGNyZWF0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBVZ2x5IGZpeCBuZWVkZWQgdG8gYmUgaW1wbGVtZW50ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgYXV0b0lkID0gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXV0b0lkID0gYXV0b0lkLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgYXV0b0lkLnNsaWNlKDEpICsgJ0lkJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5mb3JlaWduS2V5IHx8IGF1dG9JZF0gPSByZWxJbnN0YW5jZS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIG9wdGlvbnMucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMucmVsYXRpb25zLmhhc093blByb3BlcnR5KGVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICBhc3luYy5wYXJhbGxlbChwYXJhbGxlbCwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgICBdLCBlcnIgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycy5wdXNoKHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdJTVBPUlQgRVJST1I6ICcsIHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV4dFNlcmllKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSkoaSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGFzeW5jLnNlcmllcyhzZXJpZXMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgc2VyaWVzID0gbnVsbDtcbiAgICAgICAgICAgICAgbmV4dChlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgLy8gUmVtb3ZlIENvbnRhaW5lclxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgIH0sXG4gICAgICAvLyBTZXQgc3RhdHVzIGFzIGZpbmlzaGVkXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnRklOSVNIRUQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgIF0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKCdUcnlpbmcgdG8gZGVzdHJveSBjb250YWluZXI6ICVzJywgb3B0aW9ucy5jb250YWluZXIpO1xuICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihvcHRpb25zLmNvbnRhaW5lciwgbmV4dClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdEQi1USU1FT1VUJyk7XG4gICAgICAgIC8vY3R4LmltcG9ydExvZy5zYXZlKCk7XG4gICAgICB9IGVsc2UgeyB9XG4gICAgICBmaW5pc2goZXJyKTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZChjdHgubWV0aG9kLCB7XG4gICAgaHR0cDogeyBwYXRoOiBjdHguZW5kcG9pbnQsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246IGN0eC5kZXNjcmlwdGlvbixcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
