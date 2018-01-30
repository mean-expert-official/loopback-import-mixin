import app from '../../../../server/server';
const options = JSON.parse(process.argv[2]);
try {
  app.models[options.scope]['import' + options.method](options.container, options.file, options, function (err) {
    console.log('Closing Import Process');
    console.log('ANY ERROR? ', err);
    process.exit(err ? 1 : 0)
  });
} catch (err) {
  process.exit(err ? 1 : 0);
}