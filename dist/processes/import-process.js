'use strict';

var _server = require('../../../../server/server');

var _server2 = _interopRequireDefault(_server);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var options = JSON.parse(process.argv[2]);
try {
  _server2.default.models[options.scope]['import' + options.method](options.container, options.file, options, function (err) {
    console.log('Closing Import Process');
    console.log('ANY ERROR? ', err);
    process.exit(err ? 1 : 0);
  });
} catch (err) {
  process.exit(err ? 1 : 0);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7OztBQUNBLElBQU0sVUFBVSxLQUFLLEtBQUwsQ0FBVyxRQUFRLElBQVIsQ0FBYSxDQUFiLENBQVgsQ0FBVjtBQUNOLElBQUk7QUFDRixtQkFBSSxNQUFKLENBQVcsUUFBUSxLQUFSLENBQVgsQ0FBMEIsV0FBVyxRQUFRLE1BQVIsQ0FBckMsQ0FBcUQsUUFBUSxTQUFSLEVBQW1CLFFBQVEsSUFBUixFQUFjLE9BQXRGLEVBQStGLFVBQVUsR0FBVixFQUFlO0FBQzVHLFlBQVEsR0FBUixDQUFZLHdCQUFaLEVBRDRHO0FBRTVHLFlBQVEsR0FBUixDQUFZLGFBQVosRUFBMkIsR0FBM0IsRUFGNEc7QUFHNUcsWUFBUSxJQUFSLENBQWEsTUFBTSxDQUFOLEdBQVUsQ0FBVixDQUFiLENBSDRHO0dBQWYsQ0FBL0YsQ0FERTtDQUFKLENBTUUsT0FBTyxHQUFQLEVBQVk7QUFDWixVQUFRLElBQVIsQ0FBYSxNQUFNLENBQU4sR0FBVSxDQUFWLENBQWIsQ0FEWTtDQUFaIiwiZmlsZSI6ImltcG9ydC1wcm9jZXNzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGFwcCBmcm9tICcuLi8uLi8uLi8uLi9zZXJ2ZXIvc2VydmVyJztcbmNvbnN0IG9wdGlvbnMgPSBKU09OLnBhcnNlKHByb2Nlc3MuYXJndlsyXSk7XG50cnkge1xuICBhcHAubW9kZWxzW29wdGlvbnMuc2NvcGVdWydpbXBvcnQnICsgb3B0aW9ucy5tZXRob2RdKG9wdGlvbnMuY29udGFpbmVyLCBvcHRpb25zLmZpbGUsIG9wdGlvbnMsIGZ1bmN0aW9uIChlcnIpIHtcbiAgICBjb25zb2xlLmxvZygnQ2xvc2luZyBJbXBvcnQgUHJvY2VzcycpO1xuICAgIGNvbnNvbGUubG9nKCdBTlkgRVJST1I/ICcsIGVycik7XG4gICAgcHJvY2Vzcy5leGl0KGVyciA/IDEgOiAwKVxuICB9KTtcbn0gY2F0Y2ggKGVycikge1xuICBwcm9jZXNzLmV4aXQoZXJyID8gMSA6IDApO1xufSJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==
