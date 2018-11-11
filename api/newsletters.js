const mongoose = require('mongoose');
const Schema  = mongoose.Schema;

const subscriber = new Schema({
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

