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
            if ((0, _typeof3.default)(obj[key]) === 'object') {
              switch (obj[key].type) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O2tCQXVCZSxVQUFDLEtBQUQsRUFBUSxHQUFSLEVBQWdCO0FBQzdCLE1BQUksS0FBSixHQUFZLEtBQVosQ0FENkI7QUFFN0IsTUFBSSxNQUFKLEdBQWEsSUFBSSxNQUFKLElBQWMsUUFBZCxDQUZnQjtBQUc3QixNQUFJLFFBQUosR0FBZSxJQUFJLFFBQUosSUFBZ0IsQ0FBQyxHQUFELEVBQU0sSUFBSSxNQUFKLENBQU4sQ0FBa0IsSUFBbEIsQ0FBdUIsRUFBdkIsQ0FBaEI7O0FBSGMsT0FLN0IsQ0FBTSxJQUFJLE1BQUosQ0FBTixHQUFvQixTQUFTLFVBQVQsQ0FBb0IsR0FBcEIsRUFBeUIsTUFBekIsRUFBaUM7O0FBRW5ELFFBQU0sc0JBQXNCLEdBQUMsQ0FBSSxNQUFKLElBQWMsSUFBSSxNQUFKLENBQVcsZUFBWCxJQUErQixpQkFBOUMsQ0FGdUI7QUFHbkQsUUFBTSxnQkFBZ0IsR0FBQyxDQUFJLE1BQUosSUFBYyxJQUFJLE1BQUosQ0FBVyxTQUFYLElBQXlCLFdBQXhDLENBSDZCO0FBSW5ELFFBQU0sa0JBQWtCLE1BQU0sR0FBTixDQUFVLE1BQVYsQ0FBaUIsbUJBQWpCLENBQWxCLENBSjZDO0FBS25ELFFBQU0sWUFBWSxNQUFNLEdBQU4sQ0FBVSxNQUFWLENBQWlCLGFBQWpCLENBQVosQ0FMNkM7QUFNbkQsUUFBTSxnQkFBZ0IsTUFBTSxVQUFOLENBQWlCLElBQWpCLEdBQXdCLEdBQXhCLEdBQThCLEtBQUssS0FBTCxDQUFXLEtBQUssR0FBTCxFQUFYLENBQTlCLEdBQXVELEdBQXZELEdBQTZELEtBQUssS0FBTCxDQUFXLEtBQUssTUFBTCxLQUFnQixJQUFoQixDQUF4RSxDQU42QjtBQU9uRCxRQUFJLENBQUMsZUFBRCxJQUFvQixDQUFDLFNBQUQsRUFBWTtBQUNsQyxhQUFPLE9BQU8sSUFBSSxLQUFKLENBQVUsc0ZBQVYsQ0FBUCxDQUFQLENBRGtDO0tBQXBDO0FBR0EsV0FBTyxzQkFBWSxVQUFDLE9BQUQsRUFBVSxNQUFWLEVBQXFCO0FBQ3RDLHNCQUFNLFNBQU4sQ0FBZ0I7O0FBRWQ7ZUFBUSxnQkFBZ0IsZUFBaEIsQ0FBZ0MsRUFBRSxNQUFNLGFBQU4sRUFBbEMsRUFBeUQsSUFBekQ7T0FBUjs7QUFFQSxnQkFBQyxTQUFELEVBQVksSUFBWixFQUFxQjtBQUNuQixZQUFJLE1BQUosQ0FBVyxTQUFYLEdBQXVCLGFBQXZCLENBRG1CO0FBRW5CLHdCQUFnQixNQUFoQixDQUF1QixHQUF2QixFQUE0QixFQUE1QixFQUFnQyxJQUFoQyxFQUZtQjtPQUFyQjs7QUFLQSxnQkFBQyxhQUFELEVBQWdCLElBQWhCLEVBQXlCO0FBQ3ZCLFlBQUksY0FBYyxLQUFkLENBQW9CLElBQXBCLENBQXlCLENBQXpCLEVBQTRCLElBQTVCLEtBQXFDLFVBQXJDLEVBQWlEO0FBQ25ELDBCQUFnQixnQkFBaEIsQ0FBaUMsYUFBakMsRUFEbUQ7QUFFbkQsaUJBQU8sS0FBSyxJQUFJLEtBQUosQ0FBVSx5Q0FBVixDQUFMLENBQVAsQ0FGbUQ7U0FBckQ7O0FBRHVCLGlCQU12QixDQUFVLE1BQVYsQ0FBaUI7QUFDZixnQkFBTSx3QkFBUyxXQUFULEVBQU47QUFDQSxpQkFBTyxNQUFNLFVBQU4sQ0FBaUIsSUFBakI7QUFDUCxrQkFBUSxTQUFSO1NBSEYsRUFJRyxVQUFDLEdBQUQsRUFBTSxVQUFOO2lCQUFxQixLQUFLLEdBQUwsRUFBVSxhQUFWLEVBQXlCLFVBQXpCO1NBQXJCLENBSkgsQ0FOdUI7T0FBekIsQ0FURixFQXFCRyxVQUFDLEdBQUQsRUFBTSxhQUFOLEVBQXFCLFVBQXJCLEVBQW9DO0FBQ3JDLFlBQUksR0FBSixFQUFTO0FBQ1AsY0FBSSxPQUFPLE1BQVAsS0FBa0IsVUFBbEIsRUFBOEIsT0FBTyxHQUFQLEVBQVksYUFBWixFQUFsQztBQUNBLGlCQUFPLE9BQU8sR0FBUCxDQUFQLENBRk87U0FBVDs7QUFEcUMsK0JBTXJDLENBQWEsSUFBYixDQUFrQixZQUFZLDhCQUFaLEVBQTRDLENBQzVELHlCQUFlO0FBQ2IsaUJBQU8sTUFBTSxVQUFOLENBQWlCLElBQWpCO0FBQ1Asd0JBQWMsV0FBVyxFQUFYO0FBQ2QsZ0JBQU0sTUFBTSxHQUFOLENBQVUsV0FBVixDQUFzQixTQUF0QixDQUFnQyxRQUFoQyxDQUF5QyxJQUF6QztBQUNOLHFCQUFXLGNBQWMsS0FBZCxDQUFvQixJQUFwQixDQUF5QixDQUF6QixFQUE0QixTQUE1QjtBQUNYLGdCQUFNLGNBQWMsS0FBZCxDQUFvQixJQUFwQixDQUF5QixDQUF6QixFQUE0QixJQUE1QjtBQUNOLDJCQUFpQixtQkFBakI7QUFDQSxxQkFBVyxhQUFYO0FBQ0EscUJBQVcsSUFBSSxTQUFKO1NBUmIsQ0FENEQsQ0FBOUQsRUFOcUM7QUFpQnJDLFlBQUksT0FBTyxNQUFQLEtBQWtCLFVBQWxCLEVBQThCLE9BQU8sSUFBUCxFQUFhLGFBQWIsRUFBbEM7QUFDQSxnQkFBUSxhQUFSLEVBbEJxQztPQUFwQyxDQXJCSCxDQURzQztLQUFyQixDQUFuQixDQVZtRDtHQUFqQzs7OztBQUxTLE9BOEQ3QixDQUFNLGVBQU4sR0FBd0IsU0FBUyxZQUFULENBQXNCLFNBQXRCLEVBQWlDLElBQWpDLEVBQXVDLE9BQXZDLEVBQWdELE1BQWhELEVBQXdEO0FBQzlFLFFBQU0sV0FBVyxZQUFZLFlBQVosR0FBMkIsUUFBUSxJQUFSLEdBQWUsR0FBMUMsR0FBZ0QsUUFBUSxTQUFSLEdBQW9CLEdBQXBFLEdBQTBFLFFBQVEsSUFBUixDQURiO0FBRTlFLFFBQU0sa0JBQWtCLE1BQU0sR0FBTixDQUFVLE1BQVYsQ0FBaUIsUUFBUSxlQUFSLENBQW5DLENBRndFO0FBRzlFLFFBQU0sWUFBWSxNQUFNLEdBQU4sQ0FBVSxNQUFWLENBQWlCLFFBQVEsU0FBUixDQUE3QixDQUh3RTtBQUk5RSxvQkFBTSxTQUFOLENBQWdCOztBQUVkO2FBQVEsVUFBVSxRQUFWLENBQW1CLFFBQVEsWUFBUixFQUFzQixJQUF6QztLQUFSOztBQUVBLGNBQUMsU0FBRCxFQUFZLElBQVosRUFBcUI7QUFDbkIsVUFBSSxTQUFKLEdBQWdCLFNBQWhCLENBRG1CO0FBRW5CLFVBQUksU0FBSixDQUFjLE1BQWQsR0FBdUIsWUFBdkIsQ0FGbUI7QUFHbkIsVUFBSSxTQUFKLENBQWMsSUFBZCxDQUFtQixJQUFuQixFQUhtQjtLQUFyQjs7QUFNQSxjQUFDLFNBQUQsRUFBWSxJQUFaLEVBQXFCOztBQUVuQixVQUFJLFNBQVMsRUFBVCxDQUZlO0FBR25CLFVBQUksSUFBSSxDQUFKLENBSGU7QUFJbkIsbUJBQUcsZ0JBQUgsQ0FBb0IsUUFBcEIsRUFDRyxJQURILENBQ1EsMEJBRFIsRUFFRyxFQUZILENBRU0sTUFGTixFQUVjLGVBQU87QUFDakIsWUFEaUI7QUFFakIsWUFBTSxNQUFNLEVBQU4sQ0FGVztBQUdqQixhQUFLLElBQU0sR0FBTixJQUFhLElBQUksR0FBSixFQUFTO0FBQ3pCLGNBQUksSUFBSSxJQUFJLEdBQUosQ0FBUSxHQUFSLENBQUosQ0FBSixFQUF1QjtBQUNyQixnQkFBSSxHQUFKLElBQVcsSUFBSSxJQUFJLEdBQUosQ0FBUSxHQUFSLENBQUosQ0FBWCxDQURxQjtBQUVyQixnQkFBSSxzQkFBTyxJQUFJLEdBQUosRUFBUCxLQUFvQixRQUFwQixFQUE4QjtBQUNoQyxzQkFBUSxJQUFJLEdBQUosRUFBUyxJQUFUO0FBQ1IscUJBQUssTUFBTDtBQUNFLHNCQUFJLEdBQUosSUFBVyxzQkFBTyxJQUFJLEdBQUosQ0FBUCxFQUFpQixZQUFqQixFQUErQixXQUEvQixFQUFYLENBREY7QUFFRSx3QkFGRjtBQURBO0FBS0Usc0JBQUksR0FBSixJQUFXLElBQUksR0FBSixDQUFYLENBREY7QUFKQSxlQURnQzthQUFsQztXQUZGO1NBREY7QUFjQSxZQUFNLFFBQVEsRUFBUixDQWpCVztBQWtCakIsWUFBSSxJQUFJLEVBQUosSUFBVSxJQUFJLElBQUksRUFBSixDQUFkLEVBQXVCLE1BQU0sSUFBSSxFQUFKLENBQU4sR0FBZ0IsSUFBSSxJQUFJLEVBQUosQ0FBcEIsQ0FBM0I7O0FBbEJpQixjQW9CakIsQ0FBTyxJQUFQLENBQVkscUJBQWE7QUFDdkIsMEJBQU0sU0FBTixDQUFnQjs7QUFFZCw4QkFBWTtBQUNWLGdCQUFJLENBQUMsSUFBSSxFQUFKLEVBQVEsT0FBTyxTQUFTLElBQVQsRUFBZSxJQUFmLENBQVAsQ0FBYjtBQUNBLGtCQUFNLE9BQU4sQ0FBYyxFQUFFLE9BQU8sS0FBUCxFQUFoQixFQUFnQyxRQUFoQyxFQUZVO1dBQVo7O0FBS0Esb0JBQUMsUUFBRCxFQUFXLFFBQVgsRUFBd0I7QUFDdEIsZ0JBQUksUUFBSixFQUFjO0FBQ1osa0JBQUksU0FBSixDQUFjLFFBQWQsR0FBeUIsTUFBTSxPQUFOLENBQWMsSUFBSSxTQUFKLENBQWMsUUFBZCxDQUFkLEdBQXdDLElBQUksU0FBSixDQUFjLFFBQWQsR0FBeUIsRUFBakUsQ0FEYjtBQUVaLG1CQUFLLElBQU0sSUFBTixJQUFjLEdBQW5CLEVBQXdCO0FBQ3RCLG9CQUFJLElBQUksY0FBSixDQUFtQixJQUFuQixDQUFKLEVBQThCLFNBQVMsSUFBVCxJQUFpQixJQUFJLElBQUosQ0FBakIsQ0FBOUI7ZUFERjtBQUdBLHVCQUFTLElBQVQsQ0FBYyxRQUFkLEVBTFk7YUFBZCxNQU1PO0FBQ0wsdUJBQVMsSUFBVCxFQUFlLElBQWYsRUFESzthQU5QO1dBREY7O0FBWUEsb0JBQUMsUUFBRCxFQUFXLFFBQVgsRUFBd0I7QUFDdEIsZ0JBQUksUUFBSixFQUFjLE9BQU8sU0FBUyxJQUFULEVBQWUsUUFBZixDQUFQLENBQWQ7QUFDQSxnQkFBSSxRQUFKLEdBQWUsUUFBUSxJQUFSLEdBQWUsR0FBZixHQUFtQixDQUFuQixDQUZPO0FBR3RCLGtCQUFNLE1BQU4sQ0FBYSxHQUFiLEVBQWtCLFFBQWxCLEVBSHNCO1dBQXhCOztBQU1BLG9CQUFDLFFBQUQsRUFBVyxRQUFYLEVBQXdCOztBQUV0QixnQkFBTSxXQUFXLEVBQVgsQ0FGZ0I7QUFHdEIsZ0JBQUksc0JBQUosQ0FIc0I7QUFJdEIsZ0JBQUksdUJBQUosQ0FKc0I7QUFLdEIsZ0JBQUkscUJBQUosQ0FMc0I7QUFNdEIsZ0JBQUksdUJBQUo7O0FBTnNCLHlCQVF0QixHQUFnQixTQUFTLEVBQVQsQ0FBWSxnQkFBWixFQUE4QjtBQUM1QyxtQkFBSyxJQUFNLGdCQUFOLElBQTBCLE1BQU0sVUFBTixDQUFpQixRQUFqQixDQUEwQixTQUExQixFQUFxQztBQUNsRSxvQkFBSSxNQUFNLFVBQU4sQ0FBaUIsUUFBakIsQ0FBMEIsU0FBMUIsQ0FBb0MsY0FBcEMsQ0FBbUQsZ0JBQW5ELENBQUosRUFBMEU7QUFDeEUsaUNBQWUsZ0JBQWYsRUFBaUMsZ0JBQWpDLEVBRHdFO2lCQUExRTtlQURGO2FBRGM7O0FBUk0sMEJBZ0J0QixHQUFpQixTQUFTLEVBQVQsQ0FBWSxnQkFBWixFQUE4QixnQkFBOUIsRUFBZ0Q7QUFDL0Qsa0JBQUkscUJBQXFCLGdCQUFyQixFQUF1QztBQUN6Qyx5QkFBUyxJQUFULENBQWMsd0JBQWdCO0FBQzVCLDBCQUFRLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLElBQWhDO0FBQ1IseUJBQUssTUFBTDtBQUNFLG1DQUNFLGdCQURGLEVBRUUsZ0JBRkYsRUFHRSxZQUhGLEVBREY7QUFNRSw0QkFORjtBQURBLHlCQVFLLFFBQUw7QUFDRSxxQ0FDRSxnQkFERixFQUVFLGdCQUZGLEVBR0UsWUFIRixFQURGO0FBTUUsNEJBTkY7QUFSQTtBQWdCRSw0QkFBTSxJQUFJLEtBQUosQ0FBVSxzQ0FBVixDQUFOLENBREY7QUFmQSxtQkFENEI7aUJBQWhCLENBQWQsQ0FEeUM7ZUFBM0M7YUFEZTs7QUFoQkssMEJBeUN0QixHQUFpQixTQUFTLEVBQVQsQ0FBWSxnQkFBWixFQUE4QixnQkFBOUIsRUFBZ0QsWUFBaEQsRUFBOEQ7QUFDN0Usa0JBQU0sWUFBWSxFQUFaLENBRHVFO0FBRTdFLG1CQUFLLElBQU0sS0FBTixJQUFhLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLEVBQXFDO0FBQ3JELG9CQUFJLE9BQU8sSUFBSSxTQUFKLENBQWMsZ0JBQWQsRUFBZ0MsR0FBaEMsQ0FBb0MsS0FBcEMsQ0FBUCxLQUFvRCxRQUFwRCxJQUFnRSxJQUFJLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLENBQW9DLEtBQXBDLENBQUosQ0FBaEUsRUFBK0c7QUFDakgsNEJBQVUsS0FBVixJQUFpQixJQUFJLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLENBQW9DLEtBQXBDLENBQUosQ0FBakIsQ0FEaUg7aUJBQW5ILE1BRU8sSUFBSSxzQkFBTyxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxFQUFQLEtBQW9ELFFBQXBELEVBQThEO0FBQ3ZFLDBCQUFRLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLENBQW9DLEtBQXBDLEVBQXlDLElBQXpDO0FBQ1IseUJBQUssTUFBTDtBQUNFLGdDQUFVLEtBQVYsSUFBaUIsc0JBQU8sSUFBSSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxFQUF5QyxHQUF6QyxDQUFYLEVBQTBELFlBQTFELEVBQXdFLFdBQXhFLEVBQWpCLENBREY7QUFFRSw0QkFGRjtBQURBO0FBS0UsZ0NBQVUsS0FBVixJQUFpQixJQUFJLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLENBQW9DLEtBQXBDLENBQUosQ0FBakIsQ0FERjtBQUpBLG1CQUR1RTtpQkFBbEU7ZUFIVDtBQWFBLHdCQUFVLFFBQVYsR0FBcUIsUUFBUSxJQUFSLEdBQWUsR0FBZixHQUFtQixDQUFuQixDQWZ3RDtBQWdCN0UsdUJBQVMsZ0JBQVQsRUFBMkIsTUFBM0IsQ0FBa0MsU0FBbEMsRUFBNkMsWUFBN0MsRUFoQjZFO2FBQTlEOztBQXpDSyx3QkE0RHRCLEdBQWUsU0FBUyxFQUFULENBQVksZ0JBQVosRUFBOEIsZ0JBQTlCLEVBQWdELFlBQWhELEVBQThEO0FBQzNFLGtCQUFNLFNBQVMsRUFBRSxPQUFPLEVBQVAsRUFBWCxDQURxRTtBQUUzRSxtQkFBSyxJQUFNLFFBQU4sSUFBa0IsSUFBSSxTQUFKLENBQWMsZ0JBQWQsRUFBZ0MsS0FBaEMsRUFBdUM7QUFDNUQsb0JBQUksSUFBSSxTQUFKLENBQWMsZ0JBQWQsRUFBZ0MsS0FBaEMsQ0FBc0MsY0FBdEMsQ0FBcUQsUUFBckQsQ0FBSixFQUFvRTtBQUNsRSx5QkFBTyxLQUFQLENBQWEsUUFBYixJQUF5QixJQUFJLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEtBQWhDLENBQXNDLFFBQXRDLENBQUosQ0FBekIsQ0FEa0U7aUJBQXBFO2VBREY7QUFLQSxvQkFBTSxHQUFOLENBQVUsTUFBVixDQUFpQixNQUFNLFVBQU4sQ0FBaUIsUUFBakIsQ0FBMEIsU0FBMUIsQ0FBb0MsZ0JBQXBDLEVBQXNELEtBQXRELENBQWpCLENBQThFLE9BQTlFLENBQXNGLE1BQXRGLEVBQThGLFVBQUMsTUFBRCxFQUFTLFdBQVQsRUFBeUI7QUFDckgsb0JBQUksTUFBSixFQUFZLE9BQU8sYUFBYSxNQUFiLENBQVAsQ0FBWjtBQUNBLG9CQUFJLENBQUMsV0FBRCxFQUFjO0FBQ2hCLHNCQUFJLFNBQUosQ0FBYyxRQUFkLEdBQXlCLE1BQU0sT0FBTixDQUFjLElBQUksU0FBSixDQUFjLFFBQWQsQ0FBZCxHQUF3QyxJQUFJLFNBQUosQ0FBYyxRQUFkLEdBQXlCLEVBQWpFLENBRFQ7QUFFaEIsc0JBQUksU0FBSixDQUFjLFFBQWQsQ0FBdUIsSUFBdkIsQ0FBNEI7QUFDMUIseUJBQUssR0FBTDtBQUNBLDZCQUFTLE1BQU0sVUFBTixDQUFpQixJQUFqQixHQUF3QixHQUF4QixHQUE4QixnQkFBOUIsR0FBaUQsMENBQWpELEdBQThGLGdCQUE5RjttQkFGWCxFQUZnQjtBQU1oQix5QkFBTyxjQUFQLENBTmdCO2lCQUFsQjtBQVFBLHdCQUFRLE1BQU0sVUFBTixDQUFpQixRQUFqQixDQUEwQixTQUExQixDQUFvQyxnQkFBcEMsRUFBc0QsSUFBdEQ7QUFDUix1QkFBSyxTQUFMOzs7Ozs7Ozs7Ozs7OztBQWNFLG1DQWRGO0FBZUUsMEJBZkY7QUFEQSx1QkFpQkssZ0JBQUwsQ0FqQkE7QUFrQkEsdUJBQUsscUJBQUw7QUFDRSw2QkFBUyxnQkFBVCxFQUEyQixRQUEzQixDQUFvQyxZQUFZLEVBQVosRUFBZ0IsVUFBQyxPQUFELEVBQVUsS0FBVixFQUFvQjtBQUN0RSwwQkFBSSxLQUFKLEVBQVc7QUFDVCw0QkFBSSxTQUFKLENBQWMsUUFBZCxHQUF5QixNQUFNLE9BQU4sQ0FBYyxJQUFJLFNBQUosQ0FBYyxRQUFkLENBQWQsR0FBd0MsSUFBSSxTQUFKLENBQWMsUUFBZCxHQUF5QixFQUFqRSxDQURoQjtBQUVULDRCQUFJLFNBQUosQ0FBYyxRQUFkLENBQXVCLElBQXZCLENBQTRCO0FBQzFCLCtCQUFLLEdBQUw7QUFDQSxtQ0FBUyxNQUFNLFVBQU4sQ0FBaUIsSUFBakIsR0FBd0IsR0FBeEIsR0FBOEIsZ0JBQTlCLEdBQWlELHFDQUFqRDt5QkFGWCxFQUZTO0FBTVQsK0JBQU8sY0FBUCxDQU5TO3VCQUFYO0FBUUEsK0JBQVMsZ0JBQVQsRUFBMkIsR0FBM0IsQ0FBK0IsV0FBL0IsRUFBNEMsWUFBNUMsRUFUc0U7cUJBQXBCLENBQXBELENBREY7QUFZRSwwQkFaRjtBQWxCQSx1QkErQkssV0FBTDs7OztBQUlFLHdCQUFJLFNBQVMsTUFBTSxVQUFOLENBQWlCLFFBQWpCLENBQTBCLFNBQTFCLENBQW9DLGdCQUFwQyxFQUFzRCxLQUF0RCxDQUpmO0FBS0UsNkJBQVMsT0FBTyxNQUFQLENBQWMsQ0FBZCxFQUFpQixXQUFqQixLQUFpQyxPQUFPLEtBQVAsQ0FBYSxDQUFiLENBQWpDLEdBQW1ELElBQW5ELENBTFg7QUFNRSw2QkFBUyxNQUFNLFVBQU4sQ0FBaUIsUUFBakIsQ0FBMEIsU0FBMUIsQ0FBb0MsZ0JBQXBDLEVBQXNELFVBQXRELElBQW9FLE1BQXBFLENBQVQsR0FBdUYsWUFBWSxFQUFaLENBTnpGO0FBT0UsNkJBQVMsSUFBVCxDQUFjLFlBQWQsRUFQRjtBQVFFLDBCQVJGO0FBL0JBO0FBeUNFLG1DQURGO0FBeENBLGlCQVZxSDtlQUF6QixDQUE5RixDQVAyRTthQUE5RDs7QUE1RE8saUJBMkhqQixJQUFNLEdBQU4sSUFBYSxRQUFRLFNBQVIsRUFBbUI7QUFDbkMsa0JBQUksUUFBUSxTQUFSLENBQWtCLGNBQWxCLENBQWlDLEdBQWpDLENBQUosRUFBMkM7QUFDekMsOEJBQWMsR0FBZCxFQUR5QztlQUEzQzthQURGOztBQTNIc0IsMkJBaUl0QixDQUFNLFFBQU4sQ0FBZSxRQUFmLEVBQXlCLFFBQXpCLEVBaklzQjtXQUF4QixDQXpCRjs7QUE2SkcseUJBQU87QUFDUixnQkFBSSxHQUFKLEVBQVM7O0FBRVAsa0JBQUksTUFBTSxPQUFOLENBQWMsSUFBSSxTQUFKLENBQWMsTUFBZCxDQUFsQixFQUF5QztBQUN2QyxvQkFBSSxTQUFKLENBQWMsTUFBZCxDQUFxQixJQUFyQixDQUEwQixFQUFFLEtBQUssR0FBTCxFQUFVLFNBQVMsR0FBVCxFQUF0QyxFQUR1QztlQUF6QyxNQUVPO0FBQ0wsd0JBQVEsS0FBUixDQUFjLGdCQUFkLEVBQWdDLEVBQUUsS0FBSyxHQUFMLEVBQVUsU0FBUyxHQUFULEVBQTVDLEVBREs7ZUFGUDthQUZGO0FBUUEsd0JBVFE7V0FBUCxDQTdKSCxDQUR1QjtTQUFiLENBQVosQ0FwQmlCO09BQVAsQ0FGZCxDQWlNRyxFQWpNSCxDQWlNTSxLQWpNTixFQWlNYSxZQUFNO0FBQ2Ysd0JBQU0sTUFBTixDQUFhLE1BQWIsRUFBcUIsVUFBVSxHQUFWLEVBQWU7QUFDbEMsbUJBQVMsSUFBVCxDQURrQztBQUVsQyxlQUFLLEdBQUwsRUFGa0M7U0FBZixDQUFyQixDQURlO09BQU4sQ0FqTWIsQ0FKbUI7S0FBckI7O0FBNk1BLG9CQUFRO0FBQ04sY0FBUSxHQUFSLENBQVksaUNBQVosRUFBK0MsUUFBUSxTQUFSLENBQS9DLENBRE07QUFFTixzQkFBZ0IsZ0JBQWhCLENBQWlDLFFBQVEsU0FBUixFQUFtQixJQUFwRCxFQUZNO0tBQVI7O0FBS0Esb0JBQVE7QUFDTixVQUFJLFNBQUosQ0FBYyxNQUFkLEdBQXVCLFVBQXZCLENBRE07QUFFTixVQUFJLFNBQUosQ0FBYyxJQUFkLENBQW1CLElBQW5CLEVBRk07S0FBUixDQTVORixFQWdPRyxlQUFPO0FBQ1IsVUFBSSxHQUFKLEVBQVM7QUFDUCxZQUFJLFNBQUosQ0FBYyxNQUFkLEdBQXVCLFlBQXZCLENBRE87QUFFUCxZQUFJLFNBQUosQ0FBYyxJQUFkLEdBRk87T0FBVCxNQUdPLEVBSFA7QUFJQSxhQUFPLEdBQVAsRUFMUTtLQUFQLENBaE9ILENBSjhFO0dBQXhEOzs7O0FBOURLLE9BNlM3QixDQUFNLFlBQU4sQ0FBbUIsSUFBSSxNQUFKLEVBQVk7QUFDN0IsVUFBTSxFQUFFLE1BQU0sSUFBSSxRQUFKLEVBQWMsTUFBTSxNQUFOLEVBQTVCO0FBQ0EsYUFBUyxDQUFDO0FBQ1IsV0FBSyxLQUFMO0FBQ0EsWUFBTSxRQUFOO0FBQ0EsWUFBTSxFQUFFLFFBQVEsS0FBUixFQUFSO0tBSE8sQ0FBVDtBQUtBLGFBQVMsRUFBRSxNQUFNLFFBQU4sRUFBZ0IsTUFBTSxJQUFOLEVBQTNCO0FBQ0EsaUJBQWEsSUFBSSxXQUFKO0dBUmYsRUE3UzZCO0NBQWhCIiwiZmlsZSI6ImltcG9ydC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RhdHMgTWl4aW4gRGVwZW5kZW5jaWVzXG4gKi9cbmltcG9ydCBhc3luYyBmcm9tICdhc3luYyc7XG5pbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgY2hpbGRQcm9jZXNzIGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IGNzdiBmcm9tICdjc3YtcGFyc2VyJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG4vLyBpbXBvcnQgRGF0YVNvdXJjZUJ1aWxkZXIgZnJvbSAnLi9idWlsZGVycy9kYXRhc291cmNlLWJ1aWxkZXInO1xuLyoqXG4gICogQnVsayBJbXBvcnQgTWl4aW5cbiAgKiBAQXV0aG9yIEpvbmF0aGFuIENhc2FycnViaWFzXG4gICogQFNlZSA8aHR0cHM6Ly90d2l0dGVyLmNvbS9qb2huY2FzYXJydWJpYXM+XG4gICogQFNlZSA8aHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBTZWUgPGh0dHBzOi8vZ2l0aHViLmNvbS9qb25hdGhhbi1jYXNhcnJ1Ymlhcy9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQERlc2NyaXB0aW9uXG4gICpcbiAgKiBUaGUgZm9sbG93aW5nIG1peGluIHdpbGwgYWRkIGJ1bGsgaW1wb3J0aW5nIGZ1bmN0aW9uYWxsaXR5IHRvIG1vZGVscyB3aGljaCBpbmNsdWRlc1xuICAqIHRoaXMgbW9kdWxlLlxuICAqXG4gICogRGVmYXVsdCBDb25maWd1cmF0aW9uXG4gICpcbiAgKiBcIkltcG9ydFwiOiB7XG4gICogICBcIm1vZGVsc1wiOiB7XG4gICogICAgIFwiSW1wb3J0Q29udGFpbmVyXCI6IFwiTW9kZWxcIixcbiAgKiAgICAgXCJJbXBvcnRMb2dcIjogXCJNb2RlbFwiXG4gICogICB9XG4gICogfVxuICAqKi9cblxuZXhwb3J0IGRlZmF1bHQgKE1vZGVsLCBjdHgpID0+IHtcbiAgY3R4Lk1vZGVsID0gTW9kZWw7XG4gIGN0eC5tZXRob2QgPSBjdHgubWV0aG9kIHx8ICdpbXBvcnQnO1xuICBjdHguZW5kcG9pbnQgPSBjdHguZW5kcG9pbnQgfHwgWycvJywgY3R4Lm1ldGhvZF0uam9pbignJyk7XG4gIC8vIENyZWF0ZSBkeW5hbWljIHN0YXRpc3RpYyBtZXRob2RcbiAgTW9kZWxbY3R4Lm1ldGhvZF0gPSBmdW5jdGlvbiBTdGF0TWV0aG9kKHJlcSwgZmluaXNoKSB7XG4gICAgLy8gU2V0IG1vZGVsIG5hbWVzXG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0Q29udGFpbmVyKSB8fCAnSW1wb3J0Q29udGFpbmVyJztcbiAgICBjb25zdCBJbXBvcnRMb2dOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRMb2cpIHx8ICdJbXBvcnRMb2cnO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0Q29udGFpbmVyTmFtZV07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRMb2dOYW1lXTtcbiAgICBjb25zdCBjb250YWluZXJOYW1lID0gTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy0nICsgTWF0aC5yb3VuZChEYXRlLm5vdygpKSArICctJyArIE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwMDApO1xuICAgIGlmICghSW1wb3J0Q29udGFpbmVyIHx8ICFJbXBvcnRMb2cpIHtcbiAgICAgIHJldHVybiBmaW5pc2gobmV3IEVycm9yKCcobG9vcGJhY2staW1wb3J0LW1peGluKSBNaXNzaW5nIHJlcXVpcmVkIG1vZGVscywgdmVyaWZ5IHlvdXIgc2V0dXAgYW5kIGNvbmZpZ3VyYXRpb24nKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBDcmVhdGUgY29udGFpbmVyXG4gICAgICAgIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmNyZWF0ZUNvbnRhaW5lcih7IG5hbWU6IGNvbnRhaW5lck5hbWUgfSwgbmV4dCksXG4gICAgICAgIC8vIFVwbG9hZCBGaWxlXG4gICAgICAgIChjb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICByZXEucGFyYW1zLmNvbnRhaW5lciA9IGNvbnRhaW5lck5hbWU7XG4gICAgICAgICAgSW1wb3J0Q29udGFpbmVyLnVwbG9hZChyZXEsIHt9LCBuZXh0KTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGVyc2lzdCBwcm9jZXNzIGluIGRiIGFuZCBydW4gaW4gZm9yayBwcm9jZXNzXG4gICAgICAgIChmaWxlQ29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS50eXBlICE9PSAndGV4dC9jc3YnKSB7XG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihjb250YWluZXJOYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KG5ldyBFcnJvcignVGhlIGZpbGUgeW91IHNlbGVjdGVkIGlzIG5vdCBjc3YgZm9ybWF0JykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBTdG9yZSB0aGUgc3RhdGUgb2YgdGhlIGltcG9ydCBwcm9jZXNzIGluIHRoZSBkYXRhYmFzZVxuICAgICAgICAgIEltcG9ydExvZy5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0ZTogbW9tZW50KCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIG1vZGVsOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBzdGF0dXM6ICdQRU5ESU5HJyxcbiAgICAgICAgICB9LCAoZXJyLCBmaWxlVXBsb2FkKSA9PiBuZXh0KGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkpO1xuICAgICAgICB9LFxuICAgICAgXSwgKGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChlcnIsIGZpbGVDb250YWluZXIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBMYXVuY2ggYSBmb3JrIG5vZGUgcHJvY2VzcyB0aGF0IHdpbGwgaGFuZGxlIHRoZSBpbXBvcnRcbiAgICAgICAgY2hpbGRQcm9jZXNzLmZvcmsoX19kaXJuYW1lICsgJy9wcm9jZXNzZXMvaW1wb3J0LXByb2Nlc3MuanMnLCBbXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgc2NvcGU6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIGZpbGVVcGxvYWRJZDogZmlsZVVwbG9hZC5pZCxcbiAgICAgICAgICAgIHJvb3Q6IE1vZGVsLmFwcC5kYXRhc291cmNlcy5jb250YWluZXIuc2V0dGluZ3Mucm9vdCxcbiAgICAgICAgICAgIGNvbnRhaW5lcjogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGZpbGU6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5uYW1lLFxuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyOiBJbXBvcnRDb250YWluZXJOYW1lLFxuICAgICAgICAgICAgSW1wb3J0TG9nOiBJbXBvcnRMb2dOYW1lLFxuICAgICAgICAgICAgcmVsYXRpb25zOiBjdHgucmVsYXRpb25zXG4gICAgICAgICAgfSldKTtcbiAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChudWxsLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgcmVzb2x2ZShmaWxlQ29udGFpbmVyKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogQ3JlYXRlIGltcG9ydCBtZXRob2QgKE5vdCBBdmFpbGFibGUgdGhyb3VnaCBSRVNUKVxuICAgKiovXG4gIE1vZGVsLmltcG9ydFByb2Nlc3NvciA9IGZ1bmN0aW9uIEltcG9ydE1ldGhvZChjb250YWluZXIsIGZpbGUsIG9wdGlvbnMsIGZpbmlzaCkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gX19kaXJuYW1lICsgJy8uLi8uLi8uLi8nICsgb3B0aW9ucy5yb290ICsgJy8nICsgb3B0aW9ucy5jb250YWluZXIgKyAnLycgKyBvcHRpb25zLmZpbGU7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydENvbnRhaW5lcl07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydExvZ107XG4gICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgIC8vIEdldCBJbXBvcnRMb2dcbiAgICAgIG5leHQgPT4gSW1wb3J0TG9nLmZpbmRCeUlkKG9wdGlvbnMuZmlsZVVwbG9hZElkLCBuZXh0KSxcbiAgICAgIC8vIFNldCBpbXBvcnRVcGxvYWQgc3RhdHVzIGFzIHByb2Nlc3NpbmdcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZyA9IGltcG9ydExvZztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnUFJPQ0VTU0lORyc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgICAvLyBJbXBvcnQgRGF0YVxuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICAvLyBUaGlzIGxpbmUgb3BlbnMgdGhlIGZpbGUgYXMgYSByZWFkYWJsZSBzdHJlYW1cbiAgICAgICAgbGV0IHNlcmllcyA9IFtdO1xuICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpXG4gICAgICAgICAgLnBpcGUoY3N2KCkpXG4gICAgICAgICAgLm9uKCdkYXRhJywgcm93ID0+IHtcbiAgICAgICAgICAgIGkrKztcbiAgICAgICAgICAgIGNvbnN0IG9iaiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICBpZiAocm93W2N0eC5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICBvYmpba2V5XSA9IHJvd1tjdHgubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2Ygb2JqW2tleV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICBzd2l0Y2ggKG9ialtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG1vbWVudChvYmpba2V5XSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gb2JqW2tleV07XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgaWYgKGN0eC5wayAmJiBvYmpbY3R4LnBrXSkgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKCFjdHgucGspIHJldHVybiBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgIE1vZGVsLmZpbmRPbmUoeyB3aGVyZTogcXVlcnkgfSwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgX2tleSBpbiBvYmopIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KF9rZXkpKSBpbnN0YW5jZVtfa2V5XSA9IG9ialtfa2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkgcmV0dXJuIG5leHRGYWxsKG51bGwsIGluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICAgIG9iai5pbXBvcnRJZCA9IG9wdGlvbnMuZmlsZSArICc6JytpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuY3JlYXRlKG9iaiwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICBsZXQgc2V0dXBSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBsaW5rUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICBsZXQgY3JlYXRlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAvLyBJdGVyYXRlcyB0aHJvdWdoIGV4aXN0aW5nIHJlbGF0aW9ucyBpbiBtb2RlbFxuICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbiA9IGZ1bmN0aW9uIHNyKGV4cGVjdGVkUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JlbGF0aW9uIGluIE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zLmhhc093blByb3BlcnR5KGV4aXN0aW5nUmVsYXRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBNYWtlcyBzdXJlIHRoZSByZWxhdGlvbiBleGlzdFxuICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24gPSBmdW5jdGlvbiBlcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZFJlbGF0aW9uID09PSBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgcGFyYWxsZWwucHVzaChuZXh0UGFyYWxsZWwgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2xpbmsnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb2YgcmVsYXRpb24gbmVlZHMgdG8gYmUgZGVmaW5lZCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIFJlbGF0aW9uXG4gICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbiA9IGZ1bmN0aW9uIGNyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVPYmogPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdzdHJpbmcnICYmIHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSBtb21lbnQocm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0ubWFwXSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmouaW1wb3J0SWQgPSBvcHRpb25zLmZpbGUgKyAnOicraTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBMaW5rIFJlbGF0aW9uc1xuICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcHJvcGVydHkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWxFcnIpIHJldHVybiBuZXh0UGFyYWxsZWwocmVsRXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgLyoqIERvZXMgbm90IHdvcmssIGl0IG5lZWRzIHRvIG1vdmVkIHRvIG90aGVyIHBvaW50IGluIHRoZSBmbG93XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIGNyZWF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICoqL1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55VGhyb3VnaCc6XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzQW5kQmVsb25nc1RvTWFueSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2JlbG9uZ3NUbyc6XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXShyZWxJbnN0YW5jZSwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBzb21lIHJlYXNvbiBkb2VzIG5vdCB3b3JrLCBubyBlcnJvcnMgYnV0IG5vIHJlbGF0aW9uc2hpcCBpcyBjcmVhdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBVZ2x5IGZpeCBuZWVkZWQgdG8gYmUgaW1wbGVtZW50ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBhdXRvSWQgPSBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9JZCA9IGF1dG9JZC5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIGF1dG9JZC5zbGljZSgxKSArICdJZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5mb3JlaWduS2V5IHx8IGF1dG9JZF0gPSByZWxJbnN0YW5jZS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycyBpbiBvcHRpb25zLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy5lcnJvcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cuZXJyb3JzLnB1c2goeyByb3c6IHJvdywgbWVzc2FnZTogZXJyIH0pO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSU1QT1JUIEVSUk9SOiAnLCB7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgIHNlcmllcyA9IG51bGw7XG4gICAgICAgICAgICAgIG5leHQoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIC8vIFJlbW92ZSBDb250YWluZXJcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICB9LFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBlcnIgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdEQi1USU1FT1VUJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKCk7XG4gICAgICB9IGVsc2Uge31cbiAgICAgIGZpbmlzaChlcnIpO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogUmVnaXN0ZXIgSW1wb3J0IE1ldGhvZFxuICAgKi9cbiAgTW9kZWwucmVtb3RlTWV0aG9kKGN0eC5tZXRob2QsIHtcbiAgICBodHRwOiB7IHBhdGg6IGN0eC5lbmRwb2ludCwgdmVyYjogJ3Bvc3QnIH0sXG4gICAgYWNjZXB0czogW3tcbiAgICAgIGFyZzogJ3JlcScsXG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIGh0dHA6IHsgc291cmNlOiAncmVxJyB9LFxuICAgIH1dLFxuICAgIHJldHVybnM6IHsgdHlwZTogJ29iamVjdCcsIHJvb3Q6IHRydWUgfSxcbiAgICBkZXNjcmlwdGlvbjogY3R4LmRlc2NyaXB0aW9uLFxuICB9KTtcbn07XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=
