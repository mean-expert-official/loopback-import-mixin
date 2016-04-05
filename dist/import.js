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
    var filePath = __dirname + '../../../' + options.root + '/' + options.container + '/' + options.file;
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
//# sourceMappingURL=data:application/json;base64,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QUF1QixVQUF2QixDQURNO0FBRU4sVUFBSSxTQUFKLENBQWMsSUFBZCxDQUFtQixJQUFuQixFQUZNO0tBQVIsQ0FoSUYsRUFvSUcsZUFBTztBQUNSLFVBQUksR0FBSixFQUFTLE1BQU0sSUFBSSxLQUFKLENBQVUsR0FBVixDQUFOLENBQVQ7QUFDQSxhQUFPLEdBQVAsRUFGUTtLQUFQLENBcElILENBSjhFO0dBQXhEOzs7O0FBMURLLE9BME03QixDQUFNLFlBQU4sQ0FBbUIsUUFBbkIsRUFBNkI7QUFDM0IsVUFBTSxFQUFFLE1BQU0sU0FBTixFQUFpQixNQUFNLE1BQU4sRUFBekI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSwwREFBYjtHQVJGLEVBMU02QjtDQUFoQiIsImZpbGUiOiJpbXBvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCBjc3YgZnJvbSAnY3N2LXBhcnNlcic7XG5pbXBvcnQgZnMgZnJvbSAnZnMnO1xuLy8gaW1wb3J0IERhdGFTb3VyY2VCdWlsZGVyIGZyb20gJy4vYnVpbGRlcnMvZGF0YXNvdXJjZS1idWlsZGVyJztcbi8qKlxuICAqIEJ1bGsgSW1wb3J0IE1peGluXG4gICogQEF1dGhvciBKb25hdGhhbiBDYXNhcnJ1Ymlhc1xuICAqIEBTZWUgPGh0dHBzOi8vdHdpdHRlci5jb20vam9obmNhc2FycnViaWFzPlxuICAqIEBTZWUgPGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBAU2VlIDxodHRwczovL2dpdGh1Yi5jb20vam9uYXRoYW4tY2FzYXJydWJpYXMvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBEZXNjcmlwdGlvblxuICAqXG4gICogVGhlIGZvbGxvd2luZyBtaXhpbiB3aWxsIGFkZCBidWxrIGltcG9ydGluZyBmdW5jdGlvbmFsbGl0eSB0byBtb2RlbHMgd2hpY2ggaW5jbHVkZXNcbiAgKiB0aGlzIG1vZHVsZS5cbiAgKlxuICAqIERlZmF1bHQgQ29uZmlndXJhdGlvblxuICAqXG4gICogXCJJbXBvcnRcIjoge1xuICAqICAgXCJtb2RlbHNcIjoge1xuICAqICAgICBcIkltcG9ydENvbnRhaW5lclwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0TG9nXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICAvLyBDcmVhdGUgaW1wb3J0IG1ldGhvZFxuICBNb2RlbC5pbXBvcnQgPSAocmVxLCBmaW5pc2gpID0+IHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydExvZ05hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydExvZykgfHwgJ0ltcG9ydExvZyc7XG4gICAgY29uc3QgSW1wb3J0Q29udGFpbmVyID0gTW9kZWwuYXBwLm1vZGVsc1tJbXBvcnRDb250YWluZXJOYW1lXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydExvZ05hbWVdO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydExvZykge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0TG9nLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRMb2c6IEltcG9ydExvZ05hbWUsXG4gICAgICAgICAgfSldKTtcbiAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChudWxsLCBmaWxlQ29udGFpbmVyKTtcbiAgICAgICAgcmVzb2x2ZShmaWxlQ29udGFpbmVyKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuICAvKipcbiAgICogQ3JlYXRlIGltcG9ydCBtZXRob2QgKE5vdCBBdmFpbGFibGUgdGhyb3VnaCBSRVNUKVxuICAgKiovXG4gIE1vZGVsLmltcG9ydFByb2Nlc3NvciA9IGZ1bmN0aW9uIEltcG9ydE1ldGhvZChjb250YWluZXIsIGZpbGUsIG9wdGlvbnMsIGZpbmlzaCkge1xuICAgIGNvbnN0IGZpbGVQYXRoID0gX19kaXJuYW1lICsgJy4uLy4uLy4uLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICAvLyBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRMb2cgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0TG9nXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IEltcG9ydExvZ1xuICAgICAgbmV4dCA9PiBJbXBvcnRMb2cuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydExvZywgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nID0gaW1wb3J0TG9nO1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydExvZy5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0TG9nLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBjb25zdCBzZXJpZXMgPSBbXTtcbiAgICAgICAgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aClcbiAgICAgICAgICAucGlwZShjc3YoKSlcbiAgICAgICAgICAub24oJ2RhdGEnLCByb3cgPT4ge1xuICAgICAgICAgICAgY29uc3Qgb2JqID0ge307XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGtleSBpbiBjdHgubWFwKSB7XG4gICAgICAgICAgICAgIGlmIChyb3dbY3R4Lm1hcFtrZXldXSkge1xuICAgICAgICAgICAgICAgIG9ialtrZXldID0gcm93W2N0eC5tYXBba2V5XV07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghb2JqW2N0eC5wa10pIHJldHVybjtcbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5ID0ge307XG4gICAgICAgICAgICBxdWVyeVtjdHgucGtdID0gb2JqW2N0eC5wa107XG4gICAgICAgICAgICAvLyBMZXRzIHNldCBlYWNoIHJvdyBhIGZsb3dcbiAgICAgICAgICAgIHNlcmllcy5wdXNoKG5leHRTZXJpZSA9PiB7XG4gICAgICAgICAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgICAgICAgICAgLy8gU2VlIGluIERCIGZvciBleGlzdGluZyBwZXJzaXN0ZWQgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICBuZXh0RmFsbCA9PiBNb2RlbC5maW5kT25lKHsgd2hlcmU6IHF1ZXJ5IH0sIG5leHRGYWxsKSxcbiAgICAgICAgICAgICAgICAvLyBJZiB3ZSBnZXQgYW4gaW5zdGFuY2Ugd2UganVzdCBzZXQgYSB3YXJuaW5nIGludG8gdGhlIGxvZ1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIGlmIChpbnN0YW5jZSkge1xuICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncy5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBjdHgucGsgKyAnICcgKyBvYmpbY3R4LnBrXSArICcgYWxyZWFkeSBleGlzdHMsIHVwZGF0aW5nIGZpZWxkcyB0byBuZXcgdmFsdWVzLicsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IF9rZXkgaW4gb2JqKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShfa2V5KSkgaW5zdGFuY2VbX2tleV0gPSBvYmpbX2tleV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2Uuc2F2ZShuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBuZXh0RmFsbChudWxsLCBudWxsKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIC8vIE90aGVyd2lzZSB3ZSBjcmVhdGUgYSBuZXcgaW5zdGFuY2VcbiAgICAgICAgICAgICAgICAoaW5zdGFuY2UsIG5leHRGYWxsKSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoaW5zdGFuY2UpIHJldHVybiBuZXh0RmFsbChudWxsLCBpbnN0YW5jZSk7XG4gICAgICAgICAgICAgICAgICBNb2RlbC5jcmVhdGUob2JqLCBuZXh0RmFsbCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIHJlbGF0aW9uc1xuICAgICAgICAgICAgICAgIChpbnN0YW5jZSwgbmV4dEZhbGwpID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIEZpbmFsbCBwYXJhbGxlbCBwcm9jZXNzIGNvbnRhaW5lclxuICAgICAgICAgICAgICAgICAgY29uc3QgcGFyYWxsZWwgPSBbXTtcbiAgICAgICAgICAgICAgICAgIGxldCBzZXR1cFJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgbGV0IGVuc3VyZVJlbGF0aW9uO1xuICAgICAgICAgICAgICAgICAgLy8gSXRlcmF0ZXMgdGhyb3VnaCBleGlzdGluZyByZWxhdGlvbnMgaW4gbW9kZWxcbiAgICAgICAgICAgICAgICAgIHNldHVwUmVsYXRpb24gPSBmdW5jdGlvbiBzcihleHBlY3RlZFJlbGF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZXhpc3RpbmdSZWxhdGlvbiBpbiBNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChNb2RlbC5kZWZpbml0aW9uLnNldHRpbmdzLnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShleGlzdGluZ1JlbGF0aW9uKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgZW5zdXJlUmVsYXRpb24oZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbik7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgLy8gTWFrZXMgc3VyZSB0aGUgcmVsYXRpb24gZXhpc3RcbiAgICAgICAgICAgICAgICAgIGVuc3VyZVJlbGF0aW9uID0gZnVuY3Rpb24gZXIoZXhwZWN0ZWRSZWxhdGlvbiwgZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXhwZWN0ZWRSZWxhdGlvbiA9PT0gZXhpc3RpbmdSZWxhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAgIHBhcmFsbGVsLnB1c2gobmV4dFBhcmFsbGVsID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlbFFyeSA9IHsgd2hlcmU6IHt9IH07XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHByb3BlcnR5IGluIGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGN0eC5yZWxhdGlvbnNbZXhwZWN0ZWRSZWxhdGlvbl0uaGFzT3duUHJvcGVydHkocHJvcGVydHkpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVsUXJ5LndoZXJlW3Byb3BlcnR5XSA9IHJvd1tjdHgucmVsYXRpb25zW2V4cGVjdGVkUmVsYXRpb25dW3Byb3BlcnR5XV07XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIE1vZGVsLmFwcC5tb2RlbHNbTW9kZWwuZGVmaW5pdGlvbi5zZXR0aW5ncy5yZWxhdGlvbnNbZXhpc3RpbmdSZWxhdGlvbl0ubW9kZWxdLmZpbmRPbmUocmVsUXJ5LCAocmVsRXJyLCByZWxJbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVsRXJyKSByZXR1cm4gbmV4dFBhcmFsbGVsKHJlbEVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghcmVsSW5zdGFuY2UpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLndhcm5pbmdzKSA/IGN0eC5pbXBvcnRMb2cud2FybmluZ3MgOiBbXTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93OiByb3csXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLicgKyBleHBlY3RlZFJlbGF0aW9uICsgJyB0cmllZCB0byByZWxhdGUgdW5leGlzdGluZyBpbnN0YW5jZSBvZiAnICsgZXhwZWN0ZWRSZWxhdGlvbixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV4dFBhcmFsbGVsKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgaW5zdGFuY2VbZXhwZWN0ZWRSZWxhdGlvbl0uZmluZEJ5SWQocmVsSW5zdGFuY2UuaWQsIChyZWxFcnIyLCBleGlzdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChleGlzdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy53YXJuaW5ncyA9IEFycmF5LmlzQXJyYXkoY3R4LmltcG9ydExvZy53YXJuaW5ncykgPyBjdHguaW1wb3J0TG9nLndhcm5pbmdzIDogW107XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjdHguaW1wb3J0TG9nLndhcm5pbmdzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByb3c6IHJvdyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lICsgJy4nICsgZXhwZWN0ZWRSZWxhdGlvbiArICcgdHJpZWQgdG8gcmVsYXRlIGV4aXN0aW5nIHJlbGF0aW9uLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXh0UGFyYWxsZWwoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVE9ETywgVmVyaWZ5IGZvciBkaWZmZXJlbnQgdHlwZSBvZiByZWxhdGlvbnMsIHRoaXMgd29ya3Mgb24gaGFzTWFueVRocm91Z2ggYW5kIEhhc01hbnlBbmRCZWxvbmdzVG9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBidXQgd2hhdCBhYm91dCBqdXN0IGhhc3QgbWFueT8/IHNlZW1zIHdlaXJkIGJ1dCBJbGwgbGVmdCB0aGlzIGhlcmUgaWYgYW55IGlzc3VlcyBhcmUgcmlzZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnN0YW5jZVtleHBlY3RlZFJlbGF0aW9uXS5hZGQocmVsSW5zdGFuY2UsIG5leHRQYXJhbGxlbCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAvLyBXb3JrIG9uIGRlZmluZWQgcmVsYXRpb25zaGlwc1xuICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBlcnMgaW4gY3R4LnJlbGF0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoY3R4LnJlbGF0aW9ucy5oYXNPd25Qcm9wZXJ0eShlcnMpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgc2V0dXBSZWxhdGlvbihlcnMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAvLyBSdW4gdGhlIHJlbGF0aW9ucyBwcm9jZXNzIGluIHBhcmFsbGVsXG4gICAgICAgICAgICAgICAgICBhc3luYy5wYXJhbGxlbChwYXJhbGxlbCwgbmV4dEZhbGwpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgLy8gSWYgdGhlcmUgYXJlIGFueSBlcnJvciBpbiB0aGlzIHNlcmllIHdlIGxvZyBpdCBpbnRvIHRoZSBlcnJvcnMgYXJyYXkgb2Ygb2JqZWN0c1xuICAgICAgICAgICAgICBdLCBlcnIgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgIGN0eC5pbXBvcnRMb2cuZXJyb3JzID0gQXJyYXkuaXNBcnJheShjdHguaW1wb3J0TG9nLmVycm9ycykgPyBjdHguaW1wb3J0TG9nLmVycm9ycyA6IFtdO1xuICAgICAgICAgICAgICAgICAgY3R4LmltcG9ydExvZy5lcnJvcnMucHVzaCh7IHJvdzogcm93LCBtZXNzYWdlOiBlcnIgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5leHRTZXJpZSgpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICBhc3luYy5zZXJpZXMoc2VyaWVzLCBuZXh0KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICAvLyBSZW1vdmUgQ29udGFpbmVyXG4gICAgICAvLyBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKHsgY29udGFpbmVyOiBvcHRpb25zLmNvbnRhaW5lciB9LCBuZXh0KSxcbiAgICAgIC8vIFNldCBzdGF0dXMgYXMgZmluaXNoZWRcbiAgICAgIG5leHQgPT4ge1xuICAgICAgICBjdHguaW1wb3J0TG9nLnN0YXR1cyA9ICdGSU5JU0hFRCc7XG4gICAgICAgIGN0eC5pbXBvcnRMb2cuc2F2ZShuZXh0KTtcbiAgICAgIH0sXG4gICAgXSwgZXJyID0+IHtcbiAgICAgIGlmIChlcnIpIHRocm93IG5ldyBFcnJvcihlcnIpO1xuICAgICAgZmluaXNoKGVycik7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBSZWdpc3RlciBJbXBvcnQgTWV0aG9kXG4gICAqL1xuICBNb2RlbC5yZW1vdGVNZXRob2QoJ2ltcG9ydCcsIHtcbiAgICBodHRwOiB7IHBhdGg6ICcvaW1wb3J0JywgdmVyYjogJ3Bvc3QnIH0sXG4gICAgYWNjZXB0czogW3tcbiAgICAgIGFyZzogJ3JlcScsXG4gICAgICB0eXBlOiAnb2JqZWN0JyxcbiAgICAgIGh0dHA6IHsgc291cmNlOiAncmVxJyB9LFxuICAgIH1dLFxuICAgIHJldHVybnM6IHsgdHlwZTogJ29iamVjdCcsIHJvb3Q6IHRydWUgfSxcbiAgICBkZXNjcmlwdGlvbjogJ0J1bGsgdXBsb2FkIGFuZCBpbXBvcnQgY3ZzIGZpbGUgdG8gcGVyc2lzdCBuZXcgaW5zdGFuY2VzJyxcbiAgfSk7XG59O1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
