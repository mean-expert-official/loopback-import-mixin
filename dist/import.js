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
    var ImportContainer = Model.app.models[ctx.models && ctx.models.ImportContainer || 'ImportContainer'];
    var ImportUpload = Model.app.models[ctx.models && ctx.models.ImportUpload || 'ImportUpload'];
    var ImportUploadError = Model.app.models[ctx.models && ctx.models.ImportUploadError || 'ImportUploadError'];
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
        _child_process2.default.fork('/Volumes/backup/development/www/my-modules/loopback-import-mixin/dist/processes/import-process.js', [(0, _stringify2.default)({
          scope: Model.definition.name,
          fileUpload: fileUpload.id,
          root: Model.app.datasources.container.settings.root,
          container: fileContainer.files.file[0].container,
          file: fileContainer.files.file[0].name
        })]);
        if (typeof finish === 'function') finish(null, fileContainer);
        resolve(fileContainer);
      });
    });
  };
  /**
   * Create import method (Not Available through REST)
   **/
  Model.importProcessor = function ImportMethod(container, file, options, next) {
    next();
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
//# sourceMappingURL=data:application/json;base64,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QVYsQ0FBc0IsU0FBdEIsQ0FBZ0MsUUFBaEMsQ0FBeUMsSUFBekM7QUFDTixxQkFBVyxjQUFjLEtBQWQsQ0FBb0IsSUFBcEIsQ0FBeUIsQ0FBekIsRUFBNEIsU0FBNUI7QUFDWCxnQkFBTSxjQUFjLEtBQWQsQ0FBb0IsSUFBcEIsQ0FBeUIsQ0FBekIsRUFBNEIsSUFBNUI7U0FMUixDQURxSCxDQUF2SCxFQU5xQztBQWNyQyxZQUFJLE9BQU8sTUFBUCxLQUFrQixVQUFsQixFQUE4QixPQUFPLElBQVAsRUFBYSxhQUFiLEVBQWxDO0FBQ0EsZ0JBQVEsYUFBUixFQWZxQztPQUFwQyxDQXJCSCxDQURzQztLQUFyQixDQUFuQixDQVQ4QjtHQUFqQjs7OztBQUZjLE9BdUQ3QixDQUFNLGVBQU4sR0FBd0IsU0FBUyxZQUFULENBQXNCLFNBQXRCLEVBQWlDLElBQWpDLEVBQXVDLE9BQXZDLEVBQWdELElBQWhELEVBQXNEO0FBQzVFLFdBRDRFO0dBQXREOzs7O0FBdkRLLE9BNkQ3QixDQUFNLFlBQU4sQ0FBbUIsUUFBbkIsRUFBNkI7QUFDM0IsVUFBTSxFQUFFLE1BQU0sU0FBTixFQUFpQixNQUFNLE1BQU4sRUFBekI7QUFDQSxhQUFTLENBQUM7QUFDUixXQUFLLEtBQUw7QUFDQSxZQUFNLFFBQU47QUFDQSxZQUFNLEVBQUUsUUFBUSxLQUFSLEVBQVI7S0FITyxDQUFUO0FBS0EsYUFBUyxFQUFFLE1BQU0sUUFBTixFQUFnQixNQUFNLElBQU4sRUFBM0I7QUFDQSxpQkFBYSwwREFBYjtHQVJGLEVBN0Q2QjtDQUFoQiIsImZpbGUiOiJpbXBvcnQuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFN0YXRzIE1peGluIERlcGVuZGVuY2llc1xuICovXG5pbXBvcnQgYXN5bmMgZnJvbSAnYXN5bmMnO1xuaW1wb3J0IG1vbWVudCBmcm9tICdtb21lbnQnO1xuaW1wb3J0IGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbi8vIGltcG9ydCBEYXRhU291cmNlQnVpbGRlciBmcm9tICcuL2J1aWxkZXJzL2RhdGFzb3VyY2UtYnVpbGRlcic7XG4vKipcbiAgKiBCdWxrIEltcG9ydCBNaXhpblxuICAqIEBBdXRob3IgSm9uYXRoYW4gQ2FzYXJydWJpYXNcbiAgKiBAU2VlIDxodHRwczovL3R3aXR0ZXIuY29tL2pvaG5jYXNhcnJ1Ymlhcz5cbiAgKiBAU2VlIDxodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9sb29wYmFjay1pbXBvcnQtbWl4aW4+XG4gICogQFNlZSA8aHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbj5cbiAgKiBARGVzY3JpcHRpb25cbiAgKlxuICAqIFRoZSBmb2xsb3dpbmcgbWl4aW4gd2lsbCBhZGQgYnVsayBpbXBvcnRpbmcgZnVuY3Rpb25hbGxpdHkgdG8gbW9kZWxzIHdoaWNoIGluY2x1ZGVzXG4gICogdGhpcyBtb2R1bGUuXG4gICpcbiAgKiBEZWZhdWx0IENvbmZpZ3VyYXRpb25cbiAgKlxuICAqIFwiSW1wb3J0XCI6IHtcbiAgKiAgIFwibW9kZWxzXCI6IHtcbiAgKiAgICAgXCJJbXBvcnRDb250YWluZXJcIjogXCJNb2RlbFwiLFxuICAqICAgICBcIkltcG9ydFVwbG9hZFwiOiBcIk1vZGVsXCIsXG4gICogICAgIFwiSW1wb3J0VXBsb2FkRXJyb3JcIjogXCJNb2RlbFwiXG4gICogICB9XG4gICogfVxuICAqKi9cbmV4cG9ydCBkZWZhdWx0IChNb2RlbCwgY3R4KSA9PiB7XG4gIC8vIENyZWF0ZSBpbXBvcnQgbWV0aG9kXG4gIE1vZGVsLmltcG9ydCA9IChyZXEsIGZpbmlzaCkgPT4ge1xuICAgIC8vIFNldCBtb2RlbCBuYW1lc1xuICAgIGNvbnN0IEltcG9ydENvbnRhaW5lciA9IE1vZGVsLmFwcC5tb2RlbHNbKGN0eC5tb2RlbHMgJiYgY3R4Lm1vZGVscy5JbXBvcnRDb250YWluZXIpIHx8ICdJbXBvcnRDb250YWluZXInXTtcbiAgICBjb25zdCBJbXBvcnRVcGxvYWQgPSBNb2RlbC5hcHAubW9kZWxzWyhjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0VXBsb2FkKSB8fCAnSW1wb3J0VXBsb2FkJ107XG4gICAgY29uc3QgSW1wb3J0VXBsb2FkRXJyb3IgPSBNb2RlbC5hcHAubW9kZWxzWyhjdHgubW9kZWxzICYmIGN0eC5tb2RlbHMuSW1wb3J0VXBsb2FkRXJyb3IpIHx8ICdJbXBvcnRVcGxvYWRFcnJvciddO1xuICAgIGNvbnN0IGNvbnRhaW5lck5hbWUgPSBNb2RlbC5kZWZpbml0aW9uLm5hbWUgKyAnLScgKyBNYXRoLnJvdW5kKERhdGUubm93KCkpICsgJy0nICsgTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMTAwMCk7XG4gICAgaWYgKCFJbXBvcnRDb250YWluZXIgfHwgIUltcG9ydFVwbG9hZCB8fCAhSW1wb3J0VXBsb2FkRXJyb3IpIHtcbiAgICAgIHJldHVybiBmaW5pc2gobmV3IEVycm9yKCcobG9vcGJhY2staW1wb3J0LW1peGluKSBNaXNzaW5nIHJlcXVpcmVkIG1vZGVscywgdmVyaWZ5IHlvdXIgc2V0dXAgYW5kIGNvbmZpZ3VyYXRpb24nKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBhc3luYy53YXRlcmZhbGwoW1xuICAgICAgICAvLyBDcmVhdGUgY29udGFpbmVyXG4gICAgICAgIG5leHQgPT4gSW1wb3J0Q29udGFpbmVyLmNyZWF0ZUNvbnRhaW5lcih7IG5hbWU6IGNvbnRhaW5lck5hbWUgfSwgbmV4dCksXG4gICAgICAgIC8vIFVwbG9hZCBGaWxlXG4gICAgICAgIChjb250YWluZXIsIG5leHQpID0+IHtcbiAgICAgICAgICByZXEucGFyYW1zLmNvbnRhaW5lciA9IGNvbnRhaW5lck5hbWU7XG4gICAgICAgICAgSW1wb3J0Q29udGFpbmVyLnVwbG9hZChyZXEsIHt9LCBuZXh0KTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGVyc2lzdCBwcm9jZXNzIGluIGRiIGFuZCBydW4gaW4gZm9yayBwcm9jZXNzXG4gICAgICAgIChmaWxlQ29udGFpbmVyLCBuZXh0KSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS50eXBlICE9PSAndGV4dC9jc3YnKSB7XG4gICAgICAgICAgICBJbXBvcnRDb250YWluZXIuZGVzdHJveUNvbnRhaW5lcihjb250YWluZXJOYW1lKTtcbiAgICAgICAgICAgIHJldHVybiBuZXh0KG5ldyBFcnJvcignVGhlIGZpbGUgeW91IHNlbGVjdGVkIGlzIG5vdCBjc3YgZm9ybWF0JykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBTdG9yZSB0aGUgc3RhdGUgb2YgdGhlIGltcG9ydCBwcm9jZXNzIGluIHRoZSBkYXRhYmFzZVxuICAgICAgICAgIEltcG9ydFVwbG9hZC5jcmVhdGUoe1xuICAgICAgICAgICAgZGF0ZTogbW9tZW50KCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIG1vZGVsOiBNb2RlbC5kZWZpbml0aW9uLm5hbWUsXG4gICAgICAgICAgICBzdGF0dXM6ICdQRU5ESU5HJyxcbiAgICAgICAgICB9LCAoZXJyLCBmaWxlVXBsb2FkKSA9PiBuZXh0KGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkpO1xuICAgICAgICB9LFxuICAgICAgXSwgKGVyciwgZmlsZUNvbnRhaW5lciwgZmlsZVVwbG9hZCkgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBmaW5pc2ggPT09ICdmdW5jdGlvbicpIGZpbmlzaChlcnIsIGZpbGVDb250YWluZXIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBMYXVuY2ggYSBmb3JrIG5vZGUgcHJvY2VzcyB0aGF0IHdpbGwgaGFuZGxlIHRoZSBpbXBvcnRcbiAgICAgICAgY2hpbGRQcm9jZXNzLmZvcmsoJy9Wb2x1bWVzL2JhY2t1cC9kZXZlbG9wbWVudC93d3cvbXktbW9kdWxlcy9sb29wYmFjay1pbXBvcnQtbWl4aW4vZGlzdC9wcm9jZXNzZXMvaW1wb3J0LXByb2Nlc3MuanMnLCBbXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgc2NvcGU6IE1vZGVsLmRlZmluaXRpb24ubmFtZSxcbiAgICAgICAgICAgIGZpbGVVcGxvYWQ6IGZpbGVVcGxvYWQuaWQsXG4gICAgICAgICAgICByb290OiBNb2RlbC5hcHAuZGF0YXNvdXJjZXMuY29udGFpbmVyLnNldHRpbmdzLnJvb3QsXG4gICAgICAgICAgICBjb250YWluZXI6IGZpbGVDb250YWluZXIuZmlsZXMuZmlsZVswXS5jb250YWluZXIsXG4gICAgICAgICAgICBmaWxlOiBmaWxlQ29udGFpbmVyLmZpbGVzLmZpbGVbMF0ubmFtZSxcbiAgICAgICAgICB9KV0pO1xuICAgICAgICBpZiAodHlwZW9mIGZpbmlzaCA9PT0gJ2Z1bmN0aW9uJykgZmluaXNoKG51bGwsIGZpbGVDb250YWluZXIpO1xuICAgICAgICByZXNvbHZlKGZpbGVDb250YWluZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG4gIC8qKlxuICAgKiBDcmVhdGUgaW1wb3J0IG1ldGhvZCAoTm90IEF2YWlsYWJsZSB0aHJvdWdoIFJFU1QpXG4gICAqKi9cbiAgTW9kZWwuaW1wb3J0UHJvY2Vzc29yID0gZnVuY3Rpb24gSW1wb3J0TWV0aG9kKGNvbnRhaW5lciwgZmlsZSwgb3B0aW9ucywgbmV4dCkge1xuICAgIG5leHQoKTtcbiAgfTtcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIEltcG9ydCBNZXRob2RcbiAgICovXG4gIE1vZGVsLnJlbW90ZU1ldGhvZCgnaW1wb3J0Jywge1xuICAgIGh0dHA6IHsgcGF0aDogJy9pbXBvcnQnLCB2ZXJiOiAncG9zdCcgfSxcbiAgICBhY2NlcHRzOiBbe1xuICAgICAgYXJnOiAncmVxJyxcbiAgICAgIHR5cGU6ICdvYmplY3QnLFxuICAgICAgaHR0cDogeyBzb3VyY2U6ICdyZXEnIH0sXG4gICAgfV0sXG4gICAgcmV0dXJuczogeyB0eXBlOiAnb2JqZWN0Jywgcm9vdDogdHJ1ZSB9LFxuICAgIGRlc2NyaXB0aW9uOiAnQnVsayB1cGxvYWQgYW5kIGltcG9ydCBjdnMgZmlsZSB0byBwZXJzaXN0IG5ldyBpbnN0YW5jZXMnLFxuICB9KTtcbn07XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=
