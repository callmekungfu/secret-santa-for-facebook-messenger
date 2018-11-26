const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const PartySchema = new Schema({
    name: {
        type: String,
        maxlength: 50,
        required: true
    },
    location: {
        type: String,
        maxlength: 100
    },
    date: {
        type: String,
        maxlength: 50
    },
    budget: Number,
    note: {
        type: String,
        maxlength: 200
    },
    owner: {
        type: String,
        required: true
    },
    participants: {
        type: [String],
        required: true
    }
});

const PartyModel = mongoose.model('PartyModel', PartySchema);

module.exports = PartyModel;