'use strict';

// Imports dependencies and set up http server
const
  request = require('request'),
  express = require('express'),
  body_parser = require('body-parser'),
  moment = require('moment'),
  mongoose = require('mongoose'),
  dotenv = require('dotenv').config();

const
  PartyModel = require('./models/party'),
  UserModel = require('./models/user');

var app = express();

app.set('port', process.env.PORT || 5000);
app.use(body_parser.json());
app.use(express.static('public'));

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const SERVER_URL = process.env.SERVER_URL;
const APP_SECRET = process.env.APP_SECRET;
const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL, {
  useNewUrlParser: true
});
mongoose.Promise = global.Promise;

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MongoDB Connection Error: '))

app.listen(app.get('port'), () => {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

app.get('/testing', (req, res) => {
  const psid = '2542760535764230';
  checkIfUserAlreadyRegistered(psid, (err, found) => {
    if (err) {
      console.log(err);
    } else if (found) {
      // if found
      UserModel.findOneAndUpdate({
        _id: found._id
      }, {
        $push: {
          parties: 'Testing'
        }
      }, (err, data) => {
        if (err) {
          console.log(err);
        } else {
          console.log('Success', data);
          res.status(200).send(data);
        }
      });
    } else {
      getUserInfoFromGraph(psid, (err, userInfo) => {
        if (err) {
          console.log(err);
        } else {
          const userInstance = new UserModel({
            name: userInfo.name,
            first_name: userInfo.first_name,
            last_name: userInfo.last_name,
            profile: userInfo.profile_pic,
            psid: userInfo.id,
            parties: 'Later',
            wishlist: [],
            recipients: []
          });
          userInstance.save((err, data) => {
            if (err) {
              console.log(err);
            } else {
              console.log('Success', data);
              res.status(200).send(data);
            }
          })
        }
      });
    }
  });
});

// Accepts POST requests at the /webhook endpoint
app.post('/webhook', (req, res) => {
  let body = req.body;
  if (body.object === 'page') {

    body.entry.forEach(({
      messaging
    }) => {

      let webhook_event = messaging[0];
      console.log(webhook_event);

      let sender_psid = webhook_event.sender.id;
      console.log(`Sender PSID: ${sender_psid}`);

      if (webhook_event.message) {
        handleMessage(sender_psid, webhook_event.message);
      } else if (webhook_event.postback) {
        handlePostback(sender_psid, webhook_event.postback);
      }

    });

    res.status(200).send('EVENT_RECEIVED');

  } else {
    res.sendStatus(404);
  }

});

app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.TOKEN;

  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  if (mode && token) {

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {

      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);

    } else {
      res.sendStatus(403);
    }
  }
});

