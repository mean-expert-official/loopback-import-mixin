/**
 * Dependencies
 */
import {assert} from 'chai';
import moment from 'moment';
import loopback from 'loopback';
import mixin from '../src';
/**
 * Lets define a loopback application
 */
const app = loopback;
app.loopback = loopback;
mixin(app);
/**
 * Create Data Source and Models
 **/
const DBDataSource = app.createDataSource({ name: 'memory', connector: app.Memory });
const ImportDataSource = app.createDataSource({
  name: 'import',
  connector: 'loopback-component-storage',
  provider: 'filesystem',
  root: 'tmp',
});
const ImportContainer = ImportDataSource.createModel('ImportContainer');
const ImportUpload = DBDataSource.createModel('ImportUpload', {
  date: Date,
  scope: String,
  status: String
}, {
    relations: {
      errors: {
        type: 'hasMany',
        model: 'ImportUploadError',
        foreignKey: 'errorId'
      }
    }
  }
);
const ImportUploadError = DBDataSource.createModel('ImportUploadError', {
  date: Date,
  scope: String,
  cell: String
}, {
    relations: {
      import: {
        type: 'belongsTo',
        model: 'ImportUpload',
        foreignKey: 'errorId'
      }
    }
  }
);
const Invitation = DBDataSource.createModel('Invitation',
  {
    id: { type: Number, generated: true, id: true },
    email: String,
    created: Date,
  },
  {
    mixins: {
      Import: {
        models: {}
      }
    }
  }
);
/**
 * Verify Models Are Created
 */
describe('Loopback Import Mixin (Setup Tests)', () => {
  // It verifies if default datasources are created
  it('verifies if import method is created', () => Promise.all([
    (() => { assert.isDefined(Invitation.import) })()
  ]))
  it('verifies if importProcessor method is created', () => Promise.all([
    (() => { assert.isDefined(Invitation.importProcessor) })()
  ]))
});