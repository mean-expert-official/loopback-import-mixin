'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _util = require('util');

var _import = require('./import');

var _import2 = _interopRequireDefault(_import);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = (0, _util.deprecate)(function (app) {
  return app.loopback.modelBuilder.mixins.define('Import', _import2.default);
}, 'DEPRECATED: Use mixinSources, see https://github.com/jonathan-casarrubias/loopback-import-mixin#mixinsources');
module.exports = exports['default'];
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImluZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBOztBQUNBOzs7Ozs7a0JBRWUscUJBQ2I7U0FBTyxJQUFJLFFBQUosQ0FBYSxZQUFiLENBQTBCLE1BQTFCLENBQWlDLE1BQWpDLENBQXdDLFFBQXhDO0NBQVAsRUFDQSw4R0FGYSIsImZpbGUiOiJpbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7ZGVwcmVjYXRlfSBmcm9tICd1dGlsJztcbmltcG9ydCBJbXBvcnQgZnJvbSAnLi9pbXBvcnQnO1xuXG5leHBvcnQgZGVmYXVsdCBkZXByZWNhdGUoXG4gIGFwcCA9PiBhcHAubG9vcGJhY2subW9kZWxCdWlsZGVyLm1peGlucy5kZWZpbmUoJ0ltcG9ydCcsIEltcG9ydCksXG4gICdERVBSRUNBVEVEOiBVc2UgbWl4aW5Tb3VyY2VzLCBzZWUgaHR0cHM6Ly9naXRodWIuY29tL2pvbmF0aGFuLWNhc2FycnViaWFzL2xvb3BiYWNrLWltcG9ydC1taXhpbiNtaXhpbnNvdXJjZXMnXG4pO1xuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9
