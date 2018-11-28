'use strict';

// Imports dependencies and set up http server
const
  request = require('request'),
  express = require('express'),
  body_parser = require('body-parser'),
  moment = require('moment'),
  mongoose = require('mongoose'),
  _ = require('underscore'),
  dotenv = require('dotenv').config();

const
  PartyModel = require('./models/party'),
  UserModel = require('./models/user');

var app = express();

app.set('view engine', 'ejs');
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
  res.send('No testing staged yet!');
});

// Accepts POST requests at the /webhook endpoint
app.post('/webhook', (req, res) => {
  let body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(({
      messaging
    }) => {
      let webhook_event = messaging[0];
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
  _.mapObject(body,(val, key) => {
    if (key !== 'note' && val.length == 0) {
      console.log('Bad Input');
      callSendAPI(body.psid, `We failed to create your party because you didnt input "${key}" correctly.`);
      return;
    }
  });
  console.log(body.psid);
  const partyInstance = new PartyModel({
    name: body.name,
    location: body.location,
    date: body.date,
    budget: parseFloat(body.budget).toFixed(2),
    owner: body.psid,
    participants: [
      body.psid
    ],
    gifting: [],
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
            $addToSet: {
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
  let {
    party_id
  } = req.query;
  PartyModel.findOne({
    _id: party_id
  }, (err, party_data) => {
    UserModel.findOne({
      psid: party_data.owner
    }, {profile: 1, psid: 1, name: 1}, (err, owner_data) => {
      UserModel.find({
        parties: party_data._id
      }, (err, participants) => {
        party_data.date = moment(party_data.date).format('MMMM Do YYYY [at] h:mm a')
        const content = {
          party: party_data,
          owner: owner_data,
          participants
        }
        if (referer) {
          if (referer.indexOf('www.messenger.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
          } else if (referer.indexOf('www.facebook.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
          }
          res.render('invitation', {
            content
          });
        }
      })
    });
  });
});

app.get('/invitationpostback', (req, res) => {
  let body = req.query;
  PartyModel.findOne({
    _id: body.party_id
  }, {participants: 1, name: 1}, (err, party) => {
    if (party.participants.includes(body.psid)) {
      console.log("Already Joined");
      callSendAPI(body.psid, {text: `You are already a member of ${party.name}!`})
      return;
    }
    PartyModel.findOneAndUpdate({
      _id: body.party_id
    }, {
      $addToSet: {
        participants: body.psid
      }
    }, (err, party_info) => {
      if (err) {
        console.error('Failed to get information about the party: ', err);
        res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
      } else {
        checkIfUserAlreadyRegistered(body.psid, (err, found) => {
          if (err) {
            console.error('Failed to evaluate if user is already registered: ', err);
            res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
          } else if (found) {
            UserModel.findOneAndUpdate({
              psid: body.psid
            }, {
              $addToSet: {
                parties: body.party_id
              }
            }, (err, user) => {
              if (err) {
                console.error('Failed to update user account: ', err);
                res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
              } else {
                console.log('Success', user);
                res.status(200).send('Please close this window to return to the conversation thread.');
                callSendAPI(body.psid, {
                  text: `Welcome to Secret Santa For Friends, ${user.first_name}! You are now in the party! Remind the host to start the party when everyone is ready!`
                });
              }
            });
          } else {
            getUserInfoFromGraph(body.psid, (err, userInfo) => {
              if (err) {
                console.error('Failed to get user info from Facebook: ', err);
                res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
              } else {
                const userInstance = new UserModel({
                  name: userInfo.name,
                  first_name: userInfo.first_name,
                  last_name: userInfo.last_name,
                  profile: userInfo.profile_pic,
                  psid: userInfo.id,
                  parties: [party_info._id],
                  wishlist: [],
                  recipients: []
                });
                userInstance.save((err, data) => {
                  if (err) {
                    console.error('An error occurred when saving the user: ', userInfo);
                    res.status(500).send('Server Error. This is our fault, give us some time to resolve it.');
                  } else {
                    console.log('Success', data);
                    res.status(200).send('Please close this window to return to the conversation thread.');
                    callSendAPI(body.psid, {
                      text: `Welcome to Secret Santa For Friends, ${data.first_name}! You are now in the party! Remind the host to start the party when everyone is ready!`
                    });
                  }
                })
              }
            });
          }
        });
      }
    });
  })
});

app.get('/partydetails', (req, res) => {
  let referer = req.get('Referer');
  let {
    party_id
  } = req.query;
  PartyModel.findOne({
    _id: party_id
  }, (err, party_data) => {
    UserModel.findOne({
      psid: party_data.owner
    }, {profile: 1, psid: 1, name: 1}, (err, owner_data) => {
      UserModel.find({
        parties: party_data._id
      }, (err, participants) => {
        party_data.date = moment(party_data.date).format('MMMM Do YYYY [at] h:mm a')
        const content = {
          party: party_data,
          owner: owner_data,
          participants
        }
        if (referer) {
          if (referer.indexOf('www.messenger.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
          } else if (referer.indexOf('www.facebook.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
          }
          res.render('partydetails.ejs', {
            content
          });
        }
      })
    });
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

app.get('/startparty', (req, res) => {
  let referer = req.get('Referer');
  let {
    party_id
  } = req.query;
  PartyModel.findOne({
    _id: party_id
  }, (err, party_data) => {
    if (party_data.length <= 1) {
      res.status(200).send('<h1>You don\'t have enough participants in your party to start the party!')
    } else {
      UserModel.find({
        parties: party_data._id
      }, (err, participants) => {
        party_data.date = moment(party_data.date).format('MMMM Do YYYY [at] h:mm a')
        const content = {
          party: party_data,
          participants
        }
        if (referer) {
          if (referer.indexOf('www.messenger.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
          } else if (referer.indexOf('www.facebook.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
          }
          res.render('startparty', {
            content
          });
        }
      });
    }
  });
});

app.get('/startpartypostback',(req, res) => {
  const { party_id, psid } = req.query;
  PartyModel.findOne({_id: party_id}, (err, partyInfo) => {
    if (partyInfo.gifting) {
      console.log("Game Already Started");
      callSendAPI(psid, {text: "You have already started the party!"});
      return;
    }
    const { participants } = partyInfo;
    let gifting = [];
    let recipients = [];
    _.map(participants, (participant) => {
      let pool = participants.slice(0);
      pool.splice(pool.indexOf(participant), 1);
      pool = _.difference(pool,recipients);
      let recipient;
      if (pool.length === 0) {
        recipient = recipients[Math.floor(Math.random() * recipients.length)];
      } else {
        recipient = pool[Math.floor(Math.random() * pool.length)];
      }
      recipients.push(recipient);
      gifting.push({
        from: participant,
        to: recipient
      })
    });
    PartyModel.findOneAndUpdate({_id: party_id}, { gifting }, (err, newParty) => {
      if (err) {
      } else {
        _.map(gifting, (pair) => {
          UserModel.findOneAndUpdate({psid: pair.from}, {$addToSet: {recipients: {id: pair.to, party_id}}}, (err) => {
            if (err) {
              console.log(err)
            } else {
              UserModel.findOne({psid: pair.to}, {name: 1}, (err, getter) => {
                if (err) {
                  console.log(err)
                } else {
                  console.log(pair.to, getter.name);
                  callSendAPI(pair.from, {text: `Your secret santa recipient has been assigned! You will be getting a gift for: ${getter.name}`});
                }
              })
            }
          })
        });
      }
    });
  }) 
});

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
    case 'MY_PARTIES':
      postbackParties(sender_psid);
      break;
    case 'MY_RECIPIENTS':
      postbackRecipients(sender_psid);
      break;
    case 'MY_PROFILE':
    callSendAPI(sender_psid, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          "text": "This feature is still under development~~",
          buttons: [{
              type: "web_url",
              url: SERVER_URL + "/roadmap",
              title: "Development Roadmap",
              webview_height_ratio: 'full',
              messenger_extensions: true
            }
          ]
        }
      }
    });
  }
}

function postbackRecipients(sender_psid) {
  console.log('called');
  UserModel.findOne({
    psid: sender_psid
  }, {recipients: 1}, (err, user) => {
    if (err) {
      console.log(err)
      callSendAPI(sender_psid, {
        text: "Failed to retrieve your recipients... This is likely our fault. Please try again later."
      });
    } else if (user.recipients) {
      callSendAPI(sender_psid, {
        text: 'Here are your recipients! (Remember to keep it hush hush!)'
      })
      _.map(user.recipients, (recipient,i) => {
        UserModel.findOne({psid: recipient.id}, {name: 1, profile: 1} , (err, person) => {
          console.log(person);
          PartyModel.findOne({_id: recipient.party_id}, {name: 1}, (err, partyInfo) => {
            callSendAPI(sender_psid, recipientDetailsPrompt(person, partyInfo.name));
          })
        });
      });
    }
  });
}

function postbackParties(sender_psid) {
  PartyModel.find({
    owner: sender_psid
  }, (err, parties) => {
    if (err) {
      console.log(err)
      callSendAPI(sender_psid, {
        text: "Failed to retrieve parties... This is likely our fault. Please try again later."
      });
    } else if (parties.length > 0) {
      _.map(parties, (party) => {
        callSendAPI(sender_psid, partyDetailsPrompt(party));
      });
    } else {
      callSendAPI(sender_psid, {
        text: "You haven't created any party yet! Click on <Create a party> bellow to get started!"
      });
    }
  })
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
                  image_url: 'https://picsum.photos/400/600',
                  default_action: {
                    type: 'web_url',
                    url: SERVER_URL + `/invitation?party_id=` + party_id,
                    messenger_extensions: true,
                    webview_height_ratio: 'tall'
                  },
                  buttons: [{
                    type: "web_url",
                    title: "Join Now!",
                    url: SERVER_URL + '/invitation?party_id=' + party_id,
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

function partyDetailsPrompt(party) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: 'generic',
        elements: [{
          title: `${party.name}`,
          image_url: 'https://picsum.photos/400/600',
          subtitle: `Date: ${moment(party.date).format('MMMM Do YYYY, h:mm a')}\nThere are currently ${party.participants.length-1} friends in the party.`,
          default_action: {
            type: 'web_url',
            url: SERVER_URL + '/partydetails?party_id=' + party._id,
            messenger_extensions: true,
            webview_height_ratio: 'tall'
          },
          buttons: [{
            type: "web_url",
            title: "Start Party!",
            url: SERVER_URL + '/startparty?party_id=' + party._id,
            messenger_extensions: true,
            webview_height_ratio: 'tall'
          }]
        }]
      }
    }
  };
}

function recipientDetailsPrompt(user, party) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: 'generic',
        elements: [{
          title: `${user.name}`,
          image_url: user.profile,
          subtitle: party,
        }]
      }
    }
  };
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
      const userInfo = JSON.parse(body);
      if (userInfo.id) {
        callback(null, userInfo);
      } else {
        callback({message: "Failed to retrieve user profile from facebook", code: 1}, null)
      }
      
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
      console.log('message sent!', res, body)
    } else {
      console.error("Unable to send message:" + err);
    }
  });
}