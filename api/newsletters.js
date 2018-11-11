const mongoose = require('mongoose');
const dbconfig = require('../database-config');

const mongoDB = dbconfig.address;
const Schema  = mongoose.Schema;

mongoose.connect(mongoDB, {
    useNewUrlParser: true,
    dbName: 'kithconDB'
});

mongoose.Promise = global.Promise;

const database = mongoose.connection;

database.on('error', console.error.bind(console, 'MongoDB connection error: '));

let subscriber = new Schema({
    email: String,
    first_name: String,
    last_name: String,
    postal: String,
    preference: {
        ir: Boolean,
        sr: Boolean,
        br: Boolean,
        cu: Boolean,
        nf: Boolean,
        so: Boolean
    },
    timestamp: Date
});

const SubscriberModel = mongoose.model('subscribers', subscriber);

module.exports = SubscriberModel;

