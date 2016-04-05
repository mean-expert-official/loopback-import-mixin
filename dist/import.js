'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

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
  // Create import method
  Model.import = function (req, finish) {
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
    var filePath = '../../' + options.root + '/' + options.container + '/' + options.file;
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
        if (!obj[ctx.pk]) return;
        var query = {};
        query[ctx.pk] = obj[ctx.pk];
        // Lets set each row a flow
        series.push(function (nextSerie) {
          _async2.default.waterfall([
          // See in DB for existing persisted instance
          function (nextFall) {
            return Model.findOne({ where: query }, nextFall);
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
                  var relQry = { where: {} };
                  for (var property in ctx.relations[expectedRelation]) {
                    if (ctx.relations[expectedRelation].hasOwnProperty(property)) {
                      relQry.where[property] = row[ctx.relations[expectedRelation][property]];
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
                      // TODO, Verify for different type of relations, this works on hasManyThrough and HasManyAndBelongsTo
                      // but what about just hast many?? seems weird but Ill left this here if any issues are rised
                      instance[expectedRelation].add(relInstance, nextParallel);
                    });
                  });
                });
              }
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
  Model.remoteMethod('import', {
    http: { path: '/import', verb: 'post' },
    accepts: [{
      arg: 'req',
      type: 'object',
      http: { source: 'req' }
    }],
    returns: { type: 'object', root: true },
    description: 'Bulk upload and import cvs file to persist new instances'
  });
}; /**
    * Stats Mixin Dependencies
    */


