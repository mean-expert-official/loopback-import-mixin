import gulp from 'gulp';
import sourcemaps from 'gulp-sourcemaps';
import babel from 'gulp-babel';
import path from 'path';

const mixin_paths = {
  es6: ['src/*.js'],
  es5: 'dist',
  sourceRoot: path.join(__dirname, 'dist'),
};
const processes_paths = {
  es6: ['src/processes/*.js'],
  es5: 'dist/processes',
  sourceRoot: path.join(__dirname, 'dist'),
};

gulp.task('mixin_babel', () => {
  return gulp.src(mixin_paths.es6)
  .pipe(sourcemaps.init())
  .pipe(babel())
  .pipe(sourcemaps.write())
  .pipe(gulp.dest(mixin_paths.es5));
});

gulp.task('processes_babel', () => {
  return gulp.src(processes_paths.es6)
  .pipe(sourcemaps.init())
  .pipe(babel())
  .pipe(sourcemaps.write())
  .pipe(gulp.dest(processes_paths.es5));
});

gulp.task('watch', () => {
  gulp.watch(mixin_paths.es6, ['mixin_babel']);
  gulp.watch(processes_paths.es6, ['processes_babel']);
});

gulp.task('default', ['mixin_babel', 'processes_babel']);