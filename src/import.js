/**
 * Stats Mixin Dependencies
 */
import async from 'async';
import moment from 'moment';
import childProcess from 'child_process';
import csv from 'csv-parser';
import fs from 'fs';
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
export default (Model, ctx) => {
  // Create import method
  Model.import = (req, finish) => {
    // Set model names
    const ImportContainerName = (ctx.models && ctx.models.ImportContainer) || 'ImportContainer';
    const ImportUploadName = (ctx.models && ctx.models.ImportUpload) || 'ImportUpload';
    const ImportUploadErrorName = (ctx.models && ctx.models.ImportUploadError) || 'ImportUploadError';
    const ImportContainer = Model.app.models[ImportContainerName];
    const ImportUpload = Model.app.models[ImportUploadName];
    const ImportUploadError = Model.app.models[ImportUploadErrorName];
    const containerName = Model.definition.name + '-' + Math.round(Date.now()) + '-' + Math.round(Math.random() * 1000);
    if (!ImportContainer || !ImportUpload || !ImportUploadError) {
      return finish(new Error('(loopback-import-mixin) Missing required models, verify your setup and configuration'));
    }
    return new Promise((resolve, reject) => {
      async.waterfall([
        // Create container
        next => ImportContainer.createContainer({ name: containerName }, next),
        // Upload File
        (container, next) => {
          req.params.container = containerName;
          ImportContainer.upload(req, {}, next);
        },
        // Persist process in db and run in fork process
        (fileContainer, next) => {
          if (fileContainer.files.file[0].type !== 'text/csv') {
            ImportContainer.destroyContainer(containerName);
            return next(new Error('The file you selected is not csv format'));
          }
          // Store the state of the import process in the database
          ImportUpload.create({
            date: moment().toISOString(),
            model: Model.definition.name,
            status: 'PENDING',
          }, (err, fileUpload) => next(err, fileContainer, fileUpload));
        },
      ], (err, fileContainer, fileUpload) => {
        if (err) {
          if (typeof finish === 'function') finish(err, fileContainer);
          return reject(err);
        }
        // Launch a fork node process that will handle the import
        childProcess.fork(__dirname + '/processes/import-process.js', [
          JSON.stringify({
            scope: Model.definition.name,
            fileUploadId: fileUpload.id,
            root: Model.app.datasources.container.settings.root,
            container: fileContainer.files.file[0].container,
            file: fileContainer.files.file[0].name,
            ImportContainer: ImportContainerName,
            ImportUpload: ImportUploadName,
            ImportUploadError: ImportUploadErrorName,
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
    const filePath = '/Volumes/backup/development/mobile/sjc/sjc-api/' + options.root + '/' + options.container + '/' + options.file;
    const ImportContainer = Model.app.models[options.ImportContainer];
    const ImportUpload = Model.app.models[options.ImportUpload];
    async.waterfall([
      // Get importUpload
      next => ImportUpload.findById(options.fileUploadId, next),
      // Set importUpload status as processing
      (importUpload, next) => {
        ctx.importUpload = importUpload;
        ctx.importUpload.status = 'PROCESSING';
        ctx.importUpload.save(next);
      },
      // Import Data
      (importUpload, next) => {
        // This line opens the file as a readable stream
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            const obj = {};
            for (const key in ctx.map) {
              if (row[ctx.map[key]]) {
                obj[key] = row[ctx.map[key]];
              }
            }
            const query = {};
            query[ctx.pk] = obj[ctx.pk];
            console.log(obj);
            // Find or create instance
            Model.findOrCreate({ where: query }, obj, (err, instance) => {
              if (err) importUpload.errors.create({ row: row });
              console.log(instance);
              // TODO Work on relationships
            });
          })
          .on('end', () => next());
      },
      // Remove Container
      next => ImportContainer.remove({ container: options.container }, next),
      // Set status as finished
      next => {
        ctx.importUpload.status = 'FINISHED';
        ctx.importUpload.save(next);
      },
    ], finish);
  };
  /**
   * Register Import Method
   */
  Model.remoteMethod('import', {
    http: { path: '/import', verb: 'post' },
    accepts: [{
      arg: 'req',
      type: 'object',
      http: { source: 'req' },
    }],
    returns: { type: 'object', root: true },
    description: 'Bulk upload and import cvs file to persist new instances',
  });
};
