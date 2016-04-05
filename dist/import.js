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
  *     "ImportUpload": "Model",
  *     "ImportUploadError": "Model"
  *   }
  * }
  **/

exports.default = function (Model, ctx) {
  // Create import method
  Model.import = function (req, finish) {
    // Set model names
    var ImportContainerName = ctx.models && ctx.models.ImportContainer || 'ImportContainer';
    var ImportUploadName = ctx.models && ctx.models.ImportUpload || 'ImportUpload';
    var ImportUploadErrorName = ctx.models && ctx.models.ImportUploadError || 'ImportUploadError';
    var ImportContainer = Model.app.models[ImportContainerName];
    var ImportUpload = Model.app.models[ImportUploadName];
    var ImportUploadError = Model.app.models[ImportUploadErrorName];
    var containerName = Model.definition.name + '-' + Math.round(Date.now()) + '-' + Math.round(Math.random() * 1000);
    if (!ImportContainer || !ImportUpload || !ImportUploadError) {
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
        ImportUpload.create({
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
          ImportUpload: ImportUploadName,
          ImportUploadError: ImportUploadErrorName
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
    var filePath = '/Volumes/backup/development/mobile/sjc/sjc-api/' + options.root + '/' + options.container + '/' + options.file;
    var ImportContainer = Model.app.models[options.ImportContainer];
    var ImportUpload = Model.app.models[options.ImportUpload];
    _async2.default.waterfall([
    // Get importUpload
    function (next) {
      return ImportUpload.findById(options.fileUploadId, next);
    },
    // Set importUpload status as processing
    function (importUpload, next) {
      ctx.importUpload = importUpload;
      ctx.importUpload.status = 'PROCESSING';
      ctx.importUpload.save(next);
    },
    // Import Data
    function (importUpload, next) {
      // This line opens the file as a readable stream
      _fs2.default.createReadStream(filePath).pipe((0, _csvParser2.default)()).on('data', function (row) {
        var obj = {};
        for (var key in ctx.map) {
          if (row[ctx.map[key]]) {
            obj[key] = row[ctx.map[key]];
          }
        }
        var query = {};
        query[ctx.pk] = obj[ctx.pk];
        console.log(obj);
        // Find or create instance
        Model.findOrCreate({ where: query }, obj, function (err, instance) {
          if (err) importUpload.errors.create({ row: row });
          console.log(instance);
          // TODO Work on relationships
        });
      }).on('end', function () {
        return next();
      });
    },
    // Remove Container
    function (next) {
      return ImportContainer.remove({ container: options.container }, next);
    },
    // Set status as finished
    function (next) {
      ctx.importUpload.status = 'FINISHED';
      ctx.importUpload.save(next);
    }], finish);
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
//# sourceMappingURL=data:application/json;base64,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QXBDLEVBQXlELElBQXpEO0tBQVI7O0FBRUEsb0JBQVE7QUFDTixVQUFJLFlBQUosQ0FBaUIsTUFBakIsR0FBMEIsVUFBMUIsQ0FETTtBQUVOLFVBQUksWUFBSixDQUFpQixJQUFqQixDQUFzQixJQUF0QixFQUZNO0tBQVIsQ0FwQ0YsRUF3Q0csTUF4Q0gsRUFKOEU7R0FBeEQ7Ozs7QUE3REssT0E4RzdCLENBQU0sWUFBTixDQUFtQixRQUFuQixFQUE2QjtBQUMzQixVQUFNLEVBQUUsTUFBTSxTQUFOLEVBQWlCLE1BQU0sTUFBTixFQUF6QjtBQUNBLGFBQVMsQ0FBQztBQUNSLFdBQUssS0FBTDtBQUNBLFlBQU0sUUFBTjtBQUNBLFlBQU0sRUFBRSxRQUFRLEtBQVIsRUFBUjtLQUhPLENBQVQ7QUFLQSxhQUFTLEVBQUUsTUFBTSxRQUFOLEVBQWdCLE1BQU0sSUFBTixFQUEzQjtBQUNBLGlCQUFhLDBEQUFiO0dBUkYsRUE5RzZCO0NBQWhCIiwiZmlsZSI6ImltcG9ydC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU3RhdHMgTWl4aW4gRGVwZW5kZW5jaWVzXG4gKi9cbmltcG9ydCBhc3luYyBmcm9tICdhc3luYyc7XG5pbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgY2hpbGRQcm9jZXNzIGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IGNzdiBmcm9tICdjc3YtcGFyc2VyJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG4vLyBpbXBvcnQgRGF0YVNvdXJjZUJ1aWxkZXIgZnJvbSAnLi9idWlsZGVycy9kYXRhc291cmNlLWJ1aWxkZXInO1xuLyoqXG4gICogQnVsayBJbXBvcnQgTWl4aW5cbiAgKiBAQXV0aG9yIEpvbmF0aGFuIENhc2FycnViaWFzXG4gICogQFNlZSA8aHR0cHM6Ly90d2l0dGVyLmNvbS9qb2huY2FzYXJydWJpYXM+XG4gICogQFNlZSA8aHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbG9vcGJhY2staW1wb3J0LW1peGluPlxuICAqIEBTZWUgPGh0dHBzOi8vZ2l0aHViLmNvbS9qb25hdGhhbi1jYXNhcnJ1Ymlhcy9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQERlc2NyaXB0aW9uXG4gICpcbiAgKiBUaGUgZm9sbG93aW5nIG1peGluIHdpbGwgYWRkIGJ1bGsgaW1wb3J0aW5nIGZ1bmN0aW9uYWxsaXR5IHRvIG1vZGVscyB3aGljaCBpbmNsdWRlc1xuICAqIHRoaXMgbW9kdWxlLlxuICAqXG4gICogRGVmYXVsdCBDb25maWd1cmF0aW9uXG4gICpcbiAgKiBcIkltcG9ydFwiOiB7XG4gICogICBcIm1vZGVsc1wiOiB7XG4gICogICAgIFwiSW1wb3J0Q29udGFpbmVyXCI6IFwiTW9kZWxcIixcbiAgKiAgICAgXCJJbXBvcnRVcGxvYWRcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydFVwbG9hZEVycm9yXCI6IFwiTW9kZWxcIlxuICAqICAgfVxuICAqIH1cbiAgKiovXG5leHBvcnQgZGVmYXVsdCAoTW9kZWwsIGN0eCkgPT4ge1xuICAvLyBDcmVhdGUgaW1wb3J0IG1ldGhvZFxuICBNb2RlbC5pbXBvcnQgPSAocmVxLCBmaW5pc2gpID0+IHtcbiAgICAvLyBTZXQgbW9kZWwgbmFtZXNcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXJOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInO1xuICAgIGNvbnN0IEltcG9ydFVwbG9hZE5hbWUgPSAoY3R4Lm1vZGVscyAmJiBjdHgubW9kZWxzLkltcG9ydFVwbG9hZCkgfHwgJ0ltcG9ydFVwbG9hZCc7XG4gICAgY29uc3QgSW1wb3J0VXBsb2FkRXJyb3JOYW1lID0gKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRVcGxvYWRFcnJvcikgfHwgJ0ltcG9ydFVwbG9hZEVycm9yJztcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydENvbnRhaW5lck5hbWVdO1xuICAgIGNvbnN0IEltcG9ydFVwbG9hZCA9IE1vZGVsLmFwcC5tb2RlbHNbSW1wb3J0VXBsb2FkTmFtZV07XG4gICAgY29uc3QgSW1wb3J0VXBsb2FkRXJyb3IgPSBNb2RlbC5hcHAubW9kZWxzW0ltcG9ydFVwbG9hZEVycm9yTmFtZV07XG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9IE1vZGVsLmRlZmluaXRpb24ubmFtZSArICctJyArIE1hdGgucm91bmQoRGF0ZS5ub3coKSkgKyAnLScgKyBNYXRoLnJvdW5kKE1hdGgucmFuZG9tKCkgKiAxMDAwKTtcbiAgICBpZiAoIUltcG9ydENvbnRhaW5lciB8fCAhSW1wb3J0VXBsb2FkIHx8ICFJbXBvcnRVcGxvYWRFcnJvcikge1xuICAgICAgcmV0dXJuIGZpbmlzaChuZXcgRXJyb3IoJyhsb29wYmFjay1pbXBvcnQtbWl4aW4pIE1pc3NpbmcgcmVxdWlyZWQgbW9kZWxzLCB2ZXJpZnkgeW91ciBzZXR1cCBhbmQgY29uZmlndXJhdGlvbicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGFzeW5jLndhdGVyZmFsbChbXG4gICAgICAgIC8vIENyZWF0ZSBjb250YWluZXJcbiAgICAgICAgbmV4dCA9PiBJbXBvcnRDb250YWluZXIuY3JlYXRlQ29udGFpbmVyKHsgbmFtZTogY29udGFpbmVyTmFtZSB9LCBuZXh0KSxcbiAgICAgICAgLy8gVXBsb2FkIEZpbGVcbiAgICAgICAgKGNvbnRhaW5lciwgbmV4dCkgPT4ge1xuICAgICAgICAgIHJlcS5wYXJhbXMuY29udGFpbmVyID0gY29udGFpbmVyTmFtZTtcbiAgICAgICAgICBJbXBvcnRDb250YWluZXIudXBsb2FkKHJlcSwge30sIG5leHQpO1xuICAgICAgICB9LFxuICAgICAgICAvLyBQZXJzaXN0IHByb2Nlc3MgaW4gZGIgYW5kIHJ1biBpbiBmb3JrIHByb2Nlc3NcbiAgICAgICAgKGZpbGVDb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLnR5cGUgIT09ICd0ZXh0L2NzdicpIHtcbiAgICAgICAgICAgIEltcG9ydENvbnRhaW5lci5kZXN0cm95Q29udGFpbmVyKGNvbnRhaW5lck5hbWUpO1xuICAgICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKCdUaGUgZmlsZSB5b3Ugc2VsZWN0ZWQgaXMgbm90IGNzdiBmb3JtYXQnKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIFN0b3JlIHRoZSBzdGF0ZSBvZiB0aGUgaW1wb3J0IHByb2Nlc3MgaW4gdGhlIGRhdGFiYXNlXG4gICAgICAgICAgSW1wb3J0VXBsb2FkLmNyZWF0ZSh7XG4gICAgICAgICAgICBkYXRlOiBtb21lbnQoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbW9kZWw6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIHN0YXR1czogJ1BFTkRJTkcnLFxuICAgICAgICAgIH0sIChlcnIsIGZpbGVVcGxvYWQpID0+IG5leHQoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSk7XG4gICAgICAgIH0sXG4gICAgICBdLCAoZXJyLCBmaWxlQ29udGFpbmVyLCBmaWxlVXBsb2FkKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKGVyciwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIExhdW5jaCBhIGZvcmsgbm9kZSBwcm9jZXNzIHRoYXQgd2lsbCBoYW5kbGUgdGhlIGltcG9ydFxuICAgICAgICBjaGlsZFByb2Nlc3MuZm9yayhfX2Rpcm5hbWUgKyAnL3Byb2Nlc3Nlcy9pbXBvcnQtcHJvY2Vzcy5qcycsIFtcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBzY29wZTogTW9kZWwuZGVmaW5pdGlvbi5uYW1lLFxuICAgICAgICAgICAgZmlsZVVwbG9hZElkOiBmaWxlVXBsb2FkLmlkLFxuICAgICAgICAgICAgcm9vdDogTW9kZWwuYXBwLmRhdGFzb3VyY2VzLmNvbnRhaW5lci5zZXR0aW5ncy5yb290LFxuICAgICAgICAgICAgY29udGFpbmVyOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0uY29udGFpbmVyLFxuICAgICAgICAgICAgZmlsZTogZmlsZUNvbnRhaW5lci5maWxlcy5maWxlWzBdLm5hbWUsXG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXI6IEltcG9ydENvbnRhaW5lck5hbWUsXG4gICAgICAgICAgICBJbXBvcnRVcGxvYWQ6IEltcG9ydFVwbG9hZE5hbWUsXG4gICAgICAgICAgICBJbXBvcnRVcGxvYWRFcnJvcjogSW1wb3J0VXBsb2FkRXJyb3JOYW1lLFxuICAgICAgICAgIH0pXSk7XG4gICAgICAgIGlmICh0eXBlb2YgZmluaXNoID09PSAnZnVuY3Rpb24nKSBmaW5pc2gobnVsbCwgZmlsZUNvbnRhaW5lcik7XG4gICAgICAgIHJlc29sdmUoZmlsZUNvbnRhaW5lcik7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcbiAgLyoqXG4gICAqIENyZWF0ZSBpbXBvcnQgbWV0aG9kIChOb3QgQXZhaWxhYmxlIHRocm91Z2ggUkVTVClcbiAgICoqL1xuICBNb2RlbC5pbXBvcnRQcm9jZXNzb3IgPSBmdW5jdGlvbiBJbXBvcnRNZXRob2QoY29udGFpbmVyLCBmaWxlLCBvcHRpb25zLCBmaW5pc2gpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9ICcvVm9sdW1lcy9iYWNrdXAvZGV2ZWxvcG1lbnQvbW9iaWxlL3NqYy9zamMtYXBpLycgKyBvcHRpb25zLnJvb3QgKyAnLycgKyBvcHRpb25zLmNvbnRhaW5lciArICcvJyArIG9wdGlvbnMuZmlsZTtcbiAgICBjb25zdCBJbXBvcnRDb250YWluZXIgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0Q29udGFpbmVyXTtcbiAgICBjb25zdCBJbXBvcnRVcGxvYWQgPSBNb2RlbC5hcHAubW9kZWxzW29wdGlvbnMuSW1wb3J0VXBsb2FkXTtcbiAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgLy8gR2V0IGltcG9ydFVwbG9hZFxuICAgICAgbmV4dCA9PiBJbXBvcnRVcGxvYWQuZmluZEJ5SWQob3B0aW9ucy5maWxlVXBsb2FkSWQsIG5leHQpLFxuICAgICAgLy8gU2V0IGltcG9ydFVwbG9hZCBzdGF0dXMgYXMgcHJvY2Vzc2luZ1xuICAgICAgKGltcG9ydFVwbG9hZCwgbmV4dCkgPT4ge1xuICAgICAgICBjdHguaW1wb3J0VXBsb2FkID0gaW1wb3J0VXBsb2FkO1xuICAgICAgICBjdHguaW1wb3J0VXBsb2FkLnN0YXR1cyA9ICdQUk9DRVNTSU5HJztcbiAgICAgICAgY3R4LmltcG9ydFVwbG9hZC5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICAgIC8vIEltcG9ydCBEYXRhXG4gICAgICAoaW1wb3J0VXBsb2FkLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIFRoaXMgbGluZSBvcGVucyB0aGUgZmlsZSBhcyBhIHJlYWRhYmxlIHN0cmVhbVxuICAgICAgICBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKVxuICAgICAgICAgIC5waXBlKGNzdigpKVxuICAgICAgICAgIC5vbignZGF0YScsIChyb3cpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG9iaiA9IHt9O1xuICAgICAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gY3R4Lm1hcCkge1xuICAgICAgICAgICAgICBpZiAocm93W2N0eC5tYXBba2V5XV0pIHtcbiAgICAgICAgICAgICAgICBvYmpba2V5XSA9IHJvd1tjdHgubWFwW2tleV1dO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBxdWVyeSA9IHt9O1xuICAgICAgICAgICAgcXVlcnlbY3R4LnBrXSA9IG9ialtjdHgucGtdO1xuICAgICAgICAgICAgY29uc29sZS5sb2cob2JqKTtcbiAgICAgICAgICAgIC8vIEZpbmQgb3IgY3JlYXRlIGluc3RhbmNlXG4gICAgICAgICAgICBNb2RlbC5maW5kT3JDcmVhdGUoeyB3aGVyZTogcXVlcnkgfSwgb2JqLCAoZXJyLCBpbnN0YW5jZSkgPT4ge1xuICAgICAgICAgICAgICBpZiAoZXJyKSBpbXBvcnRVcGxvYWQuZXJyb3JzLmNyZWF0ZSh7IHJvdzogcm93IH0pO1xuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhpbnN0YW5jZSk7XG4gICAgICAgICAgICAgIC8vIFRPRE8gV29yayBvbiByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5vbignZW5kJywgKCkgPT4gbmV4dCgpKTtcbiAgICAgIH0sXG4gICAgICAvLyBSZW1vdmUgQ29udGFpbmVyXG4gICAgICBuZXh0ID0+IEltcG9ydENvbnRhaW5lci5yZW1vdmUoeyBjb250YWluZXI6IG9wdGlvbnMuY29udGFpbmVyIH0sIG5leHQpLFxuICAgICAgLy8gU2V0IHN0YXR1cyBhcyBmaW5pc2hlZFxuICAgICAgbmV4dCA9PiB7XG4gICAgICAgIGN0eC5pbXBvcnRVcGxvYWQuc3RhdHVzID0gJ0ZJTklTSEVEJztcbiAgICAgICAgY3R4LmltcG9ydFVwbG9hZC5zYXZlKG5leHQpO1xuICAgICAgfSxcbiAgICBdLCBmaW5pc2gpO1xuICB9O1xuICAvKipcbiAgICogUmVnaXN0ZXIgSW1wb3J0IE1ldGhvZFxuICAgKi9cbiAgTW9kZWwucmVtb3RlTWV0aG9kKCdpbXBvcnQnLCB7XG4gICAgaHR0cDogeyBwYXRoOiAnL2ltcG9ydCcsIHZlcmI6ICdwb3N0JyB9LFxuICAgIGFjY2VwdHM6IFt7XG4gICAgICBhcmc6ICdyZXEnLFxuICAgICAgdHlwZTogJ29iamVjdCcsXG4gICAgICBodHRwOiB7IHNvdXJjZTogJ3JlcScgfSxcbiAgICB9XSxcbiAgICByZXR1cm5zOiB7IHR5cGU6ICdvYmplY3QnLCByb290OiB0cnVlIH0sXG4gICAgZGVzY3JpcHRpb246ICdCdWxrIHVwbG9hZCBhbmQgaW1wb3J0IGN2cyBmaWxlIHRvIHBlcnNpc3QgbmV3IGluc3RhbmNlcycsXG4gIH0pO1xufTtcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
