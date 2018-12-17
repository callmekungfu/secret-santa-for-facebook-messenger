const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const TokenSchema = new Schema({
    token: {
        type: String,
        required: true
    },
    target: {
        type: String,
        required: true
    }
});

const TokenModel = mongoose.model('TokenModel', TokenSchema);

module.exports = TokenModel;