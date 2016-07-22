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
//# sourceMappingURL=data:application/json;base64,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O0FBQzdCLFVBQU0sRUFBRSxNQUFNLElBQUksUUFBSixFQUFjLE1BQU0sTUFBTixFQUE1QjtBQUNBLGFBQVMsQ0FBQztBQUNSLFdBQUssS0FBTDtBQUNBLFlBQU0sUUFBTjtBQUNBLFlBQU0sRUFBRSxRQUFRLEtBQVIsRUFBUjtLQUhPLENBQVQ7QUFLQSxhQUFTLEVBQUUsTUFBTSxRQUFOLEVBQWdCLE1BQU0sSUFBTixFQUEzQjtBQUNBLGlCQUFhLElBQUksV0FBSjtHQVJmLEVBclI2QjtDQUFoQiIsImZpbGUiOiJpbXBvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCBjc3YgZnJvbSAnY3N2LXBhcnNlcic7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuLy8gaW1wb3J0IERhdGFTb3VyY2VCdWlsZGVyIGZyb20gJy4vYnVpbGRlcnMvZGF0YXNvdXJjZS1idWlsZGVyJztcbi8qKlxuICAqIEJ1bGsgSW1wb3J0IE1peGluXG4gICogQEF1dGhvciBKb25hdGhhbiBDYXNhcnJ1Ymlhc1xuICAqIEBTZWUgPGh0dHBzOi8vdHdpdHRlci5jb20vam9obmNhc2FycnViaWFzPlxuICAqIEBTZWUgPGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBAU2VlIDxodHRwczovL2dpdGh1Yi5jb20vam9uYXRoYW4tY2FzYXJydWJpYXMvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBEZXNjcmlwdGlvblxuICAqXG4gICogVGhlIGZvbGxvd2luZyBtaXhpbiB3aWxsIGFkZCBidWxrIGltcG9ydGluZyBmdW5jdGlvbmFsbGl0eSB0byBtb2RlbHMgd2hpY2ggaW5jbHVkZXNcbiAgKiB0aGlzIG1vZHVsZS5cbiAgKlxuICAqIERlZmF1bHQgQ29uZmlndXJhdGlvblxuICAqXG4gICogXCJJbXBvcnRcIjoge1xuICAqICAgXCJtb2RlbHNcIjoge1xuICAqICAgICBcIkltcG9ydENvbnRhaW5lclwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0TG9nXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5cbmV4cG9ydCBkZWZhdWx0IChNb2RlbCwgY3R4KSA9PiB7XG4gIGN0eC5Nb2RlbCA9IE1vZGVsO1xuICBjdHgubWV0aG9kID0gY3R4Lm1ldGhvZCB8fCAnaW1wb3J0JztcbiAgY3R4LmVuZHBvaW50ID0gY3R4LmVuZHBvaW50IHx8IFsnLycsIGN0eC5tZXRob2RdLmpvaW4oJycpO1xuICAvLyBDcmVhdGUgZHluYW1pYyBzdGF0aXN0aWMgbWV0aG9kXG4gIE1vZGVsW2N0eC5tZXRob2RdID0gZnVuY3Rpb24gU3RhdE1ldGhvZChyZXEsIGZpbmlzaCkge1xuICAgIC8vIFNldCBtb2RlbCBuYW1lc1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lck5hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydENvbnRhaW5lcikgfHwgJ0ltcG9ydENvbnRhaW5lcic7XG4gICAgY29uc3QgSW1wb3J0TG9nTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0TG9nKSB8fCAnSW1wb3J0TG9nJztcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydENvbnRhaW5lck5hbWVdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0TG9nTmFtZV07XG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICctJyArIE1hdGgucm91bmQoRGF0ZS5ub3coKSkgKyAnLScgKyBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcbiAgICBpZiAoIUltcG9ydENvbnRhaW5lciB8fCAhSW1wb3J0TG9nKSB7XG4gICAgICByZXR1cm4gZmluaXNoKG5ldyBFcnJvcignKGxvb3BiYWNrLWltcG9ydC1taXhpbikgTWlzc2luZyByZXF1aXJlZCBtb2RlbHMsIHZlcmlmeSB5b3VyIHNldHVwIGFuZCBjb25maWd1cmF0aW9uJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgLy8gQ3JlYXRlIGNvbnRhaW5lclxuICAgICAgICBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5jcmVhdGVDb250YWluZXIoeyBuYW1lOiBjb250YWluZXJOYW1lIH0sIG5leHQpLFxuICAgICAgICAvLyBVcGxvYWQgRmlsZVxuICAgICAgICAoY29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgcmVxLnBhcmFtcy5jb250YWluZXIgPSBjb250YWluZXJOYW1lO1xuICAgICAgICAgIEltcG9ydENvbnRhaW5lci51cGxvYWQocmVxLCB7fSwgbmV4dCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBlcnNpc3QgcHJvY2VzcyBpbiBkYiBhbmQgcnVuIGluIGZvcmsgcHJvY2Vzc1xuICAgICAgICAoZmlsZUNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0udHlwZSAhPT0gJ3RleHQvY3N2Jykge1xuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIoY29udGFpbmVyTmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gbmV4dChuZXcgRXJyb3IoJ1RoZSBmaWxlIHlvdSBzZWxlY3RlZCBpcyBub3QgY3N2IGZvcm1hdCcpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gU3RvcmUgdGhlIHN0YXRlIG9mIHRoZSBpbXBvcnQgcHJvY2VzcyBpbiB0aGUgZGF0YWJhc2VcbiAgICAgICAgICBJbXBvcnRMb2cuY3JlYXRlKHtcbiAgICAgICAgICAgIGRhdGU6IG1vbWVudCgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBtb2RlbDogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgc3RhdHVzOiAnUEVORElORycsXG4gICAgICAgICAgfSwgKGVyciwgZmlsZVVwbG9hZCkgPT4gbmV4dChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpKTtcbiAgICAgICAgfSxcbiAgICAgIF0sIChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2goZXJyLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTGF1bmNoIGEgZm9yayBub2RlIHByb2Nlc3MgdGhhdCB3aWxsIGhhbmRsZSB0aGUgaW1wb3J0XG4gICAgICAgIGNoaWxkUHJvY2Vzcy5mb3JrKF9fZGlybmFtZSArICcvcHJvY2Vzc2VzL2ltcG9ydC1wcm9jZXNzLmpzJywgW1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHNjb3BlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBmaWxlVXBsb2FkSWQ6IGZpbGVVcGxvYWQuaWQsXG4gICAgICAgICAgICByb290OiBNb2RlbC5hcHAuZGF0YXNvdXJjZXMuY29udGFpbmVyLnNldHRpbmdzLnJvb3QsXG4gICAgICAgICAgICBjb250YWluZXI6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5jb250YWluZXIsXG4gICAgICAgICAgICBmaWxlOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0ubmFtZSxcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lcjogSW1wb3J0Q29udGFpbmVyTmFtZSxcbiAgICAgICAgICAgIEltcG9ydExvZzogSW1wb3J0TG9nTmFtZSxcbiAgICAgICAgICAgIHJlbGF0aW9uczogY3R4LnJlbGF0aW9uc1xuICAgICAgICAgIH0pXSk7XG4gICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2gobnVsbCwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgIHJlc29sdmUoZmlsZUNvbnRhaW5lcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIENyZWF0ZSBpbXBvcnQgbWV0aG9kIChOb3QgQXZhaWxhYmxlIHRocm91Z2ggUkVTVClcbiAgICoqL1xuICBNb2RlbC5pbXBvcnRQcm9jZXNzb3IgPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IF9fZGlybmFtZSArICcvLi4vLi4vLi4vJyArIG9wdGlvbnMucm9vdCArICcvJyArIG9wdGlvbnMuY29udGFpbmVyICsgJy8nICsgb3B0aW9ucy5maWxlO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRDb250YWluZXJdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbb3B0aW9ucy5JbXBvcnRMb2ddO1xuICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAvLyBHZXQgSW1wb3J0TG9nXG4gICAgICBuZXh0ID0+IEltcG9ydExvZy5maW5kQnlJZChvcHRpb25zLmZpbGVVcGxvYWRJZCwgbmV4dCksXG4gICAgICAvLyBTZXQgaW1wb3J0VXBsb2FkIHN0YXR1cyBhcyBwcm9jZXNzaW5nXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cgPSBpbXBvcnRMb2c7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc3RhdHVzID0gJ1BST0NFU1NJTkcnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgICAgLy8gSW1wb3J0IERhdGFcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgLy8gVGhpcyBsaW5lIG9wZW5zIHRoZSBmaWxlIGFzIGEgcmVhZGFibGUgc3RyZWFtXG4gICAgICAgIHZhciBzZXJpZXMgPSBbXTtcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgY29uc3Qgb2JqID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgIGlmIChyb3dbY3R4Lm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2N0eC5tYXBba2V5XV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgICAgICAgICBpZiAoY3R4LnBrICYmIG9ialtjdHgucGtdKSBxdWVyeVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAvLyBMZXRzIHNldCBlYWNoIHJvdyBhIGZsb3dcbiAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgLy8gU2VlIGluIERCIGZvciBleGlzdGluZyBwZXJzaXN0ZWQgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWN0eC5waykgcmV0dXJuIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuZmluZE9uZSh7IHdoZXJlOiBxdWVyeSB9LCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBJZiB3ZSBnZXQgYW4gaW5zdGFuY2Ugd2UganVzdCBzZXQgYSB3YXJuaW5nIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBjdHgucGsgKyAnICcgKyBvYmpbY3R4LnBrXSArICcgYWxyZWFkeSBleGlzdHMsIHVwZGF0aW5nIGZpZWxkcyB0byBuZXcgdmFsdWVzLicsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IF9rZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShfa2V5KSkgaW5zdGFuY2VbX2tleV0gPSBvYmpbX2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIE90aGVyd2lzZSB3ZSBjcmVhdGUgYSBuZXcgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHJldHVybiBuZXh0RmFsbChudWxsLCBpbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgICBNb2RlbC5jcmVhdGUob2JqLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIHJlbGF0aW9uc1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIEZpbmFsbCBwYXJhbGxlbCBwcm9jZXNzIGNvbnRhaW5lclxuICAgICAgICAgICAgICAgICAgY29uc3QgcGFyYWxsZWwgPSBbXTtcbiAgICAgICAgICAgICAgICAgIGxldCBzZXR1cFJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGVuc3VyZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGxpbmtSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBjcmVhdGVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIC8vIEl0ZXJhdGVzIHRocm91Z2ggZXhpc3RpbmcgcmVsYXRpb25zIGluIG1vZGVsXG4gICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uID0gZnVuY3Rpb24gc3IoZXhwZWN0ZWRSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUmVsYXRpb24gaW4gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXhpc3RpbmdSZWxhdGlvbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIE1ha2VzIHN1cmUgdGhlIHJlbGF0aW9uIGV4aXN0XG4gICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbiA9IGZ1bmN0aW9uIGVyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkUmVsYXRpb24gPT09IGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBwYXJhbGxlbC5wdXNoKG5leHRQYXJhbGxlbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnbGluayc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGlzdGluZ1JlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHRQYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVHlwZSBvZiByZWxhdGlvbiBuZWVkcyB0byBiZSBkZWZpbmVkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBDcmVhdGUgUmVsYXRpb25cbiAgICAgICAgICAgICAgICAgIGNyZWF0ZVJlbGF0aW9uID0gZnVuY3Rpb24gY3IoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNyZWF0ZU9iaiA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcCkge1xuICAgICAgICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XSA9PT0gJ3N0cmluZycgJiYgcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLnR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IG1vbWVudChyb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XS5tYXBdLCAnTU0tREQtWVlZWScpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3JlYXRlT2JqW2tleV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmNyZWF0ZShjcmVhdGVPYmosIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gTGluayBSZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAgIGxpbmtSZWxhdGlvbiA9IGZ1bmN0aW9uIGxyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24sIG5leHRQYXJhbGxlbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCByZWxRcnkgPSB7IHdoZXJlOiB7fSB9O1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHByb3BlcnR5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ud2hlcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZS5oYXNPd25Qcm9wZXJ0eShwcm9wZXJ0eSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlbFFyeS53aGVyZVtwcm9wZXJ0eV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZVtwcm9wZXJ0eV1dO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBNb2RlbC5hcHAubW9kZWxzW01vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsXS5maW5kT25lKHJlbFFyeSwgKHJlbEVyciwgcmVsSW5zdGFuY2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAocmVsRXJyKSByZXR1cm4gbmV4dFBhcmFsbGVsKHJlbEVycik7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKCFyZWxJbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIHVuZXhpc3RpbmcgaW5zdGFuY2Ugb2YgJyArIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgc3dpdGNoIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9uc1tleGlzdGluZ1JlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzTWFueSc6XG4gICAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGFzTWFueVRocm91Z2gnOlxuICAgICAgICAgICAgICAgICAgICAgIGNhc2UgJ2hhc0FuZEJlbG9uZ3NUb01hbnknOlxuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgZXhpc3RpbmcgcmVsYXRpb24uJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uYWRkKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICBjYXNlICdiZWxvbmdzVG8nOlxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0ocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBGb3Igc29tZSByZWFzb24gZG9lcyBub3Qgd29yaywgbm8gZXJyb3JzIGJ1dCBubyByZWxhdGlvbnNoaXAgaXMgY3JlYXRlZFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVWdseSBmaXggbmVlZGVkIHRvIGJlIGltcGxlbWVudGVkXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgYXV0b0lkID0gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWw7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdXRvSWQgPSBhdXRvSWQuY2hhckF0KDApLnRvTG93ZXJDYXNlKCkgKyBhdXRvSWQuc2xpY2UoMSkgKyAnSWQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0uZm9yZWlnbktleSB8fCBhdXRvSWRdID0gcmVsSW5zdGFuY2UuaWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIGRlZmluZWQgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBlcnMgaW4gb3B0aW9ucy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMucmVsYXRpb25zLmhhc093blByb3BlcnR5KGVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uKGVycyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIC8vIFJ1biB0aGUgcmVsYXRpb25zIHByb2Nlc3MgaW4gcGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgIGFzeW5jLnBhcmFsbGVsKHBhcmFsbGVsLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVycm9yIGluIHRoaXMgc2VyaWUgd2UgbG9nIGl0IGludG8gdGhlIGVycm9ycyBhcnJheSBvZiBvYmplY3RzXG4gICAgICAgICAgICAgIF0sIGVyciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgLy8gVE9ETyBWZXJpZnkgd2h5IGNhbiBub3Qgc2V0IGVycm9ycyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cuZXJyb3JzKSkge1xuICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycy5wdXNoKHsgcm93OiByb3csIG1lc3NhZ2U6IGVyciB9KTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0lNUE9SVCBFUlJPUjogJywgeyByb3c6IHJvdywgbWVzc2FnZTogZXJyIH0pO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBuZXh0U2VyaWUoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgICAgYXN5bmMuc2VyaWVzKHNlcmllcywgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICBzZXJpZXMgPSBudWxsO1xuICAgICAgICAgICAgICBuZXh0KGVycik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICAvLyBSZW1vdmUgQ29udGFpbmVyXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coJ1RyeWluZyB0byBkZXN0cm95IGNvbnRhaW5lcjogJXMnLCBvcHRpb25zLmNvbnRhaW5lcik7XG4gICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKG9wdGlvbnMuY29udGFpbmVyLCBuZXh0KVxuICAgICAgfSxcbiAgICAgIC8vIFNldCBzdGF0dXMgYXMgZmluaXNoZWRcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdGSU5JU0hFRCc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgXSwgZXJyID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnREItVElNRU9VVCc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZSgpO1xuICAgICAgfSBlbHNlIHt9XG4gICAgICBmaW5pc2goZXJyKTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZChjdHgubWV0aG9kLCB7XG4gICAgaHR0cDogeyBwYXRoOiBjdHguZW5kcG9pbnQsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246IGN0eC5kZXNjcmlwdGlvbixcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
