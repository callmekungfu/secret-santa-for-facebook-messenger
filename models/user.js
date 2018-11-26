const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const UserSchema = new Schema({
    first_name: {
        type: String,
        maxlength: 50,
        required: true
    },
    last_name: {
        type: String,
        maxlength: 50,
        required: true
    },
    name: {
        type: String,
        maxlength: 100,
        required: true
    },
    profile: {
        type: String,
        maxlength: 500,
        required: true
    },
    psid: {
        type: String,
        required: true
    },
    parties: {
        type: [Schema.Types.ObjectId],
        required: true
    },
    wishlist: {
        type: [String],
        required: true
    },
    recipients: {
        type: [String],
        required: true
    }
});

const UserModel = mongoose.model('UserModel', UserSchema);

module.exports = UserModel;