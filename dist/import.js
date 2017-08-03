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
//# sourceMappingURL=data:application/json;base64,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WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCBjc3YgZnJvbSAnY3N2LXBhcnNlcic7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuLy8gaW1wb3J0IERhdGFTb3VyY2VCdWlsZGVyIGZyb20gJy4vYnVpbGRlcnMvZGF0YXNvdXJjZS1idWlsZGVyJztcbi8qKlxuICAqIEJ1bGsgSW1wb3J0IE1peGluXG4gICogQEF1dGhvciBKb25hdGhhbiBDYXNhcnJ1Ymlhc1xuICAqIEBTZWUgPGh0dHBzOi8vdHdpdHRlci5jb20vam9obmNhc2FycnViaWFzPlxuICAqIEBTZWUgPGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBAU2VlIDxodHRwczovL2dpdGh1Yi5jb20vam9uYXRoYW4tY2FzYXJydWJpYXMvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBEZXNjcmlwdGlvblxuICAqXG4gICogVGhlIGZvbGxvd2luZyBtaXhpbiB3aWxsIGFkZCBidWxrIGltcG9ydGluZyBmdW5jdGlvbmFsbGl0eSB0byBtb2RlbHMgd2hpY2ggaW5jbHVkZXNcbiAgKiB0aGlzIG1vZHVsZS5cbiAgKlxuICAqIERlZmF1bHQgQ29uZmlndXJhdGlvblxuICAqXG4gICogXCJJbXBvcnRcIjoge1xuICAqICAgXCJtb2RlbHNcIjoge1xuICAqICAgICBcIkltcG9ydENvbnRhaW5lclwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0TG9nXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5cbmV4cG9ydCBkZWZhdWx0IChNb2RlbCwgY3R4KSA9PiB7XG4gIGN0eC5Nb2RlbCA9IE1vZGVsO1xuICBjdHgubWV0aG9kID0gY3R4Lm1ldGhvZCB8fCAnaW1wb3J0JztcbiAgY3R4LmVuZHBvaW50ID0gY3R4LmVuZHBvaW50IHx8IFsnLycsIGN0eC5tZXRob2RdLmpvaW4oJycpO1xuICAvLyBDcmVhdGUgZHluYW1pYyBzdGF0aXN0aWMgbWV0aG9kXG4gIE1vZGVsW2N0eC5tZXRob2RdID0gZnVuY3Rpb24gU3RhdE1ldGhvZChyZXEsIGZpbmlzaCkge1xuICAgIC8vIFNldCBtb2RlbCBuYW1lc1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lck5hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydENvbnRhaW5lcikgfHwgJ0ltcG9ydENvbnRhaW5lcic7XG4gICAgY29uc3QgSW1wb3J0TG9nTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0TG9nKSB8fCAnSW1wb3J0TG9nJztcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydENvbnRhaW5lck5hbWVdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0TG9nTmFtZV07XG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICctJyArIE1hdGgucm91bmQoRGF0ZS5ub3coKSkgKyAnLScgKyBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcbiAgICBpZiAoIUltcG9ydENvbnRhaW5lciB8fCAhSW1wb3J0TG9nKSB7XG4gICAgICByZXR1cm4gZmluaXNoKG5ldyBFcnJvcignKGxvb3BiYWNrLWltcG9ydC1taXhpbikgTWlzc2luZyByZXF1aXJlZCBtb2RlbHMsIHZlcmlmeSB5b3VyIHNldHVwIGFuZCBjb25maWd1cmF0aW9uJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgLy8gQ3JlYXRlIGNvbnRhaW5lclxuICAgICAgICBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5jcmVhdGVDb250YWluZXIoeyBuYW1lOiBjb250YWluZXJOYW1lIH0sIG5leHQpLFxuICAgICAgICAvLyBVcGxvYWQgRmlsZVxuICAgICAgICAoY29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgcmVxLnBhcmFtcy5jb250YWluZXIgPSBjb250YWluZXJOYW1lO1xuICAgICAgICAgIEltcG9ydENvbnRhaW5lci51cGxvYWQocmVxLCB7fSwgbmV4dCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBlcnNpc3QgcHJvY2VzcyBpbiBkYiBhbmQgcnVuIGluIGZvcmsgcHJvY2Vzc1xuICAgICAgICAoZmlsZUNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0udHlwZSAhPT0gJ3RleHQvY3N2Jykge1xuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIoY29udGFpbmVyTmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gbmV4dChuZXcgRXJyb3IoJ1RoZSBmaWxlIHlvdSBzZWxlY3RlZCBpcyBub3QgY3N2IGZvcm1hdCcpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gU3RvcmUgdGhlIHN0YXRlIG9mIHRoZSBpbXBvcnQgcHJvY2VzcyBpbiB0aGUgZGF0YWJhc2VcbiAgICAgICAgICBJbXBvcnRMb2cuY3JlYXRlKHtcbiAgICAgICAgICAgIGRhdGU6IG1vbWVudCgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBtb2RlbDogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgc3RhdHVzOiAnUEVORElORycsXG4gICAgICAgICAgfSwgKGVyciwgZmlsZVVwbG9hZCkgPT4gbmV4dChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpKTtcbiAgICAgICAgfSxcbiAgICAgIF0sIChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2goZXJyLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTGF1bmNoIGEgZm9yayBub2RlIHByb2Nlc3MgdGhhdCB3aWxsIGhhbmRsZSB0aGUgaW1wb3J0XG4gICAgICAgIGNoaWxkUHJvY2Vzcy5mb3JrKF9fZGlybmFtZSArICcvcHJvY2Vzc2VzL2ltcG9ydC1wcm9jZXNzLmpzJywgW1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIG1ldGhvZDogY3R4Lm1ldGhvZCxcbiAgICAgICAgICAgIHNjb3BlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBmaWxlVXBsb2FkSWQ6IGZpbGVVcGxvYWQuaWQsXG4gICAgICAgICAgICByb290OiBNb2RlbC5hcHAuZGF0YXNvdXJjZXMuY29udGFpbmVyLnNldHRpbmdzLnJvb3QsXG4gICAgICAgICAgICBjb250YWluZXI6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5jb250YWluZXIsXG4gICAgICAgICAgICBmaWxlOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0ubmFtZSxcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lcjogSW1wb3J0Q29udGFpbmVyTmFtZSxcbiAgICAgICAgICAgIEltcG9ydExvZzogSW1wb3J0TG9nTmFtZSxcbiAgICAgICAgICAgIHJlbGF0aW9uczogY3R4LnJlbGF0aW9uc1xuICAgICAgICAgIH0pXSk7XG4gICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2gobnVsbCwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgIHJlc29sdmUoZmlsZUNvbnRhaW5lcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIENyZWF0ZSBpbXBvcnQgbWV0aG9kIChOb3QgQXZhaWxhYmxlIHRocm91Z2ggUkVTVClcbiAgICoqL1xuICBNb2RlbFsnaW1wb3J0JyArIGN0eC5tZXRob2RdID0gZnVuY3Rpb24gSW1wb3J0TWV0aG9kKGNvbnRhaW5lciwgZmlsZSwgb3B0aW9ucywgZmluaXNoKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBfX2Rpcm5hbWUgKyAnLy4uLy4uLy4uLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0TG9nXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IEltcG9ydExvZ1xuICAgICAgbmV4dCA9PiBJbXBvcnRMb2cuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nID0gaW1wb3J0TG9nO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBsZXQgc2VyaWVzID0gW107XG4gICAgICAgIGxldCBpID0gMTsgLy8gU3RhcnRzIGluIG9uZSB0byBkaXNjb3VudCBjb2x1bW4gbmFtZXNcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgKGZ1bmN0aW9uIChpKSB7XG4gICAgICAgICAgICAgIGNvbnN0IG9iaiA9IHsgaW1wb3J0SWQ6IG9wdGlvbnMuZmlsZSArICc6JyArIGkgfTtcbiAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICAgIGxldCBpc09iaiA9ICh0eXBlb2YgY3R4Lm1hcFtrZXldID09PSAnb2JqZWN0Jyk7XG4gICAgICAgICAgICAgICAgbGV0IGNvbHVtbktleSA9IGlzT2JqID8gY3R4Lm1hcFtrZXldLm1hcCA6IGN0eC5tYXBba2V5XTtcbiAgICAgICAgICAgICAgICBpZiAocm93W2NvbHVtbktleV0pIHtcbiAgICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2NvbHVtbktleV07XG4gICAgICAgICAgICAgICAgICBpZiAoaXNPYmopIHtcbiAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgubWFwW2tleV0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgb2JqW2tleV0gPSBtb21lbnQob2JqW2tleV0sICdNTS1ERC1ZWVlZJykudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICBvYmpba2V5XSA9IG9ialtrZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGNvbnN0IHdoZXJlID0ge307XG4gICAgICAgICAgICAgIGlmIChjdHgucGspIHtcbiAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjdHgucGspKSB7XG4gICAgICAgICAgICAgICAgICBjdHgucGsuZm9yRWFjaCgocGspID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9ialtwa10pIHtcbiAgICAgICAgICAgICAgICAgICAgICB3aGVyZVtwa10gPSBvYmpbcGtdO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG9ialtjdHgucGtdKSB7XG4gICAgICAgICAgICAgICAgICB3aGVyZVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8vIExldHMgc2V0IGVhY2ggcm93IGEgZmxvd1xuICAgICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgICAvLyBTZWUgaW4gREIgZm9yIGV4aXN0aW5nIHBlcnNpc3RlZCBpbnN0YW5jZVxuICAgICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWN0eC5waykgcmV0dXJuIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgICBNb2RlbC5maW5kT25lKHsgd2hlcmUgfSwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIElmIHdlIGdldCBhbiBpbnN0YW5jZSB3ZSBqdXN0IHNldCBhIHdhcm5pbmcgaW50byB0aGUgbG9nXG4gICAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgX2tleSBpbiBvYmopIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoX2tleSkpIGluc3RhbmNlW19rZXldID0gb2JqW19rZXldO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIC8vIE90aGVyd2lzZSB3ZSBjcmVhdGUgYSBuZXcgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgaW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgICAgICBNb2RlbC5jcmVhdGUob2JqLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgLy8gRmluYWxsIHBhcmFsbGVsIHByb2Nlc3MgY29udGFpbmVyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICAgIGxldCBzZXR1cFJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgICBsZXQgZW5zdXJlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBsaW5rUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICAgIGxldCBjcmVhdGVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgICAgLy8gSXRlcmF0ZXMgdGhyb3VnaCBleGlzdGluZyByZWxhdGlvbnMgaW4gbW9kZWxcbiAgICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbiA9IGZ1bmN0aW9uIHNyKGV4cGVjdGVkUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUmVsYXRpb24gaW4gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShleGlzdGluZ1JlbGF0aW9uKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIE1ha2VzIHN1cmUgdGhlIHJlbGF0aW9uIGV4aXN0XG4gICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uID0gZnVuY3Rpb24gZXIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZFJlbGF0aW9uID09PSBleGlzdGluZ1JlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJhbGxlbC5wdXNoKG5leHRQYXJhbGxlbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnbGluayc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2NyZWF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVHlwZSBvZiByZWxhdGlvbiBuZWVkcyB0byBiZSBkZWZpbmVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgLy8gQ3JlYXRlIFJlbGF0aW9uXG4gICAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uID0gZnVuY3Rpb24gY3IoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlT2JqID0ge307XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ3N0cmluZycgJiYgcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gbW9tZW50KHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLm1hcF0sICdNTS1ERC1ZWVlZJykudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmouaW1wb3J0SWQgPSBvcHRpb25zLmZpbGUgKyAnOicgKyBpO1xuICAgICAgICAgICAgICAgICAgICAgIGxldCB3aGVyZSA9IHt9O1xuICAgICAgICAgICAgICAgICAgICAgIGxldCBwayA9IGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ucGs7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKHBrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwaykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcGsuZm9yRWFjaCgoX3BrKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNyZWF0ZU9ialtfcGtdKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2hlcmVbX3BrXSA9IGNyZWF0ZU9ialtfcGtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoY3JlYXRlT2JqW3BrXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICB3aGVyZVtwa10gPSBjcmVhdGVPYmpbcGtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXSh7IHdoZXJlIH0sIGZ1bmN0aW9uIChlcnIsIHJlc3VsdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdCAmJiBBcnJheS5pc0FycmF5KHJlc3VsdCkgJiYgcmVzdWx0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IHJlbGF0ZWRJbnN0YW5jZSA9IHJlc3VsdC5wb3AoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgT2JqZWN0LmtleXMoY3JlYXRlT2JqKS5mb3JFYWNoKGZ1bmN0aW9uIChvYmpLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxhdGVkSW5zdGFuY2Vbb2JqS2V5XSA9IGNyZWF0ZU9ialtvYmpLZXldO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsYXRlZEluc3RhbmNlLnNhdmUobmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmNyZWF0ZShjcmVhdGVPYmosIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIC8vIExpbmsgUmVsYXRpb25zXG4gICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbiA9IGZ1bmN0aW9uIGxyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZS5oYXNPd25Qcm9wZXJ0eShwcm9wZXJ0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbEVycikgcmV0dXJuIG5leHRQYXJhbGxlbChyZWxFcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZWxJbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdoYXNNYW55JzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvKiogRG9lcyBub3Qgd29yaywgaXQgbmVlZHMgdG8gbW92ZWQgdG8gb3RoZXIgcG9pbnQgaW4gdGhlIGZsb3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gY3JlYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiovXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc01hbnlUaHJvdWdoJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzQW5kQmVsb25nc1RvTWFueSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGV4aXN0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uYWRkKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdiZWxvbmdzVG8nOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBzb21lIHJlYXNvbiBkb2VzIG5vdCB3b3JrLCBubyBlcnJvcnMgYnV0IG5vIHJlbGF0aW9uc2hpcCBpcyBjcmVhdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVWdseSBmaXggbmVlZGVkIHRvIGJlIGltcGxlbWVudGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGF1dG9JZCA9IE1vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF1dG9JZCA9IGF1dG9JZC5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIGF1dG9JZC5zbGljZSgxKSArICdJZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0uZm9yZWlnbktleSB8fCBhdXRvSWRdID0gcmVsSW5zdGFuY2UuaWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIGRlZmluZWQgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycyBpbiBvcHRpb25zLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvcHRpb25zLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShlcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uKGVycyk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIFJ1biB0aGUgcmVsYXRpb25zIHByb2Nlc3MgaW4gcGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVycm9yIGluIHRoaXMgc2VyaWUgd2UgbG9nIGl0IGludG8gdGhlIGVycm9ycyBhcnJheSBvZiBvYmplY3RzXG4gICAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gVE9ETyBWZXJpZnkgd2h5IGNhbiBub3Qgc2V0IGVycm9ycyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy5lcnJvcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy5lcnJvcnMucHVzaCh7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSU1QT1JUIEVSUk9SOiAnLCB7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pKGkpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgIHNlcmllcyA9IG51bGw7XG4gICAgICAgICAgICAgIG5leHQoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgfSxcbiAgICAgIC8vIFJlbW92ZSBDb250YWluZXJcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICB9LFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBlcnIgPT4ge1xuICAgICAgaWYgKGVycikge1xuICAgICAgICBjb25zb2xlLmxvZygnVHJ5aW5nIHRvIGRlc3Ryb3kgY29udGFpbmVyOiAlcycsIG9wdGlvbnMuY29udGFpbmVyKTtcbiAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIob3B0aW9ucy5jb250YWluZXIsIG5leHQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignREItVElNRU9VVCcpO1xuICAgICAgICAvL2N0eC5pbXBvcnRMb2cuc2F2ZSgpO1xuICAgICAgfSBlbHNlIHsgfVxuICAgICAgLy8gVE9ETywgQWRkIG1vcmUgdmFsdWFibGUgZGF0YSB0byBwYXNzLCBtYXliZSBhIGJldHRlciB3YXkgdG8gcGFzcyBlcnJvcnNcbiAgICAgIE1vZGVsLmFwcC5lbWl0KGN0eC5tZXRob2QgKyAnOmRvbmUnLCB7fSk7XG4gICAgICBmaW5pc2goZXJyKTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZChjdHgubWV0aG9kLCB7XG4gICAgaHR0cDogeyBwYXRoOiBjdHguZW5kcG9pbnQsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246IGN0eC5kZXNjcmlwdGlvbixcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
