import {deprecate} from 'util';
import Import from './import';

export default deprecate(
  app => app.loopback.modelBuilder.mixins.define('Import', Import),
  'DEPRECATED: Use mixinSources, see https://github.com/jonathan-casarrubias/loopback-import-mixin#mixinsources'
);
