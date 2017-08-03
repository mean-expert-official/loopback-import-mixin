import app from '../../../../server/server';
const options = JSON.parse(process.argv[2]);

const finisher = app[options.finisher] || function (err) {
  console.log('Closing Import Process');
  console.log('ANY ERROR? ', err);
  process.exit(err ? 1 : 0)
};

try {
  app.models[options.scope]['import' + options.method](options.container, options.file, options, finisher);
} catch (err) {
  process.exit(err ? 1 : 0);
}
