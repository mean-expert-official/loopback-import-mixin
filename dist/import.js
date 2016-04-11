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
            if (!ctx.pk) return next(null, null);
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
              console.log('ERROR: ', err);
              // TODO Verify why can not set errors into the log
              // ctx.importLog.errors = Array.isArray(ctx.importLog.errors) ? ctx.importLog.errors : [];
              // ctx.importLog.errors.push({ row: row, message: err });
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
//# sourceMappingURL=data:application/json;base64,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QVQ7QUFLQSxhQUFTLEVBQUUsTUFBTSxRQUFOLEVBQWdCLE1BQU0sSUFBTixFQUEzQjtBQUNBLGlCQUFhLElBQUksV0FBSjtHQVJmLEVBeFA2QjtDQUFoQiIsImZpbGUiOiJpbXBvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCBjc3YgZnJvbSAnY3N2LXBhcnNlcic7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuLy8gaW1wb3J0IERhdGFTb3VyY2VCdWlsZGVyIGZyb20gJy4vYnVpbGRlcnMvZGF0YXNvdXJjZS1idWlsZGVyJztcbi8qKlxuICAqIEJ1bGsgSW1wb3J0IE1peGluXG4gICogQEF1dGhvciBKb25hdGhhbiBDYXNhcnJ1Ymlhc1xuICAqIEBTZWUgPGh0dHBzOi8vdHdpdHRlci5jb20vam9obmNhc2FycnViaWFzPlxuICAqIEBTZWUgPGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBAU2VlIDxodHRwczovL2dpdGh1Yi5jb20vam9uYXRoYW4tY2FzYXJydWJpYXMvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBEZXNjcmlwdGlvblxuICAqXG4gICogVGhlIGZvbGxvd2luZyBtaXhpbiB3aWxsIGFkZCBidWxrIGltcG9ydGluZyBmdW5jdGlvbmFsbGl0eSB0byBtb2RlbHMgd2hpY2ggaW5jbHVkZXNcbiAgKiB0aGlzIG1vZHVsZS5cbiAgKlxuICAqIERlZmF1bHQgQ29uZmlndXJhdGlvblxuICAqXG4gICogXCJJbXBvcnRcIjoge1xuICAqICAgXCJtb2RlbHNcIjoge1xuICAqICAgICBcIkltcG9ydENvbnRhaW5lclwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0TG9nXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5cbmV4cG9ydCBkZWZhdWx0IChNb2RlbCwgY3R4KSA9PiB7XG4gIGN0eC5Nb2RlbCA9IE1vZGVsO1xuICBjdHgubWV0aG9kID0gY3R4Lm1ldGhvZCB8fCAnaW1wb3J0JztcbiAgY3R4LmVuZHBvaW50ID0gY3R4LmVuZHBvaW50IHx8IFsnLycsIGN0eC5tZXRob2RdLmpvaW4oJycpO1xuICAvLyBDcmVhdGUgZHluYW1pYyBzdGF0aXN0aWMgbWV0aG9kXG4gIE1vZGVsW2N0eC5tZXRob2RdID0gZnVuY3Rpb24gU3RhdE1ldGhvZChyZXEsIGZpbmlzaCkge1xuICAgIC8vIFNldCBtb2RlbCBuYW1lc1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lck5hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydENvbnRhaW5lcikgfHwgJ0ltcG9ydENvbnRhaW5lcic7XG4gICAgY29uc3QgSW1wb3J0TG9nTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0TG9nKSB8fCAnSW1wb3J0TG9nJztcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydENvbnRhaW5lck5hbWVdO1xuICAgIGNvbnN0IEltcG9ydExvZyA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0TG9nTmFtZV07XG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICctJyArIE1hdGgucm91bmQoRGF0ZS5ub3coKSkgKyAnLScgKyBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcbiAgICBpZiAoIUltcG9ydENvbnRhaW5lciB8fCAhSW1wb3J0TG9nKSB7XG4gICAgICByZXR1cm4gZmluaXNoKG5ldyBFcnJvcignKGxvb3BiYWNrLWltcG9ydC1taXhpbikgTWlzc2luZyByZXF1aXJlZCBtb2RlbHMsIHZlcmlmeSB5b3VyIHNldHVwIGFuZCBjb25maWd1cmF0aW9uJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgICAgLy8gQ3JlYXRlIGNvbnRhaW5lclxuICAgICAgICBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5jcmVhdGVDb250YWluZXIoeyBuYW1lOiBjb250YWluZXJOYW1lIH0sIG5leHQpLFxuICAgICAgICAvLyBVcGxvYWQgRmlsZVxuICAgICAgICAoY29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgcmVxLnBhcmFtcy5jb250YWluZXIgPSBjb250YWluZXJOYW1lO1xuICAgICAgICAgIEltcG9ydENvbnRhaW5lci51cGxvYWQocmVxLCB7fSwgbmV4dCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFBlcnNpc3QgcHJvY2VzcyBpbiBkYiBhbmQgcnVuIGluIGZvcmsgcHJvY2Vzc1xuICAgICAgICAoZmlsZUNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0udHlwZSAhPT0gJ3RleHQvY3N2Jykge1xuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyLmRlc3Ryb3lDb250YWluZXIoY29udGFpbmVyTmFtZSk7XG4gICAgICAgICAgICByZXR1cm4gbmV4dChuZXcgRXJyb3IoJ1RoZSBmaWxlIHlvdSBzZWxlY3RlZCBpcyBub3QgY3N2IGZvcm1hdCcpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gU3RvcmUgdGhlIHN0YXRlIG9mIHRoZSBpbXBvcnQgcHJvY2VzcyBpbiB0aGUgZGF0YWJhc2VcbiAgICAgICAgICBJbXBvcnRMb2cuY3JlYXRlKHtcbiAgICAgICAgICAgIGRhdGU6IG1vbWVudCgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBtb2RlbDogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgc3RhdHVzOiAnUEVORElORycsXG4gICAgICAgICAgfSwgKGVyciwgZmlsZVVwbG9hZCkgPT4gbmV4dChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpKTtcbiAgICAgICAgfSxcbiAgICAgIF0sIChlcnIsIGZpbGVDb250YWluZXIsIGZpbGVVcGxvYWQpID0+IHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2goZXJyLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gTGF1bmNoIGEgZm9yayBub2RlIHByb2Nlc3MgdGhhdCB3aWxsIGhhbmRsZSB0aGUgaW1wb3J0XG4gICAgICAgIGNoaWxkUHJvY2Vzcy5mb3JrKF9fZGlybmFtZSArICcvcHJvY2Vzc2VzL2ltcG9ydC1wcm9jZXNzLmpzJywgW1xuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIHNjb3BlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBmaWxlVXBsb2FkSWQ6IGZpbGVVcGxvYWQuaWQsXG4gICAgICAgICAgICByb290OiBNb2RlbC5hcHAuZGF0YXNvdXJjZXMuY29udGFpbmVyLnNldHRpbmdzLnJvb3QsXG4gICAgICAgICAgICBjb250YWluZXI6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5jb250YWluZXIsXG4gICAgICAgICAgICBmaWxlOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0ubmFtZSxcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lcjogSW1wb3J0Q29udGFpbmVyTmFtZSxcbiAgICAgICAgICAgIEltcG9ydExvZzogSW1wb3J0TG9nTmFtZSxcbiAgICAgICAgICB9KV0pO1xuICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKG51bGwsIGZpbGVDb250YWluZXIpO1xuICAgICAgICByZXNvbHZlKGZpbGVDb250YWluZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBDcmVhdGUgaW1wb3J0IG1ldGhvZCAoTm90IEF2YWlsYWJsZSB0aHJvdWdoIFJFU1QpXG4gICAqKi9cbiAgTW9kZWwuaW1wb3J0UHJvY2Vzc29yID0gZnVuY3Rpb24gSW1wb3J0TWV0aG9kKGNvbnRhaW5lciwgZmlsZSwgb3B0aW9ucywgZmluaXNoKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBfX2Rpcm5hbWUgKyAnLy4uLy4uLy4uLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICAvLyBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0TG9nXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IEltcG9ydExvZ1xuICAgICAgbmV4dCA9PiBJbXBvcnRMb2cuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nID0gaW1wb3J0TG9nO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBjb25zdCBzZXJpZXMgPSBbXTtcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgY29uc3Qgb2JqID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgIGlmIChyb3dbY3R4Lm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2N0eC5tYXBba2V5XV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgICAgICAgICBpZiAoY3R4LnBrICYmIG9ialtjdHgucGtdKSBxdWVyeVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAvLyBMZXRzIHNldCBlYWNoIHJvdyBhIGZsb3dcbiAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgLy8gU2VlIGluIERCIGZvciBleGlzdGluZyBwZXJzaXN0ZWQgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWN0eC5waykgcmV0dXJuIG5leHQobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICBNb2RlbC5maW5kT25lKHsgd2hlcmU6IHF1ZXJ5IH0sIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIElmIHdlIGdldCBhbiBpbnN0YW5jZSB3ZSBqdXN0IHNldCBhIHdhcm5pbmcgaW50byB0aGUgbG9nXG4gICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGN0eC5wayArICcgJyArIG9ialtjdHgucGtdICsgJyBhbHJlYWR5IGV4aXN0cywgdXBkYXRpbmcgZmllbGRzIHRvIG5ldyB2YWx1ZXMuJyxcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgX2tleSBpbiBvYmopIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KF9rZXkpKSBpbnN0YW5jZVtfa2V5XSA9IG9ialtfa2V5XTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZS5zYXZlKG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG5leHRGYWxsKG51bGwsIG51bGwpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlIHdlIGNyZWF0ZSBhIG5ldyBpbnN0YW5jZVxuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkgcmV0dXJuIG5leHRGYWxsKG51bGwsIGluc3RhbmNlKTtcbiAgICAgICAgICAgICAgICAgIE1vZGVsLmNyZWF0ZShvYmosIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gcmVsYXRpb25zXG4gICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgLy8gRmluYWxsIHBhcmFsbGVsIHByb2Nlc3MgY29udGFpbmVyXG4gICAgICAgICAgICAgICAgICBjb25zdCBwYXJhbGxlbCA9IFtdO1xuICAgICAgICAgICAgICAgICAgbGV0IHNldHVwUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICBsZXQgZW5zdXJlUmVsYXRpb247XG4gICAgICAgICAgICAgICAgICBsZXQgbGlua1JlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGNyZWF0ZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgLy8gSXRlcmF0ZXMgdGhyb3VnaCBleGlzdGluZyByZWxhdGlvbnMgaW4gbW9kZWxcbiAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24gPSBmdW5jdGlvbiBzcihleHBlY3RlZFJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhpc3RpbmdSZWxhdGlvbiBpbiBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShleGlzdGluZ1JlbGF0aW9uKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24oZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gTWFrZXMgc3VyZSB0aGUgcmVsYXRpb24gZXhpc3RcbiAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uID0gZnVuY3Rpb24gZXIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhwZWN0ZWRSZWxhdGlvbiA9PT0gZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIHBhcmFsbGVsLnB1c2gobmV4dFBhcmFsbGVsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN3aXRjaCAoY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS50eXBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdsaW5rJzpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmdSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0UGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVSZWxhdGlvbihcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleHBlY3RlZFJlbGF0aW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4aXN0aW5nUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dFBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUeXBlIG9mIHJlbGF0aW9uIG5lZWRzIHRvIGJlIGRlZmluZWQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBSZWxhdGlvblxuICAgICAgICAgICAgICAgICAgY3JlYXRlUmVsYXRpb24gPSBmdW5jdGlvbiBjcihleHBlY3RlZFJlbGF0aW9uLCBleGlzdGluZ1JlbGF0aW9uLCBuZXh0UGFyYWxsZWwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY3JlYXRlT2JqID0ge307XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldID09PSAnc3RyaW5nJyAmJiByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gcm93W2N0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV1dO1xuICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0gPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzd2l0Y2ggKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0ubWFwW2tleV0udHlwZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNyZWF0ZU9ialtrZXldID0gbW9tZW50KHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldLm1hcF0sICdNTS1ERC1ZWVlZJykudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjcmVhdGVPYmpba2V5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLm1hcFtrZXldXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uY3JlYXRlKGNyZWF0ZU9iaiwgbmV4dFBhcmFsbGVsKTtcbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBMaW5rIFJlbGF0aW9uc1xuICAgICAgICAgICAgICAgICAgbGlua1JlbGF0aW9uID0gZnVuY3Rpb24gbHIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbiwgbmV4dFBhcmFsbGVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcHJvcGVydHkgaW4gY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXS53aGVyZSkge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLndoZXJlW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChyZWxFcnIpIHJldHVybiBuZXh0UGFyYWxsZWwocmVsRXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5maW5kQnlJZChyZWxJbnN0YW5jZS5pZCwgKHJlbEVycjIsIGV4aXN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIFdvcmsgb24gZGVmaW5lZCByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGVycyBpbiBjdHgucmVsYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zLmhhc093blByb3BlcnR5KGVycykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uKGVycyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIC8vIFJ1biB0aGUgcmVsYXRpb25zIHByb2Nlc3MgaW4gcGFyYWxsZWxcbiAgICAgICAgICAgICAgICAgIGFzeW5jLnBhcmFsbGVsKHBhcmFsbGVsLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGVycm9yIGluIHRoaXMgc2VyaWUgd2UgbG9nIGl0IGludG8gdGhlIGVycm9ycyBhcnJheSBvZiBvYmplY3RzXG4gICAgICAgICAgICAgIF0sIGVyciA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0VSUk9SOiAnLCBlcnIpO1xuICAgICAgICAgICAgICAgICAgLy8gVE9ETyBWZXJpZnkgd2h5IGNhbiBub3Qgc2V0IGVycm9ycyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAgIC8vIGN0eC5pbXBvcnRMb2cuZXJyb3JzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykgPyBjdHguaW1wb3J0TG9nLmVycm9ycyA6IFtdO1xuICAgICAgICAgICAgICAgICAgLy8gY3R4LmltcG9ydExvZy5lcnJvcnMucHVzaCh7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBuZXh0KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICAvLyBSZW1vdmUgQ29udGFpbmVyXG4gICAgICAvLyBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKHsgY29udGFpbmVyOiBvcHRpb25zLmNvbnRhaW5lciB9LCBuZXh0KSxcbiAgICAgIC8vIFNldCBzdGF0dXMgYXMgZmluaXNoZWRcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdGSU5JU0hFRCc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgXSwgZXJyID0+IHtcbiAgICAgIGlmIChlcnIpIHRocm93IG5ldyBFcnJvcihlcnIpO1xuICAgICAgZmluaXNoKGVycik7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBSZWdpc3RlciBJbXBvcnQgTWV0aG9kXG4gICAqL1xuICBNb2RlbC5yZW1vdGVNZXRob2QoY3R4Lm1ldGhvZCwge1xuICAgIGh0dHA6IHsgcGF0aDogY3R4LmVuZHBvaW50LCB2ZXJiOiAncG9zdCcgfSxcbiAgICBhY2NlcHRzOiBbe1xuICAgICAgYXJnOiAncmVxJyxcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgaHR0cDogeyBzb3VyY2U6ICdyZXEnIH0sXG4gICAgfV0sXG4gICAgcmV0dXJuczogeyB0eXBlOiAnb2JqZWN0Jywgcm9vdDogdHJ1ZSB9LFxuICAgIGRlc2NyaXB0aW9uOiBjdHguZGVzY3JpcHRpb24sXG4gIH0pO1xufTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
