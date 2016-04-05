'use strict';

var _server = require('/Volumes/backup/development/mobile/sjc/sjc-api/server/server');

var _server2 = _interopRequireDefault(_server);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var options = JSON.parse(process.argv[2]);
try {
  _server2.default.models[options.scope].importProcessor(options.container, options.file, options, function (err) {
    return process.exit(err ? 1 : 0);
  });
} catch (err) {
  process.exit(err ? 1 : 0);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7OztBQUNBLElBQU0sVUFBVSxLQUFLLEtBQUwsQ0FBVyxRQUFRLElBQVIsQ0FBYSxDQUFiLENBQVgsQ0FBVjtBQUNOLElBQUk7QUFDRixtQkFBSSxNQUFKLENBQVcsUUFBUSxLQUFSLENBQVgsQ0FBMEIsZUFBMUIsQ0FBMEMsUUFBUSxTQUFSLEVBQW1CLFFBQVEsSUFBUixFQUFjLE9BQTNFLEVBQW9GO1dBQU8sUUFBUSxJQUFSLENBQWEsTUFBTSxDQUFOLEdBQVUsQ0FBVjtHQUFwQixDQUFwRixDQURFO0NBQUosQ0FFRSxPQUFPLEdBQVAsRUFBWTtBQUNaLFVBQVEsSUFBUixDQUFhLE1BQU0sQ0FBTixHQUFVLENBQVYsQ0FBYixDQURZO0NBQVoiLCJmaWxlIjoiaW1wb3J0LXByb2Nlc3MuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgYXBwIGZyb20gJy9Wb2x1bWVzL2JhY2t1cC9kZXZlbG9wbWVudC9tb2JpbGUvc2pjL3NqYy1hcGkvc2VydmVyL3NlcnZlcic7XG5jb25zdCBvcHRpb25zID0gSlNPTi5wYXJzZShwcm9jZXNzLmFyZ3ZbMl0pO1xudHJ5IHtcbiAgYXBwLm1vZGVsc1tvcHRpb25zLnNjb3BlXS5pbXBvcnRQcm9jZXNzb3Iob3B0aW9ucy5jb250YWluZXIsIG9wdGlvbnMuZmlsZSwgb3B0aW9ucywgZXJyID0+IHByb2Nlc3MuZXhpdChlcnIgPyAxIDogMCkpO1xufSBjYXRjaCAoZXJyKSB7XG4gIHByb2Nlc3MuZXhpdChlcnIgPyAxIDogMCk7XG59Il0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
