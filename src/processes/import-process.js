import app from '../../../../server/server';
const options = JSON.parse(process.argv[2]);
try {
  app.models[options.scope].importProcessor(options.container, options.file, options, err => process.exit(err ? 1 : 0));
} catch (err) {
  process.exit(err ? 1 : 0);
}