app.get('/options', (req, res) => {
  let referer = req.get('Referer');
  if (referer) {
    if (referer.indexOf('www.messenger.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
    } else if (referer.indexOf('www.facebook.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
    }
    res.sendFile('public/options.html', {
      root: __dirname
    });
  }
});

app.get('/optionspostback', (req, res) => {
  let body = req.query;
  const partyInstance = new PartyModel({
    name: body.name,
    location: body.location,
    budget: parseFloat(body.budget).toFixed(2),
    owner: body.psid,
    participants: [
      body.psid
    ],
    note: body.note
  });
  partyInstance.save((err, partyInfo) => {
    if (err) {
      console.log(err)
    } else {
      checkIfUserAlreadyRegistered(body.psid, (err, found) => {
        if (err) {
          console.error('An error occurred with the database: ', err);
          res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
        } else if (found) {
          // if found
          UserModel.findOneAndUpdate({
            _id: found._id
          }, {
            $push: {
              parties: partyInfo._id
            }
          }, (err, data) => {
            if (err) {
              console.error('An error occurred with the database: ', err);
              res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
            } else {
              console.log('Update Success', data);
              let response = afterPartyCreation(body, partyInfo._id);
              res.status(200).send('Please close this window to return to the conversation thread.');
              callSendAPI(body.psid, response);
            }
          });
        } else {
          getUserInfoFromGraph(body.psid, (err, userInfo) => {
            if (err) {
              console.error('An error occurred with the database: ', err);
              res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
            } else {
              const userInstance = new UserModel({
                name: userInfo.name,
                first_name: userInfo.first_name,
                last_name: userInfo.last_name,
                profile: userInfo.profile_pic,
                psid: userInfo.id,
                parties: [partyInfo._id],
                wishlist: [],
                recipients: []
              });
              userInstance.save((err, data) => {
                if (err) {
                  console.error('An error occurred with the database: ', err);
                  res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
                } else {
                  console.log('Success', data);
                  let response = afterPartyCreation(body, partyInfo._id);
                  res.status(200).send('Please close this window to return to the conversation thread.');
                  callSendAPI(body.psid, response);
                }
              })
            }
          });
        }
      });
    }
  });
});

app.get('/invitation', (req, res) => {
  let referer = req.get('Referer');
  if (referer) {
    if (referer.indexOf('www.messenger.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
    } else if (referer.indexOf('www.facebook.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
    }
    res.sendFile('public/invitation.html', {
      root: __dirname
    });
  }
});

app.get('/invitationpostback', (req, res) => {
  let body = req.query;
  res.status(200).send('Please close this window to return to the conversation thread.');
  callSendAPI(body.psid, {
    text: "You are now in the party! Remind the host to start the party when everyone is ready!"
  });
});

// Handles messages sent to the bot
function handleMessage(sender_psid, received_message) {
  let response;
  if (received_message.text) {
    switch (received_message.text.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {
      case "create party":
        response = setRoomPreferences(sender_psid);
        break;
      default:
        response = {
          "text": `You sent the message: "${received_message.text}".`
        };
        break;
    }
  } else {
    response = {
      "text": `Sorry I don't understand you...`
    }
  }
  callSendAPI(sender_psid, response);
}

function handlePostback(sender_psid, postback) {
  let response;
  switch (postback.payload) {
    case 'get_started':
      callSendAPI(sender_psid, {
        "text": `Let's get started!🎉🎉`
      });
      callSendAPI(sender_psid, {
        "text": `Secret santa for friends will help you manage and run a secret santa party with your friends, all you have to do is provide the details and share the party with your friends!`
      });
      break;
    case 'NEW_PARTY':
      callSendAPI(sender_psid, setRoomPreferences());
      break;
  }
}

// Define the template and webview
function setRoomPreferences() {
  let response = {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        "text": "Sounds good, let's get your party going! 🎉🎉",
        buttons: [{
            type: "web_url",
            url: SERVER_URL + "/options",
            title: "Create Your Party",
            webview_height_ratio: 'tall',
            messenger_extensions: true
          },
          {
            type: "web_url",
            url: SERVER_URL + "/help",
            title: "What are parties?",
            webview_height_ratio: 'full',
            messenger_extensions: true
          }
        ]
      }
    }
  };
  return response;
}

function afterPartyCreation(body, party_id) {
  let response = {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: `Yay! Your ${body.name} party is on its way! Here are the details: \n\nLocation: ${body.location}\nDate: ${moment(body.date).format('MMMM Do YYYY, h:mm a')}\nBudget: $${body.budget}\n\nInvite your friends now! When You are ready, go to My Account > My Parties and click <Start Party>`,
        buttons: [{
          type: "element_share",
          share_contents: {
            attachment: {
              type: "template",
              payload: {
                template_type: 'generic',
                elements: [{
                  title: `You are invited to ${body.name} Party!`,
                  subtitle: `More Details:\n\nLocation: ${body.location}\nDate:${moment(body.date).format('MMMM Do YYYY, h:mm a')}\nBudget:$${body.budget}\n\nJoin Now!`,
                  image_url: SERVER_URL + '/images/santa.jpg',
                  default_action: {
                    type: 'web_url',
                    url: SERVER_URL + '/invitation?party_id=' + party_id,
                    messenger_extensions: true,
                    webview_height_ratio: 'tall'
                  },
                  buttons: [{
                    type: "web_url",
                    title: "Join Now!",
                    url: SERVER_URL + '/invitation',
                    messenger_extensions: true,
                    webview_height_ratio: 'tall'
                  }]
                }]
              }
            }
          }
        }]
      }
    }
  };
  return response;
}

function getUserInfoFromGraph(psid, callback) {
  request({
    "uri": "https://graph.facebook.com/" + psid,
    "qs": {
      "access_token": PAGE_ACCESS_TOKEN,
      "fields": 'first_name,last_name,name,profile_pic'
    },
    "method": "GET"
  }, (err, facebook_res, body) => {
    if (err) {
      callback(err, null);
    } else {
      callback(null, JSON.parse(body));
    }
  });
}

function checkIfUserAlreadyRegistered(psid, callback) {
  UserModel.findOne({
    psid: psid
  }, (err, result) => {
    if (err) {
      callback(err, null);
    } else {
      if (result) {
        callback(null, result);
      } else {
        callback(null, null);
      }
    }
  })
}

// Sends response messages via the Send API
function callSendAPI(sender_psid, response) {
  // Construct the message body
  let request_body = {
    "recipient": {
      "id": sender_psid
    },
    "message": response
  };
  console.log(request_body);
  // Send the HTTP request to the Messenger Platform
  request({
    "uri": "https://graph.facebook.com/v2.6/me/messages",
    "qs": {
      "access_token": PAGE_ACCESS_TOKEN
    },
    "method": "POST",
    "json": request_body
  }, (err, res, body) => {
    if (!err) {
      console.log('message sent!')
    } else {
      console.error("Unable to send message:" + err);
    }
  });
}