module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,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Q0FETTtBQUVOLFVBQUksU0FBSixDQUFjLElBQWQsQ0FBbUIsSUFBbkIsRUFGTTtLQUFSLENBaElGLEVBb0lHLGVBQU87QUFDUixVQUFJLEdBQUosRUFBUyxNQUFNLElBQUksS0FBSixDQUFVLEdBQVYsQ0FBTixDQUFUO0FBQ0EsYUFBTyxHQUFQLEVBRlE7S0FBUCxDQXBJSCxDQUo4RTtHQUF4RDs7OztBQTFESyxPQTBNN0IsQ0FBTSxZQUFOLENBQW1CLFFBQW5CLEVBQTZCO0FBQzNCLFVBQU0sRUFBRSxNQUFNLFNBQU4sRUFBaUIsTUFBTSxNQUFOLEVBQXpCO0FBQ0EsYUFBUyxDQUFDO0FBQ1IsV0FBSyxLQUFMO0FBQ0EsWUFBTSxRQUFOO0FBQ0EsWUFBTSxFQUFFLFFBQVEsS0FBUixFQUFSO0tBSE8sQ0FBVDtBQUtBLGFBQVMsRUFBRSxNQUFNLFFBQU4sRUFBZ0IsTUFBTSxJQUFOLEVBQTNCO0FBQ0EsaUJBQWEsMERBQWI7R0FSRixFQTFNNkI7Q0FBaEIiLCJmaWxlIjoiaW1wb3J0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTdGF0cyBNaXhpbiBEZXBlbmRlbmNpZXNcbiAqL1xuaW1wb3J0IGFzeW5jIGZyb20gJ2FzeW5jJztcbmltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcbmltcG9ydCBjaGlsZFByb2Nlc3MgZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgY3N2IGZyb20gJ2Nzdi1wYXJzZXInO1xuaW1wb3J0IGZzIGZyb20gJ2ZzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydExvZ1wiOiBcIk1vZGVsXCJcbiAgKiAgIH1cbiAgKiB9XG4gICoqL1xuZXhwb3J0IGRlZmF1bHQgKE1vZGVsLCBjdHgpID0+IHtcbiAgLy8gQ3JlYXRlIGltcG9ydCBtZXRob2RcbiAgTW9kZWwuaW1wb3J0ID0gKHJlcSwgZmluaXNoKSA9PiB7XG4gICAgLy8gU2V0IG1vZGVsIG5hbWVzXG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyTmFtZSA9IChjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0Q29udGFpbmVyKSB8fCAnSW1wb3J0Q29udGFpbmVyJztcbiAgICBjb25zdCBJbXBvcnRMb2dOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRMb2cpIHx8ICdJbXBvcnRMb2cnO1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0Q29udGFpbmVyTmFtZV07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRMb2dOYW1lXTtcbiAgICBjb25zdCBjb250YWluZXJOYW1lID0gTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy0nICsgTWF0aC5yb3VuZChEYXRlLm5vdygpKSArICctJyArIE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDEwMDApO1xuICAgIGlmICghSW1wb3J0Q29udGFpbmVyIHx8ICFJbXBvcnRMb2cpIHtcbiAgICAgIHJldHVybiBmaW5pc2gobmV3IEVycm9yKCcobG9vcGJhY2staW1wb3J0LW1peGluKSBNaXNzaW5nIHJlcXVpcmVkIG1vZGVscywgdmVyaWZ5IHlvdXIgc2V0dXAgYW5kIGNvbmZpZ3VyYXRpb24nKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBDcmVhdGUgY29udGFpbmVyXG4gICAgICAgIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmNyZWF0ZUNvbnRhaW5lcih7IG5hbWU6IGNvbnRhaW5lck5hbWUgfSwgbmV4dCksXG4gICAgICAgIC8vIFVwbG9hZCBGaWxlXG4gICAgICAgIChjb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICByZXEucGFyYW1zLmNvbnRhaW5lciA9IGNvbnRhaW5lck5hbWU7XG4gICAgICAgICAgSW1wb3J0Q29udGFpbmVyLnVwbG9hZChyZXEsIHt9LCBuZXh0KTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGVyc2lzdCBwcm9jZXNzIGluIGRiIGFuZCBydW4gaW4gZm9yayBwcm9jZXNzXG4gICAgICAgIChmaWxlQ29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS50eXBlICE9PSAndGV4dC9jc3YnKSB7XG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihjb250YWluZXJOYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KG5ldyBFcnJvcignVGhlIGZpbGUgeW91IHNlbGVjdGVkIGlzIG5vdCBjc3YgZm9ybWF0JykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBTdG9yZSB0aGUgc3RhdGUgb2YgdGhlIGltcG9ydCBwcm9jZXNzIGluIHRoZSBkYXRhYmFzZVxuICAgICAgICAgIEltcG9ydExvZy5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0ZTogbW9tZW50KCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIG1vZGVsOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBzdGF0dXM6ICdQRU5ESU5HJyxcbiAgICAgICAgICB9LCAoZXJyLCBmaWxlVXBsb2FkKSA9PiBuZXh0KGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkpO1xuICAgICAgICB9LFxuICAgICAgXSwgKGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChlcnIsIGZpbGVDb250YWluZXIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBMYXVuY2ggYSBmb3JrIG5vZGUgcHJvY2VzcyB0aGF0IHdpbGwgaGFuZGxlIHRoZSBpbXBvcnRcbiAgICAgICAgY2hpbGRQcm9jZXNzLmZvcmsoX19kaXJuYW1lICsgJy9wcm9jZXNzZXMvaW1wb3J0LXByb2Nlc3MuanMnLCBbXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgc2NvcGU6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIGZpbGVVcGxvYWRJZDogZmlsZVVwbG9hZC5pZCxcbiAgICAgICAgICAgIHJvb3Q6IE1vZGVsLmFwcC5kYXRhc291cmNlcy5jb250YWluZXIuc2V0dGluZ3Mucm9vdCxcbiAgICAgICAgICAgIGNvbnRhaW5lcjogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGZpbGU6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5uYW1lLFxuICAgICAgICAgICAgSW1wb3J0Q29udGFpbmVyOiBJbXBvcnRDb250YWluZXJOYW1lLFxuICAgICAgICAgICAgSW1wb3J0TG9nOiBJbXBvcnRMb2dOYW1lLFxuICAgICAgICAgIH0pXSk7XG4gICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2gobnVsbCwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgIHJlc29sdmUoZmlsZUNvbnRhaW5lcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIENyZWF0ZSBpbXBvcnQgbWV0aG9kIChOb3QgQXZhaWxhYmxlIHRocm91Z2ggUkVTVClcbiAgICoqL1xuICBNb2RlbC5pbXBvcnRQcm9jZXNzb3IgPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9ICcuLi8uLi8nICsgb3B0aW9ucy5yb290ICsgJy8nICsgb3B0aW9ucy5jb250YWluZXIgKyAnLycgKyBvcHRpb25zLmZpbGU7XG4gICAgLy8gY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydENvbnRhaW5lcl07XG4gICAgY29uc3QgSW1wb3J0TG9nID0gTW9kZWwuYXBwLm1vZGVsc1tvcHRpb25zLkltcG9ydExvZ107XG4gICAgYXN5bmMud2F0ZXJmYWxsKFtcbiAgICAgIC8vIEdldCBJbXBvcnRMb2dcbiAgICAgIG5leHQgPT4gSW1wb3J0TG9nLmZpbmRCeUlkKG9wdGlvbnMuZmlsZVVwbG9hZElkLCBuZXh0KSxcbiAgICAgIC8vIFNldCBpbXBvcnRVcGxvYWQgc3RhdHVzIGFzIHByb2Nlc3NpbmdcbiAgICAgIChpbXBvcnRMb2csIG5leHQpID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZyA9IGltcG9ydExvZztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnUFJPQ0VTU0lORyc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgICAvLyBJbXBvcnQgRGF0YVxuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICAvLyBUaGlzIGxpbmUgb3BlbnMgdGhlIGZpbGUgYXMgYSByZWFkYWJsZSBzdHJlYW1cbiAgICAgICAgY29uc3Qgc2VyaWVzID0gW107XG4gICAgICAgIGZzLmNyZWF0ZVJlYWRTdHJlYW0oZmlsZVBhdGgpXG4gICAgICAgICAgLnBpcGUoY3N2KCkpXG4gICAgICAgICAgLm9uKCdkYXRhJywgcm93ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9iaiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICBpZiAocm93W2N0eC5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICBvYmpba2V5XSA9IHJvd1tjdHgubWFwW2tleV1dO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIW9ialtjdHgucGtdKSByZXR1cm47XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgLy8gTGV0cyBzZXQgZWFjaCByb3cgYSBmbG93XG4gICAgICAgICAgICBzZXJpZXMucHVzaChuZXh0U2VyaWUgPT4ge1xuICAgICAgICAgICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAgICAgICAgIC8vIFNlZSBpbiBEQiBmb3IgZXhpc3RpbmcgcGVyc2lzdGVkIGluc3RhbmNlXG4gICAgICAgICAgICAgICAgbmV4dEZhbGwgPT4gTW9kZWwuZmluZE9uZSh7IHdoZXJlOiBxdWVyeSB9LCBuZXh0RmFsbCksXG4gICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGluc3RhbmNlIHdlIGp1c3Qgc2V0IGEgd2FybmluZyBpbnRvIHRoZSBsb2dcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgY3R4LnBrICsgJyAnICsgb2JqW2N0eC5wa10gKyAnIGFscmVhZHkgZXhpc3RzLCB1cGRhdGluZyBmaWVsZHMgdG8gbmV3IHZhbHVlcy4nLFxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBfa2V5IGluIG9iaikge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoX2tleSkpIGluc3RhbmNlW19rZXldID0gb2JqW19rZXldO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGluc3RhbmNlLnNhdmUobmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgbmV4dEZhbGwobnVsbCwgbnVsbCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBPdGhlcndpc2Ugd2UgY3JlYXRlIGEgbmV3IGluc3RhbmNlXG4gICAgICAgICAgICAgICAgKGluc3RhbmNlLCBuZXh0RmFsbCkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGluc3RhbmNlKSByZXR1cm4gbmV4dEZhbGwobnVsbCwgaW5zdGFuY2UpO1xuICAgICAgICAgICAgICAgICAgTW9kZWwuY3JlYXRlKG9iaiwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gV29yayBvbiByZWxhdGlvbnNcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBGaW5hbGwgcGFyYWxsZWwgcHJvY2VzcyBjb250YWluZXJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmFsbGVsID0gW107XG4gICAgICAgICAgICAgICAgICBsZXQgc2V0dXBSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIGxldCBlbnN1cmVSZWxhdGlvbjtcbiAgICAgICAgICAgICAgICAgIC8vIEl0ZXJhdGVzIHRocm91Z2ggZXhpc3RpbmcgcmVsYXRpb25zIGluIG1vZGVsXG4gICAgICAgICAgICAgICAgICBzZXR1cFJlbGF0aW9uID0gZnVuY3Rpb24gc3IoZXhwZWN0ZWRSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGV4aXN0aW5nUmVsYXRpb24gaW4gTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAoTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXhpc3RpbmdSZWxhdGlvbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIC8vIE1ha2VzIHN1cmUgdGhlIHJlbGF0aW9uIGV4aXN0XG4gICAgICAgICAgICAgICAgICBlbnN1cmVSZWxhdGlvbiA9IGZ1bmN0aW9uIGVyKGV4cGVjdGVkUmVsYXRpb24sIGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGV4cGVjdGVkUmVsYXRpb24gPT09IGV4aXN0aW5nUmVsYXRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICBwYXJhbGxlbC5wdXNoKG5leHRQYXJhbGxlbCA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZWxRcnkgPSB7IHdoZXJlOiB7fSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBpbiBjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dLmhhc093blByb3BlcnR5KHByb3BlcnR5KSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbFFyeS53aGVyZVtwcm9wZXJ0eV0gPSByb3dbY3R4LnJlbGF0aW9uc1tleHBlY3RlZFJlbGF0aW9uXVtwcm9wZXJ0eV1dO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBNb2RlbC5hcHAubW9kZWxzW01vZGVsLmRlZmluaXRpb24uc2V0dGluZ3MucmVsYXRpb25zW2V4aXN0aW5nUmVsYXRpb25dLm1vZGVsXS5maW5kT25lKHJlbFFyeSwgKHJlbEVyciwgcmVsSW5zdGFuY2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbEVycikgcmV0dXJuIG5leHRQYXJhbGxlbChyZWxFcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlbEluc3RhbmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdzogcm93LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIHVuZXhpc3RpbmcgaW5zdGFuY2Ugb2YgJyArIGV4cGVjdGVkUmVsYXRpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5leHRQYXJhbGxlbCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGluc3RhbmNlW2V4cGVjdGVkUmVsYXRpb25dLmZpbmRCeUlkKHJlbEluc3RhbmNlLmlkLCAocmVsRXJyMiwgZXhpc3QpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXhpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cud2FybmluZ3MgPSBBcnJheS5pc0FycmF5KGN0eC5pbXBvcnRMb2cud2FybmluZ3MpID8gY3R4LmltcG9ydExvZy53YXJuaW5ncyA6IFtdO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICcuJyArIGV4cGVjdGVkUmVsYXRpb24gKyAnIHRyaWVkIHRvIHJlbGF0ZSBleGlzdGluZyByZWxhdGlvbi4nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRPRE8sIFZlcmlmeSBmb3IgZGlmZmVyZW50IHR5cGUgb2YgcmVsYXRpb25zLCB0aGlzIHdvcmtzIG9uIGhhc01hbnlUaHJvdWdoIGFuZCBIYXNNYW55QW5kQmVsb25nc1RvXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYnV0IHdoYXQgYWJvdXQganVzdCBoYXN0IG1hbnk/PyBzZWVtcyB3ZWlyZCBidXQgSWxsIGxlZnQgdGhpcyBoZXJlIGlmIGFueSBpc3N1ZXMgYXJlIHJpc2VkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uYWRkKHJlbEluc3RhbmNlLCBuZXh0UGFyYWxsZWwpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gV29yayBvbiBkZWZpbmVkIHJlbGF0aW9uc2hpcHNcbiAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXJzIGluIGN0eC5yZWxhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGN0eC5yZWxhdGlvbnMuaGFzT3duUHJvcGVydHkoZXJzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24oZXJzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgLy8gUnVuIHRoZSByZWxhdGlvbnMgcHJvY2VzcyBpbiBwYXJhbGxlbFxuICAgICAgICAgICAgICAgICAgYXN5bmMucGFyYWxsZWwocGFyYWxsZWwsIG5leHRGYWxsKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgZXJyb3IgaW4gdGhpcyBzZXJpZSB3ZSBsb2cgaXQgaW50byB0aGUgZXJyb3JzIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICAgICAgXSwgZXJyID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLmVycm9ycyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy5lcnJvcnMpID8gY3R4LmltcG9ydExvZy5lcnJvcnMgOiBbXTtcbiAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cuZXJyb3JzLnB1c2goeyByb3c6IHJvdywgbWVzc2FnZTogZXJyIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBuZXh0U2VyaWUoKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgICAgYXN5bmMuc2VyaWVzKHNlcmllcywgbmV4dCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgLy8gUmVtb3ZlIENvbnRhaW5lclxuICAgICAgLy8gbmV4dCA9PiBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcih7IGNvbnRhaW5lcjogb3B0aW9ucy5jb250YWluZXIgfSwgbmV4dCksXG4gICAgICAvLyBTZXQgc3RhdHVzIGFzIGZpbmlzaGVkXG4gICAgICBuZXh0ID0+IHtcbiAgICAgICAgY3R4LmltcG9ydExvZy5zdGF0dXMgPSAnRklOSVNIRUQnO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnNhdmUobmV4dCk7XG4gICAgICB9LFxuICAgIF0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyKSB0aHJvdyBuZXcgRXJyb3IoZXJyKTtcbiAgICAgIGZpbmlzaChlcnIpO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogUmVnaXN0ZXIgSW1wb3J0IE1ldGhvZFxuICAgKi9cbiAgTW9kZWwucmVtb3RlTWV0aG9kKCdpbXBvcnQnLCB7XG4gICAgaHR0cDogeyBwYXRoOiAnL2ltcG9ydCcsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246ICdCdWxrIHVwbG9hZCBhbmQgaW1wb3J0IGN2cyBmaWxlIHRvIHBlcnNpc3QgbmV3IGluc3RhbmNlcycsXG4gIH0pO1xufTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
