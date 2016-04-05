'use strict';

var _server = require('../../../../server/server');

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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7OztBQUNBLElBQU0sVUFBVSxLQUFLLEtBQUwsQ0FBVyxRQUFRLElBQVIsQ0FBYSxDQUFiLENBQVgsQ0FBVjtBQUNOLElBQUk7QUFDRixtQkFBSSxNQUFKLENBQVcsUUFBUSxLQUFSLENBQVgsQ0FBMEIsZUFBMUIsQ0FBMEMsUUFBUSxTQUFSLEVBQW1CLFFBQVEsSUFBUixFQUFjLE9BQTNFLEVBQW9GO1dBQU8sUUFBUSxJQUFSLENBQWEsTUFBTSxDQUFOLEdBQVUsQ0FBVjtHQUFwQixDQUFwRixDQURFO0NBQUosQ0FFRSxPQUFPLEdBQVAsRUFBWTtBQUNaLFVBQVEsSUFBUixDQUFhLE1BQU0sQ0FBTixHQUFVLENBQVYsQ0FBYixDQURZO0NBQVoiLCJmaWxlIjoiaW1wb3J0LXByb2Nlc3MuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgYXBwIGZyb20gJy4uLy4uLy4uLy4uL3NlcnZlci9zZXJ2ZXInO1xuY29uc3Qgb3B0aW9ucyA9IEpTT04ucGFyc2UocHJvY2Vzcy5hcmd2WzJdKTtcbnRyeSB7XG4gIGFwcC5tb2RlbHNbb3B0aW9ucy5zY29wZV0uaW1wb3J0UHJvY2Vzc29yKG9wdGlvbnMuY29udGFpbmVyLCBvcHRpb25zLmZpbGUsIG9wdGlvbnMsIGVyciA9PiBwcm9jZXNzLmV4aXQoZXJyID8gMSA6IDApKTtcbn0gY2F0Y2ggKGVycikge1xuICBwcm9jZXNzLmV4aXQoZXJyID8gMSA6IDApO1xufSJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
