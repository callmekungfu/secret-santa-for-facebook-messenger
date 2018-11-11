const mongoose = require('mongoose');
const dbconfig = require('../database-config');

const mongoDB = dbconfig.address;

mongoose.connect(mongoDB, {
    useNewUrlParser: true,
    dbName: 'kithconDB'
});

mongoose.Promise = global.Promise;

const database = mongoose.connection;

database.on('error', console.error.bind(console, 'MongoDB connection error: '));

module.exports = database;