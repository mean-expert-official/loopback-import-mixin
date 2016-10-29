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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O2tCQXVCZSxVQUFDLEtBQUQsRUFBUSxHQUFSLEVBQWdCO0FBQzdCLE1BQUksS0FBSixHQUFZLEtBQVosQ0FENkI7QUFFN0IsTUFBSSxNQUFKLEdBQWEsSUFBSSxNQUFKLElBQWMsUUFBZCxDQUZnQjtBQUc3QixNQUFJLFFBQUosR0FBZSxJQUFJLFFBQUosSUFBZ0IsQ0FBQyxHQUFELEVBQU0sSUFBSSxNQUFKLENBQU4sQ0FBa0IsSUFBbEIsQ0FBdUIsRUFBdkIsQ0FBaEI7O0FBSGMsT0FLN0IsQ0FBTSxJQUFJLE1BQUosQ0FBTixHQUFvQixTQUFTLFVBQVQsQ0FBb0IsR0FBcEIsRUFBeUIsTUFBekIsRUFBaUM7O0FBRW5ELFFBQU0sc0JBQXNCLEdBQUMsQ0FBSSxNQUFKLElBQWMsSUFBSSxNQUFKLENBQVcsZUFBWCxJQUErQixpQkFBOUMsQ0FGdUI7QUFHbkQsUUFBTSxnQkFBZ0IsR0FBQyxDQUFJLE1BQUosSUFBYyxJQUFJLE1BQUosQ0FBVyxTQUFYLElBQXlCLFdBQXhDLENBSDZCO0FBSW5ELFFBQU0sa0JBQWtCLE1BQU0sR0FBTixDQUFVLE1BQVYsQ0FBaUIsbUJBQWpCLENBQWxCLENBSjZDO0FBS25ELFFBQU0sWUFBWSxNQUFNLEdBQU4sQ0FBVSxNQUFWLENBQWlCLGFBQWpCLENBQVosQ0FMNkM7QUFNbkQsUUFBTSxnQkFBZ0IsTUFBTSxVQUFOLENBQWlCLElBQWpCLEdBQXdCLEdBQXhCLEdBQThCLEtBQUssS0FBTCxDQUFXLEtBQUssR0FBTCxFQUFYLENBQTlCLEdBQXVELEdBQXZELEdBQTZELEtBQUssS0FBTCxDQUFXLEtBQUssTUFBTCxLQUFnQixJQUFoQixDQUF4RSxDQU42QjtBQU9uRCxRQUFJLENBQUMsZUFBRCxJQUFvQixDQUFDLFNBQUQsRUFBWTtBQUNsQyxhQUFPLE9BQU8sSUFBSSxLQUFKLENBQVUsc0ZBQVYsQ0FBUCxDQUFQLENBRGtDO0tBQXBDO0FBR0EsV0FBTyxzQkFBWSxVQUFDLE9BQUQsRUFBVSxNQUFWLEVBQXFCO0FBQ3RDLHNCQUFNLFNBQU4sQ0FBZ0I7O0FBRWQ7ZUFBUSxnQkFBZ0IsZUFBaEIsQ0FBZ0MsRUFBRSxNQUFNLGFBQU4sRUFBbEMsRUFBeUQsSUFBekQ7T0FBUjs7QUFFQSxnQkFBQyxTQUFELEVBQVksSUFBWixFQUFxQjtBQUNuQixZQUFJLE1BQUosQ0FBVyxTQUFYLEdBQXVCLGFBQXZCLENBRG1CO0FBRW5CLHdCQUFnQixNQUFoQixDQUF1QixHQUF2QixFQUE0QixFQUE1QixFQUFnQyxJQUFoQyxFQUZtQjtPQUFyQjs7QUFLQSxnQkFBQyxhQUFELEVBQWdCLElBQWhCLEVBQXlCO0FBQ3ZCLFlBQUksY0FBYyxLQUFkLENBQW9CLElBQXBCLENBQXlCLENBQXpCLEVBQTRCLElBQTVCLEtBQXFDLFVBQXJDLEVBQWlEO0FBQ25ELDBCQUFnQixnQkFBaEIsQ0FBaUMsYUFBakMsRUFEbUQ7QUFFbkQsaUJBQU8sS0FBSyxJQUFJLEtBQUosQ0FBVSx5Q0FBVixDQUFMLENBQVAsQ0FGbUQ7U0FBckQ7O0FBRHVCLGlCQU12QixDQUFVLE1BQVYsQ0FBaUI7QUFDZixnQkFBTSx3QkFBUyxXQUFULEVBQU47QUFDQSxpQkFBTyxNQUFNLFVBQU4sQ0FBaUIsSUFBakI7QUFDUCxrQkFBUSxTQUFSO1NBSEYsRUFJRyxVQUFDLEdBQUQsRUFBTSxVQUFOO2lCQUFxQixLQUFLLEdBQUwsRUFBVSxhQUFWLEVBQXlCLFVBQXpCO1NBQXJCLENBSkgsQ0FOdUI7T0FBekIsQ0FURixFQXFCRyxVQUFDLEdBQUQsRUFBTSxhQUFOLEVBQXFCLFVBQXJCLEVBQW9DO0FBQ3JDLFlBQUksR0FBSixFQUFTO0FBQ1AsY0FBSSxPQUFPLE1BQVAsS0FBa0IsVUFBbEIsRUFBOEIsT0FBTyxHQUFQLEVBQVksYUFBWixFQUFsQztBQUNBLGlCQUFPLE9BQU8sR0FBUCxDQUFQLENBRk87U0FBVDs7QUFEcUMsK0JBTXJDLENBQWEsSUFBYixDQUFrQixZQUFZLDhCQUFaLEVBQTRDLENBQzVELHlCQUFlO0FBQ2IsaUJBQU8sTUFBTSxVQUFOLENBQWlCLElBQWpCO0FBQ1Asd0JBQWMsV0FBVyxFQUFYO0FBQ2QsZ0JBQU0sTUFBTSxHQUFOLENBQVUsV0FBVixDQUFzQixTQUF0QixDQUFnQyxRQUFoQyxDQUF5QyxJQUF6QztBQUNOLHFCQUFXLGNBQWMsS0FBZCxDQUFvQixJQUFwQixDQUF5QixDQUF6QixFQUE0QixTQUE1QjtBQUNYLGdCQUFNLGNBQWMsS0FBZCxDQUFvQixJQUFwQixDQUF5QixDQUF6QixFQUE0QixJQUE1QjtBQUNOLDJCQUFpQixtQkFBakI7QUFDQSxxQkFBVyxhQUFYO0FBQ0EscUJBQVcsSUFBSSxTQUFKO1NBUmIsQ0FENEQsQ0FBOUQsRUFOcUM7QUFpQnJDLFlBQUksT0FBTyxNQUFQLEtBQWtCLFVBQWxCLEVBQThCLE9BQU8sSUFBUCxFQUFhLGFBQWIsRUFBbEM7QUFDQSxnQkFBUSxhQUFSLEVBbEJxQztPQUFwQyxDQXJCSCxDQURzQztLQUFyQixDQUFuQixDQVZtRDtHQUFqQzs7OztBQUxTLE9BOEQ3QixDQUFNLGVBQU4sR0FBd0IsU0FBUyxZQUFULENBQXNCLFNBQXRCLEVBQWlDLElBQWpDLEVBQXVDLE9BQXZDLEVBQWdELE1BQWhELEVBQXdEO0FBQzlFLFFBQU0sV0FBVyxZQUFZLFlBQVosR0FBMkIsUUFBUSxJQUFSLEdBQWUsR0FBMUMsR0FBZ0QsUUFBUSxTQUFSLEdBQW9CLEdBQXBFLEdBQTBFLFFBQVEsSUFBUixDQURiO0FBRTlFLFFBQU0sa0JBQWtCLE1BQU0sR0FBTixDQUFVLE1BQVYsQ0FBaUIsUUFBUSxlQUFSLENBQW5DLENBRndFO0FBRzlFLFFBQU0sWUFBWSxNQUFNLEdBQU4sQ0FBVSxNQUFWLENBQWlCLFFBQVEsU0FBUixDQUE3QixDQUh3RTtBQUk5RSxvQkFBTSxTQUFOLENBQWdCOztBQUVkO2FBQVEsVUFBVSxRQUFWLENBQW1CLFFBQVEsWUFBUixFQUFzQixJQUF6QztLQUFSOztBQUVBLGNBQUMsU0FBRCxFQUFZLElBQVosRUFBcUI7QUFDbkIsVUFBSSxTQUFKLEdBQWdCLFNBQWhCLENBRG1CO0FBRW5CLFVBQUksU0FBSixDQUFjLE1BQWQsR0FBdUIsWUFBdkIsQ0FGbUI7QUFHbkIsVUFBSSxTQUFKLENBQWMsSUFBZCxDQUFtQixJQUFuQixFQUhtQjtLQUFyQjs7QUFNQSxjQUFDLFNBQUQsRUFBWSxJQUFaLEVBQXFCOztBQUVuQixVQUFJLFNBQVMsRUFBVCxDQUZlO0FBR25CLFVBQUksSUFBSSxDQUFKLENBSGU7QUFJbkIsbUJBQUcsZ0JBQUgsQ0FBb0IsUUFBcEIsRUFDRyxJQURILENBQ1EsMEJBRFIsRUFFRyxFQUZILENBRU0sTUFGTixFQUVjLGVBQU87QUFDakIsWUFEaUI7QUFFakIsWUFBTSxNQUFNLEVBQU4sQ0FGVztBQUdqQixhQUFLLElBQU0sR0FBTixJQUFhLElBQUksR0FBSixFQUFTO0FBQ3pCLGNBQUksUUFBUyxzQkFBTyxJQUFJLEdBQUosQ0FBUSxHQUFSLEVBQVAsS0FBd0IsUUFBeEIsQ0FEWTtBQUV6QixjQUFJLFlBQVksUUFBUSxJQUFJLEdBQUosQ0FBUSxHQUFSLEVBQWEsR0FBYixHQUFtQixJQUFJLEdBQUosQ0FBUSxHQUFSLENBQTNCLENBRlM7QUFHekIsY0FBSSxJQUFJLFNBQUosQ0FBSixFQUFvQjtBQUNsQixnQkFBSSxHQUFKLElBQVcsSUFBSSxTQUFKLENBQVgsQ0FEa0I7QUFFbEIsZ0JBQUksS0FBSixFQUFXO0FBQ1Qsc0JBQVEsSUFBSSxHQUFKLENBQVEsR0FBUixFQUFhLElBQWI7QUFDUixxQkFBSyxNQUFMO0FBQ0Usc0JBQUksR0FBSixJQUFXLHNCQUFPLElBQUksR0FBSixDQUFQLEVBQWlCLFlBQWpCLEVBQStCLFdBQS9CLEVBQVgsQ0FERjtBQUVFLHdCQUZGO0FBREE7QUFLRSxzQkFBSSxHQUFKLElBQVcsSUFBSSxHQUFKLENBQVgsQ0FERjtBQUpBLGVBRFM7YUFBWDtXQUZGO1NBSEY7QUFnQkEsWUFBTSxRQUFRLEVBQVIsQ0FuQlc7QUFvQmpCLFlBQUksSUFBSSxFQUFKLElBQVUsSUFBSSxJQUFJLEVBQUosQ0FBZCxFQUF1QixNQUFNLElBQUksRUFBSixDQUFOLEdBQWdCLElBQUksSUFBSSxFQUFKLENBQXBCLENBQTNCOztBQXBCaUIsY0FzQmpCLENBQU8sSUFBUCxDQUFZLHFCQUFhO0FBQ3ZCLDBCQUFNLFNBQU4sQ0FBZ0I7O0FBRWQsOEJBQVk7QUFDVixnQkFBSSxDQUFDLElBQUksRUFBSixFQUFRLE9BQU8sU0FBUyxJQUFULEVBQWUsSUFBZixDQUFQLENBQWI7QUFDQSxrQkFBTSxPQUFOLENBQWMsRUFBRSxPQUFPLEtBQVAsRUFBaEIsRUFBZ0MsUUFBaEMsRUFGVTtXQUFaOztBQUtBLG9CQUFDLFFBQUQsRUFBVyxRQUFYLEVBQXdCO0FBQ3RCLGdCQUFJLFFBQUosRUFBYztBQUNaLGtCQUFJLFNBQUosQ0FBYyxRQUFkLEdBQXlCLE1BQU0sT0FBTixDQUFjLElBQUksU0FBSixDQUFjLFFBQWQsQ0FBZCxHQUF3QyxJQUFJLFNBQUosQ0FBYyxRQUFkLEdBQXlCLEVBQWpFLENBRGI7QUFFWixtQkFBSyxJQUFNLElBQU4sSUFBYyxHQUFuQixFQUF3QjtBQUN0QixvQkFBSSxJQUFJLGNBQUosQ0FBbUIsSUFBbkIsQ0FBSixFQUE4QixTQUFTLElBQVQsSUFBaUIsSUFBSSxJQUFKLENBQWpCLENBQTlCO2VBREY7QUFHQSx1QkFBUyxJQUFULENBQWMsUUFBZCxFQUxZO2FBQWQsTUFNTztBQUNMLHVCQUFTLElBQVQsRUFBZSxJQUFmLEVBREs7YUFOUDtXQURGOztBQVlBLG9CQUFDLFFBQUQsRUFBVyxRQUFYLEVBQXdCO0FBQ3RCLGdCQUFJLFFBQUosRUFBYyxPQUFPLFNBQVMsSUFBVCxFQUFlLFFBQWYsQ0FBUCxDQUFkO0FBQ0EsZ0JBQUksUUFBSixHQUFlLFFBQVEsSUFBUixHQUFlLEdBQWYsR0FBbUIsQ0FBbkIsQ0FGTztBQUd0QixrQkFBTSxNQUFOLENBQWEsR0FBYixFQUFrQixRQUFsQixFQUhzQjtXQUF4Qjs7QUFNQSxvQkFBQyxRQUFELEVBQVcsUUFBWCxFQUF3Qjs7QUFFdEIsZ0JBQU0sV0FBVyxFQUFYLENBRmdCO0FBR3RCLGdCQUFJLHNCQUFKLENBSHNCO0FBSXRCLGdCQUFJLHVCQUFKLENBSnNCO0FBS3RCLGdCQUFJLHFCQUFKLENBTHNCO0FBTXRCLGdCQUFJLHVCQUFKOztBQU5zQix5QkFRdEIsR0FBZ0IsU0FBUyxFQUFULENBQVksZ0JBQVosRUFBOEI7QUFDNUMsbUJBQUssSUFBTSxnQkFBTixJQUEwQixNQUFNLFVBQU4sQ0FBaUIsUUFBakIsQ0FBMEIsU0FBMUIsRUFBcUM7QUFDbEUsb0JBQUksTUFBTSxVQUFOLENBQWlCLFFBQWpCLENBQTBCLFNBQTFCLENBQW9DLGNBQXBDLENBQW1ELGdCQUFuRCxDQUFKLEVBQTBFO0FBQ3hFLGlDQUFlLGdCQUFmLEVBQWlDLGdCQUFqQyxFQUR3RTtpQkFBMUU7ZUFERjthQURjOztBQVJNLDBCQWdCdEIsR0FBaUIsU0FBUyxFQUFULENBQVksZ0JBQVosRUFBOEIsZ0JBQTlCLEVBQWdEO0FBQy9ELGtCQUFJLHFCQUFxQixnQkFBckIsRUFBdUM7QUFDekMseUJBQVMsSUFBVCxDQUFjLHdCQUFnQjtBQUM1QiwwQkFBUSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxJQUFoQztBQUNSLHlCQUFLLE1BQUw7QUFDRSxtQ0FDRSxnQkFERixFQUVFLGdCQUZGLEVBR0UsWUFIRixFQURGO0FBTUUsNEJBTkY7QUFEQSx5QkFRSyxRQUFMO0FBQ0UscUNBQ0UsZ0JBREYsRUFFRSxnQkFGRixFQUdFLFlBSEYsRUFERjtBQU1FLDRCQU5GO0FBUkE7QUFnQkUsNEJBQU0sSUFBSSxLQUFKLENBQVUsc0NBQVYsQ0FBTixDQURGO0FBZkEsbUJBRDRCO2lCQUFoQixDQUFkLENBRHlDO2VBQTNDO2FBRGU7O0FBaEJLLDBCQXlDdEIsR0FBaUIsU0FBUyxFQUFULENBQVksZ0JBQVosRUFBOEIsZ0JBQTlCLEVBQWdELFlBQWhELEVBQThEO0FBQzdFLGtCQUFNLFlBQVksRUFBWixDQUR1RTtBQUU3RSxtQkFBSyxJQUFNLEtBQU4sSUFBYSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxFQUFxQztBQUNyRCxvQkFBSSxPQUFPLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEdBQWhDLENBQW9DLEtBQXBDLENBQVAsS0FBb0QsUUFBcEQsSUFBZ0UsSUFBSSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxDQUFKLENBQWhFLEVBQStHO0FBQ2pILDRCQUFVLEtBQVYsSUFBaUIsSUFBSSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxDQUFKLENBQWpCLENBRGlIO2lCQUFuSCxNQUVPLElBQUksc0JBQU8sSUFBSSxTQUFKLENBQWMsZ0JBQWQsRUFBZ0MsR0FBaEMsQ0FBb0MsS0FBcEMsRUFBUCxLQUFvRCxRQUFwRCxFQUE4RDtBQUN2RSwwQkFBUSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxFQUF5QyxJQUF6QztBQUNSLHlCQUFLLE1BQUw7QUFDRSxnQ0FBVSxLQUFWLElBQWlCLHNCQUFPLElBQUksSUFBSSxTQUFKLENBQWMsZ0JBQWQsRUFBZ0MsR0FBaEMsQ0FBb0MsS0FBcEMsRUFBeUMsR0FBekMsQ0FBWCxFQUEwRCxZQUExRCxFQUF3RSxXQUF4RSxFQUFqQixDQURGO0FBRUUsNEJBRkY7QUFEQTtBQUtFLGdDQUFVLEtBQVYsSUFBaUIsSUFBSSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxHQUFoQyxDQUFvQyxLQUFwQyxDQUFKLENBQWpCLENBREY7QUFKQSxtQkFEdUU7aUJBQWxFO2VBSFQ7QUFhQSx3QkFBVSxRQUFWLEdBQXFCLFFBQVEsSUFBUixHQUFlLEdBQWYsR0FBbUIsQ0FBbkIsQ0Fmd0Q7QUFnQjdFLHVCQUFTLGdCQUFULEVBQTJCLE1BQTNCLENBQWtDLFNBQWxDLEVBQTZDLFlBQTdDLEVBaEI2RTthQUE5RDs7QUF6Q0ssd0JBNER0QixHQUFlLFNBQVMsRUFBVCxDQUFZLGdCQUFaLEVBQThCLGdCQUE5QixFQUFnRCxZQUFoRCxFQUE4RDtBQUMzRSxrQkFBTSxTQUFTLEVBQUUsT0FBTyxFQUFQLEVBQVgsQ0FEcUU7QUFFM0UsbUJBQUssSUFBTSxRQUFOLElBQWtCLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEtBQWhDLEVBQXVDO0FBQzVELG9CQUFJLElBQUksU0FBSixDQUFjLGdCQUFkLEVBQWdDLEtBQWhDLENBQXNDLGNBQXRDLENBQXFELFFBQXJELENBQUosRUFBb0U7QUFDbEUseUJBQU8sS0FBUCxDQUFhLFFBQWIsSUFBeUIsSUFBSSxJQUFJLFNBQUosQ0FBYyxnQkFBZCxFQUFnQyxLQUFoQyxDQUFzQyxRQUF0QyxDQUFKLENBQXpCLENBRGtFO2lCQUFwRTtlQURGO0FBS0Esb0JBQU0sR0FBTixDQUFVLE1BQVYsQ0FBaUIsTUFBTSxVQUFOLENBQWlCLFFBQWpCLENBQTBCLFNBQTFCLENBQW9DLGdCQUFwQyxFQUFzRCxLQUF0RCxDQUFqQixDQUE4RSxPQUE5RSxDQUFzRixNQUF0RixFQUE4RixVQUFDLE1BQUQsRUFBUyxXQUFULEVBQXlCO0FBQ3JILG9CQUFJLE1BQUosRUFBWSxPQUFPLGFBQWEsTUFBYixDQUFQLENBQVo7QUFDQSxvQkFBSSxDQUFDLFdBQUQsRUFBYztBQUNoQixzQkFBSSxTQUFKLENBQWMsUUFBZCxHQUF5QixNQUFNLE9BQU4sQ0FBYyxJQUFJLFNBQUosQ0FBYyxRQUFkLENBQWQsR0FBd0MsSUFBSSxTQUFKLENBQWMsUUFBZCxHQUF5QixFQUFqRSxDQURUO0FBRWhCLHNCQUFJLFNBQUosQ0FBYyxRQUFkLENBQXVCLElBQXZCLENBQTRCO0FBQzFCLHlCQUFLLEdBQUw7QUFDQSw2QkFBUyxNQUFNLFVBQU4sQ0FBaUIsSUFBakIsR0FBd0IsR0FBeEIsR0FBOEIsZ0JBQTlCLEdBQWlELDBDQUFqRCxHQUE4RixnQkFBOUY7bUJBRlgsRUFGZ0I7QUFNaEIseUJBQU8sY0FBUCxDQU5nQjtpQkFBbEI7QUFRQSx3QkFBUSxNQUFNLFVBQU4sQ0FBaUIsUUFBakIsQ0FBMEIsU0FBMUIsQ0FBb0MsZ0JBQXBDLEVBQXNELElBQXREO0FBQ1IsdUJBQUssU0FBTDs7Ozs7Ozs7Ozs7Ozs7QUFjRSxtQ0FkRjtBQWVFLDBCQWZGO0FBREEsdUJBaUJLLGdCQUFMLENBakJBO0FBa0JBLHVCQUFLLHFCQUFMO0FBQ0UsNkJBQVMsZ0JBQVQsRUFBMkIsUUFBM0IsQ0FBb0MsWUFBWSxFQUFaLEVBQWdCLFVBQUMsT0FBRCxFQUFVLEtBQVYsRUFBb0I7QUFDdEUsMEJBQUksS0FBSixFQUFXO0FBQ1QsNEJBQUksU0FBSixDQUFjLFFBQWQsR0FBeUIsTUFBTSxPQUFOLENBQWMsSUFBSSxTQUFKLENBQWMsUUFBZCxDQUFkLEdBQXdDLElBQUksU0FBSixDQUFjLFFBQWQsR0FBeUIsRUFBakUsQ0FEaEI7QUFFVCw0QkFBSSxTQUFKLENBQWMsUUFBZCxDQUF1QixJQUF2QixDQUE0QjtBQUMxQiwrQkFBSyxHQUFMO0FBQ0EsbUNBQVMsTUFBTSxVQUFOLENBQWlCLElBQWpCLEdBQXdCLEdBQXhCLEdBQThCLGdCQUE5QixHQUFpRCxxQ0FBakQ7eUJBRlgsRUFGUztBQU1ULCtCQUFPLGNBQVAsQ0FOUzt1QkFBWDtBQVFBLCtCQUFTLGdCQUFULEVBQTJCLEdBQTNCLENBQStCLFdBQS9CLEVBQTRDLFlBQTVDLEVBVHNFO3FCQUFwQixDQUFwRCxDQURGO0FBWUUsMEJBWkY7QUFsQkEsdUJBK0JLLFdBQUw7Ozs7QUFJRSx3QkFBSSxTQUFTLE1BQU0sVUFBTixDQUFpQixRQUFqQixDQUEwQixTQUExQixDQUFvQyxnQkFBcEMsRUFBc0QsS0FBdEQsQ0FKZjtBQUtFLDZCQUFTLE9BQU8sTUFBUCxDQUFjLENBQWQsRUFBaUIsV0FBakIsS0FBaUMsT0FBTyxLQUFQLENBQWEsQ0FBYixDQUFqQyxHQUFtRCxJQUFuRCxDQUxYO0FBTUUsNkJBQVMsTUFBTSxVQUFOLENBQWlCLFFBQWpCLENBQTBCLFNBQTFCLENBQW9DLGdCQUFwQyxFQUFzRCxVQUF0RCxJQUFvRSxNQUFwRSxDQUFULEdBQXVGLFlBQVksRUFBWixDQU56RjtBQU9FLDZCQUFTLElBQVQsQ0FBYyxZQUFkLEVBUEY7QUFRRSwwQkFSRjtBQS9CQTtBQXlDRSxtQ0FERjtBQXhDQSxpQkFWcUg7ZUFBekIsQ0FBOUYsQ0FQMkU7YUFBOUQ7O0FBNURPLGlCQTJIakIsSUFBTSxHQUFOLElBQWEsUUFBUSxTQUFSLEVBQW1CO0FBQ25DLGtCQUFJLFFBQVEsU0FBUixDQUFrQixjQUFsQixDQUFpQyxHQUFqQyxDQUFKLEVBQTJDO0FBQ3pDLDhCQUFjLEdBQWQsRUFEeUM7ZUFBM0M7YUFERjs7QUEzSHNCLDJCQWlJdEIsQ0FBTSxRQUFOLENBQWUsUUFBZixFQUF5QixRQUF6QixFQWpJc0I7V0FBeEIsQ0F6QkY7O0FBNkpHLHlCQUFPO0FBQ1IsZ0JBQUksR0FBSixFQUFTOztBQUVQLGtCQUFJLE1BQU0sT0FBTixDQUFjLElBQUksU0FBSixDQUFjLE1BQWQsQ0FBbEIsRUFBeUM7QUFDdkMsb0JBQUksU0FBSixDQUFjLE1BQWQsQ0FBcUIsSUFBckIsQ0FBMEIsRUFBRSxLQUFLLEdBQUwsRUFBVSxTQUFTLEdBQVQsRUFBdEMsRUFEdUM7ZUFBekMsTUFFTztBQUNMLHdCQUFRLEtBQVIsQ0FBYyxnQkFBZCxFQUFnQyxFQUFFLEtBQUssR0FBTCxFQUFVLFNBQVMsR0FBVCxFQUE1QyxFQURLO2VBRlA7YUFGRjtBQVFBLHdCQVRRO1dBQVAsQ0E3SkgsQ0FEdUI7U0FBYixDQUFaLENBdEJpQjtPQUFQLENBRmQsQ0FtTUcsRUFuTUgsQ0FtTU0sS0FuTU4sRUFtTWEsWUFBTTtBQUNmLHdCQUFNLE1BQU4sQ0FBYSxNQUFiLEVBQXFCLFVBQVUsR0FBVixFQUFlO0FBQ2xDLG1CQUFTLElBQVQsQ0FEa0M7QUFFbEMsZUFBSyxHQUFMLEVBRmtDO1NBQWYsQ0FBckIsQ0FEZTtPQUFOLENBbk1iLENBSm1CO0tBQXJCOztBQStNQSxvQkFBUTtBQUNOLGNBQVEsR0FBUixDQUFZLGlDQUFaLEVBQStDLFFBQVEsU0FBUixDQUEvQyxDQURNO0FBRU4sc0JBQWdCLGdCQUFoQixDQUFpQyxRQUFRLFNBQVIsRUFBbUIsSUFBcEQsRUFGTTtLQUFSOztBQUtBLG9CQUFRO0FBQ04sVUFBSSxTQUFKLENBQWMsTUFBZCxHQUF1QixVQUF2QixDQURNO0FBRU4sVUFBSSxTQUFKLENBQWMsSUFBZCxDQUFtQixJQUFuQixFQUZNO0tBQVIsQ0E5TkYsRUFrT0csZUFBTztBQUNSLFVBQUksR0FBSixFQUFTO0FBQ1AsZ0JBQVEsR0FBUixDQUFZLGlDQUFaLEVBQStDLFFBQVEsU0FBUixDQUEvQyxDQURPO0FBRVAsd0JBQWdCLGdCQUFoQixDQUFpQyxRQUFRLFNBQVIsRUFBbUIsSUFBcEQsRUFGTztBQUdQLGNBQU0sSUFBSSxLQUFKLENBQVUsWUFBVixDQUFOOztBQUhPLE9BQVQsTUFLTyxFQUxQO0FBTUEsYUFBTyxHQUFQLEVBUFE7S0FBUCxDQWxPSCxDQUo4RTtHQUF4RDs7OztBQTlESyxPQWlUN0IsQ0FBTSxZQUFOLENBQW1CLElBQUksTUFBSixFQUFZO0FBQzdCLFVBQU0sRUFBRSxNQUFNLElBQUksUUFBSixFQUFjLE1BQU0sTUFBTixFQUE1QjtBQUNBLGFBQVMsQ0FBQztBQUNSLFdBQUssS0FBTDtBQUNBLFlBQU0sUUFBTjtBQUNBLFlBQU0sRUFBRSxRQUFRLEtBQVIsRUFBUjtLQUhPLENBQVQ7QUFLQSxhQUFTLEVBQUUsTUFBTSxRQUFOLEVBQWdCLE1BQU0sSUFBTixFQUEzQjtBQUNBLGlCQUFhLElBQUksV0FBSjtHQVJmLEVBalQ2QjtDQUFoQiIsImZpbGUiOiJpbXBvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCBjc3YgZnJvbSAnY3N2LXBhcnNlcic7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuLy8gaW1wb3J0IERhdGFTb3VyY2VCdWlsZGVyIGZyb20gJy4vYnVpbGRlcnMvZGF0YXNvdXJjZS1idWlsZGVyJztcbi8qKlxuICAqIEJ1bGsgSW1wb3J0IE1peGluXG4gICogQEF1dGhvciBKb25hdGhhbiBDYXNhcnJ1Ymlhc1xuICAqIEBTZWUgPGh0dHBzOi8vdHdpdHRlci5jb20vam9obmNhc2FycnViaWFzPlxuICAqIEBTZWUgPGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBAU2VlIDxodHRwczovL2dpdGh1Yi5jb20vam9uYXRoYW4tY2FzYXJydWJpYXMvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBEZXNjcmlwdGlvblxuICAqXG4gICogVGhlIGZvbGxvd2luZyBtaXhpbiB3aWxsIGFkZCBidWxrIGltcG9ydGluZyBmdW5jdGlvbmFsbGl0eSB0byBtb2RlbHMgd2hpY2ggaW5jbHVkZXNcbiAgKiB0aGlzIG1vZHVsZS5cbiAgKlxuICAqIERlZmF1bHQgQ29uZmlndXJhdGlvblxuICAqXG4gICogXCJJbXBvcnRcIjoge1xuICAqICAgXCJtb2RlbHNcIjoge1xuICAqICAgICBcIkltcG9ydENvbnRhaW5lclwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0TG9nXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5cbmV4cG9ydCBkZWZhdWx0IChNb2RlbCwgY3R4KSA9PiB7XG4gIGN0eC5Nb2RlbCA9IE1vZGVsO1xuICBjdHgubWV0aG9kID0gY3R4Lm1ldGhvZCB8fCAnaW1wb3J0JztcbiAgY3R4LmVuZHBvaW50ID0gY3R4LmVuZHBvaW50IHx8IFsnLycsIGN0eC5tZXRob2RdLmpvaW4oJycpO1xuICAvLyBDcmVhdGUgZHluYW1pYyBzdGF0aXN0aWMgbWV0aG9kXG4gIE1vZGVsW2N0eC5tZXRob2RdID0gZnVuY3Rpb24gU3RhdE1ldGhvZChyZXEsIGZpbmlzaCkge1xuICAgIC8vIFNldCBtb2RlbCBuYW1lc1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lck5hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydENvbnRhaW5lcikgfHwgJ0ltcG9ydENvbnRhaW5lcic7XG4gICAgY29uc3QgSW1wb3J0TG9nTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0TG9nKSB8fCAnSW1wb3J0TG9nJztcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydENvbnRhaW5lck5hbWVdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0TG9nTmFtZV07XG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICctJyArIE1hdGgucm91bmQoRGF0ZS5ub3coKSkgKyAnLScgKyBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcbiAgICBpZiAoIUltcG9ydENvbnRhaW5lciB8fCAhSW1wb3J0TG9nKSB7XG4gICAgICByZXR1cm4gZmluaXNoKG5ldyBFcnJvcignKGxvb3BiYWNrLWltcG9ydC1taXhpbikgTWlzc2luZyByZXF1aXJlZCBtb2RlbHMsIHZlcmlmeSB5b3VyIHNldHVwIGFuZCBjb25maWd1cmF0aW9uJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgLy8gQ3JlYXRlIGNvbnRhaW5lclxuICAgICAgICBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5jcmVhdGVDb250YWluZXIoeyBuYW1lOiBjb250YWluZXJOYW1lIH0sIG5leHQpLFxuICAgICAgICAvLyBVcGxvYWQgRmlsZVxuICAgICAgICAoY29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgcmVxLnBhcmFtcy5jb250YWluZXIgPSBjb250YWluZXJOYW1lO1xuICAgICAgICAgIEltcG9ydENvbnRhaW5lci51cGxvYWQocmVxLCB7fSwgbmV4dCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBlcnNpc3QgcHJvY2VzcyBpbiBkYiBhbmQgcnVuIGluIGZvcmsgcHJvY2Vzc1xuICAgICAgICAoZmlsZUNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0udHlwZSAhPT0gJ3RleHQvY3N2Jykge1xuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIoY29udGFpbmVyTmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gbmV4dChuZXcgRXJyb3IoJ1RoZSBmaWxlIHlvdSBzZWxlY3RlZCBpcyBub3QgY3N2IGZvcm1hdCcpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gU3RvcmUgdGhlIHN0YXRlIG9mIHRoZSBpbXBvcnQgcHJvY2VzcyBpbiB0aGUgZGF0YWJhc2VcbiAgICAgICAgICBJbXBvcnRMb2cuY3JlYXRlKHtcbiAgICAgICAgICAgIGRhdGU6IG1vbWVudCgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBtb2RlbDogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgc3RhdHVzOiAnUEVORElORycsXG4gICAgICAgICAgfSwgKGVyciwgZmlsZVVwbG9hZCkgPT4gbmV4dChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpKTtcbiAgICAgICAgfSxcbiAgICAgIF0sIChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2goZXJyLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTGF1bmNoIGEgZm9yayBub2RlIHByb2Nlc3MgdGhhdCB3aWxsIGhhbmRsZSB0aGUgaW1wb3J0XG4gICAgICAgIGNoaWxkUHJvY2Vzcy5mb3JrKF9fZGlybmFtZSArICcvcHJvY2Vzc2VzL2ltcG9ydC1wcm9jZXNzLmpzJywgW1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHNjb3BlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBmaWxlVXBsb2FkSWQ6IGZpbGVVcGxvYWQuaWQsXG4gICAgICAgICAgICByb290OiBNb2RlbC5hcHAuZGF0YXNvdXJjZXMuY29udGFpbmVyLnNldHRpbmdzLnJvb3QsXG4gICAgICAgICAgICBjb250YWluZXI6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5jb250YWluZXIsXG4gICAgICAgICAgICBmaWxlOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0ubmFtZSxcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lcjogSW1wb3J0Q29udGFpbmVyTmFtZSxcbiAgICAgICAgICAgIEltcG9ydExvZzogSW1wb3J0TG9nTmFtZSxcbiAgICAgICAgICAgIHJlbGF0aW9uczogY3R4LnJlbGF0aW9uc1xuICAgICAgICAgIH0pXSk7XG4gICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2gobnVsbCwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgIHJlc29sdmUoZmlsZUNvbnRhaW5lcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIENyZWF0ZSBpbXBvcnQgbWV0aG9kIChOb3QgQXZhaWxhYmxlIHRocm91Z2ggUkVTVClcbiAgICoqL1xuICBNb2RlbC5pbXBvcnRQcm9jZXNzb3IgPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IF9fZGlybmFtZSArICcvLi4vLi4vLi4vJyArIG9wdGlvbnMucm9vdCArICcvJyArIG9wdGlvbnMuY29udGFpbmVyICsgJy8nICsgb3B0aW9ucy5maWxlO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRDb250YWluZXJdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRMb2ddO1xuICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAvLyBHZXQgSW1wb3J0TG9nXG4gICAgICBuZXh0ID0+IEltcG9ydExvZy5maW5kQnlJZChvcHRpb25zLmZpbGVVcGxvYWRJZCwgbmV4dCksXG4gICAgICAvLyBTZXQgaW1wb3J0VXBsb2FkIHN0YXR1cyBhcyBwcm9jZXNzaW5nXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cgPSBpbXBvcnRMb2c7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ1BST0NFU1NJTkcnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgICAgLy8gSW1wb3J0IERhdGFcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgLy8gVGhpcyBsaW5lIG9wZW5zIHRoZSBmaWxlIGFzIGEgcmVhZGFibGUgc3RyZWFtXG4gICAgICAgIGxldCBzZXJpZXMgPSBbXTtcbiAgICAgICAgbGV0IGkgPSAwO1xuICAgICAgICBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKVxuICAgICAgICAgIC5waXBlKGNzdigpKVxuICAgICAgICAgIC5vbignZGF0YScsIHJvdyA9PiB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBjb25zdCBvYmogPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGN0eC5tYXApIHtcbiAgICAgICAgICAgICAgbGV0IGlzT2JqID0gKHR5cGVvZiBjdHgubWFwW2tleV0gPT09ICdvYmplY3QnKTtcbiAgICAgICAgICAgICAgbGV0IGNvbHVtbktleSA9IGlzT2JqID8gY3R4Lm1hcFtrZXldLm1hcCA6IGN0eC5tYXBba2V5XTtcbiAgICAgICAgICAgICAgaWYgKHJvd1tjb2x1bW5LZXldKSB7XG4gICAgICAgICAgICAgICAgb2JqW2tleV0gPSByb3dbY29sdW1uS2V5XTtcbiAgICAgICAgICAgICAgICBpZiAoaXNPYmopIHtcbiAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4Lm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG1vbWVudChvYmpba2V5XSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gb2JqW2tleV07XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgaWYgKGN0eC5wayAmJiBvYmpbY3R4LnBrXSkgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKCFjdHgucGspIHJldHVybiBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgIE1vZGVsLmZpbmRPbmUoeyB3aGVyZTogcXVlcnkgfSwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgX2tleSBpbiBvYmopIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KF9rZXkpKSBpbnN0YW5jZVtfa2V5XSA9IG9ialtfa2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkgcmV0dXJuIG5leHRGYWxsKG51bGwsIGluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICAgIG9iai5pbXBvcnRJZCA9IG9wdGlvbnMuZmlsZSArICc6JytpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuY3JlYXRlKG9iaiwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICBsZXQgc2V0dXBSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBsaW5rUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICBsZXQgY3JlYXRlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAvLyBJdGVyYXRlcyB0aHJvdWdoIGV4aXN0aW5nIHJlbGF0aW9ucyBpbiBtb2RlbFxuICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbiA9IGZ1bmN0aW9uIHNyKGV4cGVjdGVkUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBleGlzdGluZ1JlbGF0aW9uIGluIE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zLmhhc093blByb3BlcnR5KGV4aXN0aW5nUmVsYXRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBNYWtlcyBzdXJlIHRoZSByZWxhdGlvbiBleGlzdFxuICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24gPSBmdW5jdGlvbiBlcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZFJlbGF0aW9uID09PSBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgcGFyYWxsZWwucHVzaChuZXh0UGFyYWxsZWwgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2xpbmsnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb2YgcmVsYXRpb24gbmVlZHMgdG8gYmUgZGVmaW5lZCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIFJlbGF0aW9uXG4gICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbiA9IGZ1bmN0aW9uIGNyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjcmVhdGVPYmogPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdzdHJpbmcnICYmIHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSBtb21lbnQocm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0ubWFwXSwgJ01NLURELVlZWVknKS50b0lTT1N0cmluZygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmouaW1wb3J0SWQgPSBvcHRpb25zLmZpbGUgKyAnOicraTtcbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBMaW5rIFJlbGF0aW9uc1xuICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcHJvcGVydHkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWxFcnIpIHJldHVybiBuZXh0UGFyYWxsZWwocmVsRXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgLyoqIERvZXMgbm90IHdvcmssIGl0IG5lZWRzIHRvIG1vdmVkIHRvIG90aGVyIHBvaW50IGluIHRoZSBmbG93XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIGNyZWF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5jcmVhdGUocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICoqL1xuICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55VGhyb3VnaCc6XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzQW5kQmVsb25nc1RvTWFueSc6XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2JlbG9uZ3NUbyc6XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXShyZWxJbnN0YW5jZSwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBzb21lIHJlYXNvbiBkb2VzIG5vdCB3b3JrLCBubyBlcnJvcnMgYnV0IG5vIHJlbGF0aW9uc2hpcCBpcyBjcmVhdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBVZ2x5IGZpeCBuZWVkZWQgdG8gYmUgaW1wbGVtZW50ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBhdXRvSWQgPSBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5tb2RlbDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9JZCA9IGF1dG9JZC5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIGF1dG9JZC5zbGljZSgxKSArICdJZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS5mb3JlaWduS2V5IHx8IGF1dG9JZF0gPSByZWxJbnN0YW5jZS5pZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycyBpbiBvcHRpb25zLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAvLyBUT0RPIFZlcmlmeSB3aHkgY2FuIG5vdCBzZXQgZXJyb3JzIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy5lcnJvcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cuZXJyb3JzLnB1c2goeyByb3c6IHJvdywgbWVzc2FnZTogZXJyIH0pO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSU1QT1JUIEVSUk9SOiAnLCB7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgIHNlcmllcyA9IG51bGw7XG4gICAgICAgICAgICAgIG5leHQoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIC8vIFJlbW92ZSBDb250YWluZXJcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICB9LFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBlcnIgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignREItVElNRU9VVCcpO1xuICAgICAgICAvL2N0eC5pbXBvcnRMb2cuc2F2ZSgpO1xuICAgICAgfSBlbHNlIHt9XG4gICAgICBmaW5pc2goZXJyKTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZChjdHgubWV0aG9kLCB7XG4gICAgaHR0cDogeyBwYXRoOiBjdHguZW5kcG9pbnQsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246IGN0eC5kZXNjcmlwdGlvbixcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
