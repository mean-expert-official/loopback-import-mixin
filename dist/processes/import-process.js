'use strict';

var _server = require('../../../../server/server');

var _server2 = _interopRequireDefault(_server);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var options = JSON.parse(process.argv[2]);
try {
  _server2.default.models[options.scope].importProcessor(options.container, options.file, options, function (err) {
    console.log('Closing Import Process');
    console.log('ANY ERROR? ', err);
    process.exit(err ? 1 : 0);
  });
} catch (err) {
  process.exit(err ? 1 : 0);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImltcG9ydC1wcm9jZXNzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7OztBQUNBLElBQU0sVUFBVSxLQUFLLEtBQUwsQ0FBVyxRQUFRLElBQVIsQ0FBYSxDQUFiLENBQVgsQ0FBVjtBQUNOLElBQUk7QUFDRixtQkFBSSxNQUFKLENBQVcsUUFBUSxLQUFSLENBQVgsQ0FBMEIsZUFBMUIsQ0FBMEMsUUFBUSxTQUFSLEVBQW1CLFFBQVEsSUFBUixFQUFjLE9BQTNFLEVBQW9GLFVBQVUsR0FBVixFQUFlO0FBQ2pHLFlBQVEsR0FBUixDQUFZLHdCQUFaLEVBRGlHO0FBRWpHLFlBQVEsR0FBUixDQUFZLGFBQVosRUFBMkIsR0FBM0IsRUFGaUc7QUFHakcsWUFBUSxJQUFSLENBQWEsTUFBTSxDQUFOLEdBQVUsQ0FBVixDQUFiLENBSGlHO0dBQWYsQ0FBcEYsQ0FERTtDQUFKLENBTUUsT0FBTyxHQUFQLEVBQVk7QUFDWixVQUFRLElBQVIsQ0FBYSxNQUFNLENBQU4sR0FBVSxDQUFWLENBQWIsQ0FEWTtDQUFaIiwiZmlsZSI6ImltcG9ydC1wcm9jZXNzLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGFwcCBmcm9tICcuLi8uLi8uLi8uLi9zZXJ2ZXIvc2VydmVyJztcbmNvbnN0IG9wdGlvbnMgPSBKU09OLnBhcnNlKHByb2Nlc3MuYXJndlsyXSk7XG50cnkge1xuICBhcHAubW9kZWxzW29wdGlvbnMuc2NvcGVdLmltcG9ydFByb2Nlc3NvcihvcHRpb25zLmNvbnRhaW5lciwgb3B0aW9ucy5maWxlLCBvcHRpb25zLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgY29uc29sZS5sb2coJ0Nsb3NpbmcgSW1wb3J0IFByb2Nlc3MnKTtcbiAgICBjb25zb2xlLmxvZygnQU5ZIEVSUk9SPyAnLCBlcnIpO1xuICAgIHByb2Nlc3MuZXhpdChlcnIgPyAxIDogMClcbiAgfSk7XG59IGNhdGNoIChlcnIpIHtcbiAgcHJvY2Vzcy5leGl0KGVyciA/IDEgOiAwKTtcbn0iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=
