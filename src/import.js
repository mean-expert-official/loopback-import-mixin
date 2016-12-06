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
  *     "ImportLog": "Model"
  *   }
  * }
  **/

export default (Model, ctx) => {
  ctx.Model = Model;
  ctx.method = ctx.method || 'import';
  ctx.endpoint = ctx.endpoint || ['/', ctx.method].join('');
  // Create dynamic statistic method
  Model[ctx.method] = function StatMethod(req, finish) {
    // Set model names
    const ImportContainerName = (ctx.models && ctx.models.ImportContainer) || 'ImportContainer';
    const ImportLogName = (ctx.models && ctx.models.ImportLog) || 'ImportLog';
    const ImportContainer = Model.app.models[ImportContainerName];
    const ImportLog = Model.app.models[ImportLogName];
    const containerName = Model.definition.name + '-' + Math.round(Date.now()) + '-' + Math.round(Math.random() * 1000);
    if (!ImportContainer || !ImportLog) {
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
          ImportLog.create({
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
            method: ctx.method,
            scope: Model.definition.name,
            fileUploadId: fileUpload.id,
            root: Model.app.datasources.container.settings.root,
            container: fileContainer.files.file[0].container,
            file: fileContainer.files.file[0].name,
            ImportContainer: ImportContainerName,
            ImportLog: ImportLogName,
            relations: ctx.relations
          })]);
        if (typeof finish === 'function') finish(null, fileContainer);
        resolve(fileContainer);
      });
    });
  };
  /**
   * Create import method (Not Available through REST)
   **/
  Model['import' + ctx.method] = function ImportMethod(container, file, options, finish) {
    const filePath = __dirname + '/../../../' + options.root + '/' + options.container + '/' + options.file;
    const ImportContainer = Model.app.models[options.ImportContainer];
    const ImportLog = Model.app.models[options.ImportLog];
    async.waterfall([
      // Get ImportLog
      next => ImportLog.findById(options.fileUploadId, next),
      // Set importUpload status as processing
      (importLog, next) => {
        ctx.importLog = importLog;
        ctx.importLog.status = 'PROCESSING';
        ctx.importLog.save(next);
      },
      // Import Data
      (importLog, next) => {
        // This line opens the file as a readable stream
        let series = [];
        let i = 1; // Starts in one to discount column names
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', row => {
            i++;
            (function (i) {
              const obj = { importId: options.file + ':' + i };
              for (const key in ctx.map) {
                let isObj = (typeof ctx.map[key] === 'object');
                let columnKey = isObj ? ctx.map[key].map : ctx.map[key];
                if (row[columnKey]) {
                  obj[key] = row[columnKey];
                  if (isObj) {
                    switch (ctx.map[key].type) {
                      case 'date':
                        obj[key] = moment(obj[key], 'MM-DD-YYYY').toISOString();
                        break;
                      default:
                        obj[key] = obj[key];
                    }
                  }
                }
              }
              const query = {};
              if (ctx.pk && obj[ctx.pk]) query[ctx.pk] = obj[ctx.pk];
              // Lets set each row a flow
              series.push(nextSerie => {
                async.waterfall([
                  // See in DB for existing persisted instance
                  nextFall => {
                    if (!ctx.pk) return nextFall(null, null);
                    Model.findOne({ where: query }, nextFall);
                  },
                  // If we get an instance we just set a warning into the log
                  (instance, nextFall) => {
                    if (instance) {
                      ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                      for (const _key in obj) {
                        if (obj.hasOwnProperty(_key)) instance[_key] = obj[_key];
                      }
                      instance.save(nextFall);
                    } else {
                      nextFall(null, null);
                    }
                  },
                  // Otherwise we create a new instance
                  (instance, nextFall) => {
                    if (instance) return nextFall(null, instance);
                    Model.create(obj, nextFall);
                  },
                  // Work on relations
                  (instance, nextFall) => {
                    // Finall parallel process container
                    const parallel = [];
                    let setupRelation;
                    let ensureRelation;
                    let linkRelation;
                    let createRelation;
                    // Iterates through existing relations in model
                    setupRelation = function sr(expectedRelation) {
                      for (const existingRelation in Model.definition.settings.relations) {
                        if (Model.definition.settings.relations.hasOwnProperty(existingRelation)) {
                          ensureRelation(expectedRelation, existingRelation);
                        }
                      }
                    };
                    // Makes sure the relation exist
                    ensureRelation = function er(expectedRelation, existingRelation) {
                      if (expectedRelation === existingRelation) {
                        parallel.push(nextParallel => {
                          switch (ctx.relations[expectedRelation].type) {
                            case 'link':
                              linkRelation(
                                expectedRelation,
                                existingRelation,
                                nextParallel
                              );
                              break;
                            case 'create':
                              createRelation(
                                expectedRelation,
                                existingRelation,
                                nextParallel
                              );
                              break;
                            default:
                              throw new Error('Type of relation needs to be defined');
                          }
                        });
                      }
                    };
                    // Create Relation
                    createRelation = function cr(expectedRelation, existingRelation, nextParallel) {
                      const createObj = {};
                      for (const key in ctx.relations[expectedRelation].map) {
                        if (typeof ctx.relations[expectedRelation].map[key] === 'string' && row[ctx.relations[expectedRelation].map[key]]) {
                          createObj[key] = row[ctx.relations[expectedRelation].map[key]];
                        } else if (typeof ctx.relations[expectedRelation].map[key] === 'object') {
                          switch (ctx.relations[expectedRelation].map[key].type) {
                            case 'date':
                              createObj[key] = moment(row[ctx.relations[expectedRelation].map[key].map], 'MM-DD-YYYY').toISOString();
                              break;
                            default:
                              createObj[key] = row[ctx.relations[expectedRelation].map[key]];
                          }
                        }
                      }
                      createObj.importId = options.file + ':' + i;
                      let pk = ctx.relations[expectedRelation].pk;
                      let where = {};
                      where[pk] = createObj[pk];
                      instance[expectedRelation]({  where: where }, function(err, result) {
                        if (result && Array.isArray(result) && result.length > 0) {
                          let relatedInstance = result.pop();
                          Object.keys(createObj).forEach(function (objKey) {
                            relatedInstance[objKey] = createObj[objKey];
                          });
                          relatedInstance.save(nextParallel);
                        } else {
                          instance[expectedRelation].create(createObj, nextParallel);
                        }
                      });
                    };
                    // Link Relations
                    linkRelation = function lr(expectedRelation, existingRelation, nextParallel) {
                      const relQry = { where: {} };
                      for (const property in ctx.relations[expectedRelation].where) {
                        if (ctx.relations[expectedRelation].where.hasOwnProperty(property)) {
                          relQry.where[property] = row[ctx.relations[expectedRelation].where[property]];
                        }
                      }
                      Model.app.models[Model.definition.settings.relations[existingRelation].model].findOne(relQry, (relErr, relInstance) => {
                        if (relErr) return nextParallel(relErr);
                        if (!relInstance) {
                          ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                          ctx.importLog.warnings.push({
                            row: row,
                            message: Model.definition.name + '.' + expectedRelation + ' tried to relate unexisting instance of ' + expectedRelation,
                          });
                          return nextParallel();
                        }
                        switch (Model.definition.settings.relations[existingRelation].type) {
                          case 'hasMany':
                            /** Does not work, it needs to moved to other point in the flow
                             instance[expectedRelation].findById(relInstance.id, (relErr2, exist) => {
                               if (exist) {
                                 ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                                 ctx.importLog.warnings.push({
                                   row: row,
                                   message: Model.definition.name + '.' + expectedRelation + ' tried to create existing relation.',
                                 });
                                 return nextParallel();
                               }
                               instance[expectedRelation].create(relInstance, nextParallel);
                             });
                             **/
                            nextParallel();
                            break;
                          case 'hasManyThrough':
                          case 'hasAndBelongsToMany':
                            instance[expectedRelation].findById(relInstance.id, (relErr2, exist) => {
                              if (exist) {
                                ctx.importLog.warnings = Array.isArray(ctx.importLog.warnings) ? ctx.importLog.warnings : [];
                                ctx.importLog.warnings.push({
                                  row: row,
                                  message: Model.definition.name + '.' + expectedRelation + ' tried to relate existing relation.',
                                });
                                return nextParallel();
                              }
                              instance[expectedRelation].add(relInstance, nextParallel);
                            });
                            break;
                          case 'belongsTo':
                            // instance[expectedRelation](relInstance, nextParallel);
                            // For some reason does not work, no errors but no relationship is created
                            // Ugly fix needed to be implemented
                            let autoId = Model.definition.settings.relations[existingRelation].model;
                            autoId = autoId.charAt(0).toLowerCase() + autoId.slice(1) + 'Id';
                            instance[Model.definition.settings.relations[existingRelation].foreignKey || autoId] = relInstance.id;
                            instance.save(nextParallel);
                            break;
                          default:
                            nextParallel();
                        }
                      });
                    };
                    // Work on defined relationships
                    for (const ers in options.relations) {
                      if (options.relations.hasOwnProperty(ers)) {
                        setupRelation(ers);
                      }
                    }
                    // Run the relations process in parallel
                    async.parallel(parallel, nextFall);
                  },
                  // If there are any error in this serie we log it into the errors array of objects
                ], err => {
                  if (err) {
                    // TODO Verify why can not set errors into the log
                    if (Array.isArray(ctx.importLog.errors)) {
                      ctx.importLog.errors.push({ row: row, message: err });
                    } else {
                      console.error('IMPORT ERROR: ', { row: row, message: err });
                    }
                  }
                  nextSerie();
                });
              });
            })(i);
          })
          .on('end', () => {
            async.series(series, function (err) {
              series = null;
              next(err);
            });
          });
      },
      // Remove Container
      next => {
        console.log('Trying to destroy container: %s', options.container);
        ImportContainer.destroyContainer(options.container, next)
      },
      // Set status as finished
      next => {
        ctx.importLog.status = 'FINISHED';
        ctx.importLog.save(next);
      },
    ], err => {
      if (err) {
        console.log('Trying to destroy container: %s', options.container);
        ImportContainer.destroyContainer(options.container, next)
        throw new Error('DB-TIMEOUT');
        //ctx.importLog.save();
      } else { }
      // TODO, Add more valuable data to pass, maybe a better way to pass errors
      Model.app.emit(ctx.method + ':done', {});
      finish(err);
    });
  };
  /**
   * Register Import Method
   */
  Model.remoteMethod(ctx.method, {
    http: { path: ctx.endpoint, verb: 'post' },
    accepts: [{
      arg: 'req',
      type: 'object',
      http: { source: 'req' },
    }],
    returns: { type: 'object', root: true },
    description: ctx.description,
  });
};
