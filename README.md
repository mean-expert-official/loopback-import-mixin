[![NPM](https://nodei.co/npm/loopback-import-mixin.png?stars&downloads)](https://nodei.co/npm/loopback-import-mixin/) [![NPM](https://nodei.co/npm-dl/loopback-import-mixin.png)](https://nodei.co/npm/loopback-import-mixin/)

[![build status](http://img.shields.io/travis/mafintosh/loopback-import-mixin.svg?style=flat)](http://travis-ci.org/mafintosh/loopback-import-mixin)

Loopback Import Mixin
=============
This module is designed for the [Strongloop Loopback](https://github.com/strongloop/loopback) framework.  It provides bulk import functionallity to Models and Relations by uploading CSV files.

It is capable to impor bulk sets of data by creating Models and it Relationships, also provides the ability to update existing instances by modifying it properties if any changes in values are found.

It provides a Log mechanisim that will create history that includes the import process with specific warnings, errors and details for each row in the file.

#### INSTALL

```bash
  npm install loopback-import-mixin --save
```
#### MIXINSOURCES

With [loopback-boot@v2.8.0](https://github.com/strongloop/loopback-boot/)  [mixinSources](https://github.com/strongloop/loopback-boot/pull/131) have been implemented in a way which allows for loading this mixin without changes to the `server.js` file previously required.

Add the `mixins` property to your `server/model-config.json` like the following:

```json
{
  "_meta": {
    "sources": [
      "loopback/common/models",
      "loopback/server/models",
      "../common/models",
      "./models"
    ],
    "mixins": [
      "loopback/common/mixins",
      "../node_modules/loopback-import-mixin/dist",
      "../common/mixins"
    ]
  }
}
```
IMPORT MIXIN
========

This mixin creates a [Remote Method](https://docs.strongloop.com/display/APIC/Remote+methods) called import that accepts a csv file and then forks a new process to import the data related to a model and possible many-to-many relationships.

#### EXAMPLE

You can configure the `loopback-import-mixin` by mapping the CSV file column names with the model property names, also you can map the relationship with other currently existing instances:


```json
"mixins": {
    "Import": {
        "pk": "csvFileColumnPK",
        "map": {
            "modelProperty1": "csvFileColumnName1",
            "modelProperty2": "csvFileColumnName2",
            "modelProperty3": "csvFileColumnName3",
            "modelProperty4": "csvFileColumnName4",
            // ...
        },
        "relations": {
            "modelRelation1": {
                "relatedModelProperty": "csvFileColumnNameX"
            },
            "modelRelation2": {
                "relatedModelProperty": "csvFileColumnNameY"
            }
        }
    }
}
```

The code defined above would create a `localhost:3000/api/model/import` endpoint with the ability to import models with properties 1...4 within the map section.

In this example, the relation names `MUST` correspond to an actual relationship name defined in the Model `e.g. "relations": {"modelRelation1": {...}}`. and the items inside the relation object works as a where statement `pseudo code: add Model.modelRelation1 where relatedModelProperty = csvFileColumnNameX`

The where statement is transparently passed to loopback, meaning you can use or & and operators as any regular loopback where query:

```json
"mixins": {
    "Import": {
        "relations": {
            "modelRelation1": {
                "or": [
                    { "name": "csvFileColumnNameX" },
                    { "email": "csvFileColumnNameY" }
                ]
            }
        }
    }
}
```

BOOT OPTIONS
=============

The following options are needed in order to create a micro-service to provide statistical information regarding a model, relation or nested dataset.

`HINT: you can create as many micro-services as you need.`

| Options       | Type       | Requried          | Possible Values | Examples
|:-------------:|:-------------:|:-------------:|:---------------:| :------------------------:
| pk           | String      | Yes  | Any             |  CSV PK Name
| map          | Object      | Yes  | Schema Map        |  { Model.property: CSV.field}
| relations    | Object     | No   | Relation Where Constraint | { RelatedModel.property: CSV.field  }


Please refer to configuration examples.



LICENSE
=============
[MTI](LICENSE)