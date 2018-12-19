'use strict';

// Import libraries
const
  request = require('request'),
  express = require('express'),
  body_parser = require('body-parser'),
  moment = require('moment'),
  mongoose = require('mongoose'),
  _ = require('underscore'),
  jwt = require('jsonwebtoken'),
  helmet = require('helmet'),
  messages = require('./lib/messenger-template-builder'),
  dotenv = require('dotenv').config();

// Import database models
const
  PartyModel = require('./models/party'),
  UserModel = require('./models/user'),
  TokenModel = require('./models/tokens');

// Define express instance
var app = express();

// Define server configurations
app.set('view engine', 'ejs');
app.set('port', process.env.PORT || 5000);
app.use(body_parser.json());
app.use(express.static('public'));
app.use(helmet());

// Define environmental process variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const SERVER_URL = process.env.SERVER_URL;
const APP_SECRET = process.env.APP_SECRET;
const MONGO_URL = process.env.MONGO_URL;
const JWT_CERT = process.env.JWT_CERT

// Connect to mongo database
mongoose.connect(MONGO_URL, {
  useNewUrlParser: true
});

// Define promise function for mongoDB
mongoose.Promise = global.Promise;

// verify connection
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB Connection Error: '))

// Start server and listen to requests from port
app.listen(app.get('port'), () => {
  console.log('Secret Santa For Friends Server is running on port', app.get('port'));
});

// In case app needs to be exported
module.exports = app;

// Testing method, should be emptied in production environment
app.get('/testing', (req, res) => {});

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

// Open to webhook verification requests
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
  const {
    access
  } = req.query;
  console.log('request made')
  TokenModel.findOne({
    token: access
  }, {
    target: 1
  }, (err, auth) => {
    if (err) {
      console.log(err);
      res.render('error', {
        content: {
          err_msg: "There is an error on our side, please try again later."
        }
      });
    } else if (auth) {
      console.log('authed')
      // When we are going to load the UI page, we only verify the existance of the token. 
      jwt.verify(access, JWT_CERT, (err) => {
        if (err) {
          console.log(err);
          res.render('error', {
            content: {
              err_msg: "Your token is invalid, please create a new link through Messenger."
            }
          });
        } else if (auth.target === 'NEW_PARTY') {
          if (referer) {
            if (referer.indexOf('www.messenger.com') >= 0) {
              res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
            } else if (referer.indexOf('www.facebook.com') >= 0) {
              res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
            }
            const content = {
              token: access
            }
            res.render('partyoptions', {
              content
            });
          }
        }
      });
    } else {
      console.log('no token found')
      res.render('error', {
        content: {
          err_msg: "You do not have permission to create a new party, please request a new link through Messenger."
        }
      });
    }
  });
});

app.get('/optionspostback', (req, res) => {
  let body = req.query;
  // Validate Token
  TokenModel.findOne({
    token: body.token
  }, (mongoerr, tokenRecord) => {
    if (mongoerr) {
      callSendAPI(body.psid, `We failed to create your party because of a server error, please try again in a bit.`);
    } else if (!tokenRecord) {
      callSendAPI(body.psid, `We failed to create your party because your token is not found.`);
    } else {
      jwt.verify(body.token, JWT_CERT, (err, decoded) => {
        if (err) {
          // If decoding failed
          console.log(err);
          callSendAPI(body.psid, `We failed to create your party because your token is invalid or expired.`);
        } else if (decoded.psid !== body.psid) {
          // If user does not match
          callSendAPI(body.psid, `We failed to create your party because your token is invalid.`)
        } else {
          // No issues with token authenticity
          TokenModel.findOneAndDelete({
            token: body.token
          }, (err, record) => {
            if (err) {
              console.log(err);
            }
          }); // Remove token
          // Validate Input
          _.mapObject(body, (val, key) => {
            if (key !== 'note' && val.length == 0) {
              console.log('Bad Input detected');
              callSendAPI(body.psid, `We failed to create your party because you didnt input "${key}" correctly.`);
              return;
            }
          });
          // Create database connection instance
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
          // Save into database
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
                      let response = messages.afterPartyCreation(body, partyInfo._id);
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
                          let response = messages.afterPartyCreation(body, partyInfo._id);
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
        }
      });
    }
  })
});

app.get('/invitation', (req, res) => {
  let referer = req.get('Referer');
  let {
    party_id
  } = req.query;
  if (referer) {
    PartyModel.findOne({
      _id: party_id
    }, (err, party_data) => {
      UserModel.findOne({
        psid: party_data.owner
      }, {
        profile: 1,
        psid: 1,
        name: 1
      }, (err, owner_data) => {
        UserModel.find({
          parties: party_data._id
        }, (err, participants) => {
          party_data.date = moment(party_data.date).format('MMMM Do YYYY [at] h:mm a')
          const content = {
            party: party_data,
            owner: owner_data,
            participants
          }

          if (referer.indexOf('www.messenger.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
          } else if (referer.indexOf('www.facebook.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
          }
          res.render('invitation', {
            content
          });

        })
      });
    });
  } else {
    res.render('error', {
      content: {
        err_msg: "Please access this site using the facebook bot."
      }
    });
  }
});

app.get('/invitationpostback', (req, res) => {
  let body = req.query;
  PartyModel.findOne({
    _id: body.party_id
  }, {
    participants: 1,
    name: 1
  }, (err, party) => {
    if (party.participants.includes(body.psid)) {
      console.log("Already Joined");
      callSendAPI(body.psid, {
        text: `You are already a member of ${party.name}!`
      })
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
  if (referer) {
    PartyModel.findOne({
      _id: party_id
    }, (err, party_data) => {
      UserModel.findOne({
        psid: party_data.owner
      }, {
        profile: 1,
        psid: 1,
        name: 1
      }, (err, owner_data) => {
        UserModel.find({
          parties: party_data._id
        }, (err, participants) => {
          party_data.date = moment(party_data.date).format('MMMM Do YYYY [at] h:mm a')
          const content = {
            party: party_data,
            owner: owner_data,
            participants
          }
          if (referer.indexOf('www.messenger.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
          } else if (referer.indexOf('www.facebook.com') >= 0) {
            res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
          }
          res.render('partydetails.ejs', {
            content
          });
        })
      });
    });
  }
});

app.get('/partymanagement', (req, res) => {
  const body = req.query;
  switch (body.action) {
    case 'DELETE':
      PartyModel.findOneAndDelete({
        _id: body.party_id
      }, (err, result) => {
        if (err) {
          console.log(err);
          callSendAPI(body.psid, {
            text: `We failed to remove your party, please try again later.`
          });
        } else {
          callSendAPI(body.psid, {
            text: `Your party have been removed!`
          });
        }
      })
      break;
    case 'DELETE_USER':
      UserModel.findOneAndDelete({
        psid: body.psid
      }, (err, userInfo) => {
        if (err) {
          console.log(err);
          callSendAPI(body.psid, {
            text: `Sorry... We failed to remove your profile, please try again later. Or contact us: hi@yonglinwang.ca.`
          });
        } else {
          // Remove all parties that the user owns
          if (userInfo.parties.length > 0) {
            _.map(userInfo.parties, (partyID) => {
              disbandParty(partyID, "Party Owner removed his account");
            });
          }
          // Remove user from all unstarted parties that contain the user
          PartyModel.update({
            gifting: {
              $size: 0
            }
          }, {
            $pull: {
              participants: body.psid
            }
          });
          callSendAPI(body.psid, {
            text: `We have removed your profile from our database. Delete this conversation to completely remove your account. It's sad to see you go, good luck in the future! :^)`
          });
        }
      });
      break;
    default:
      res.json({err: 'Action is not available.'})
  }
});

app.get('/profile', (req, res) => {
  let referer = req.get('Referer');
  let {
    psid
  } = req.query
  if (referer) {
    if (referer.indexOf('www.messenger.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
    } else if (referer.indexOf('www.facebook.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
    }
    UserModel.findOne({
      psid
    }, (err, user) => {
      res.render('profile', {
        user
      });
    })
  }
});

app.get('/wishlist', (req, res) => {
  const body = req.query;
  switch (body.action) {
    case 'ADD':
      UserModel.findOneAndUpdate({
        psid: body.psid
      }, {
        $push: {
          wishlist: {
            name: body.name,
            id: body.id
          }
        }
      }, (err, results) => {
        if (err) {
          console.log(err);
        }
      })
      break;
    case 'REMOVE':
      UserModel.findOneAndUpdate({
        psid: body.psid
      }, {
        $pull: {
          wishlist: {
            id: body.id
          }
        }
      }, (err, results) => {
        if (err) {
          console.log(err);
        }
      })
      break;
  }
})

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

app.get('/startpartypostback', (req, res) => {
  const {
    party_id,
    psid
  } = req.query;
  PartyModel.findOne({
    _id: party_id
  }, (err, partyInfo) => {
    if (partyInfo.gifting.length > 0) {
      console.log("Game Already Started");
      callSendAPI(psid, {
        text: "You have already started the party!"
      });
      return;
    }
    const {
      participants
    } = partyInfo;
    let gifting = [];
    let recipients = [];
    _.map(participants, (participant) => {
      let pool = participants.slice(0);
      pool.splice(pool.indexOf(participant), 1);
      pool = _.difference(pool, recipients);
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
    PartyModel.findOneAndUpdate({
      _id: party_id
    }, {
      gifting
    }, (err, newParty) => {
      if (err) {} else {
        _.map(gifting, (pair) => {
          UserModel.findOneAndUpdate({
            psid: pair.from
          }, {
            $addToSet: {
              recipients: {
                id: pair.to,
                party_id
              }
            }
          }, (err) => {
            if (err) {
              console.log(err)
            } else {
              UserModel.findOne({
                psid: pair.to
              }, {
                name: 1
              }, (err, getter) => {
                if (err) {
                  console.log(err)
                } else {
                  console.log(pair.to, getter.name);
                  callSendAPI(pair.from, {
                    text: `Your secret santa recipient has been assigned! You will be getting a gift for: ${getter.name}`
                  });
                }
              })
            }
          })
        });
      }
    });
  })
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

app.get('/help', (req, res) => {
  res.redirect('https://wangyonglin1999.gitbook.io/secretsanta/');
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
      setRoomPreferences(sender_psid)
      break;
    case 'MY_PARTIES':
      postbackParties(sender_psid);
      break;
    case 'MY_RECIPIENTS':
      postbackRecipients(sender_psid);
      break;
    case 'MY_PROFILE':
      UserModel.findOne({
        psid: sender_psid
      }, {
        name: 1
      }, (err, user) => {
        if (err) {
          callSendAPI(sender_psid, {
            text: `Failed to retrieve your profile, please try again later`
          });
        } else if (user) {
          callSendAPI(sender_psid, {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: `Hi ${user.name}, click on the button to view your profile.`,
                buttons: [{
                  type: "web_url",
                  url: SERVER_URL + "/profile?psid=" + sender_psid,
                  title: "My Profile",
                  webview_height_ratio: 'tall',
                  messenger_extensions: true
                }]
              }
            }
          });
        } else {
          callSendAPI(sender_psid, {
            text: `We don't have a profile for you! A profile will be automatically created when you accept an invitation or create a party!`
          });
        }
      });
      break;

  }
}

function postbackRecipients(sender_psid) {
  UserModel.findOne({
    psid: sender_psid
  }, {
    recipients: 1
  }, (err, user) => {
    if (err) {
      console.log(err)
      callSendAPI(sender_psid, {
        text: "Failed to retrieve your recipients... This is likely our fault. Please try again later."
      });
    } else if (user) {
      if (user.recipients.length === 0) {
        callSendAPI(sender_psid, {
          text: 'You do not have any recipients. If you are already in a party, please inform the owner to start the party.'
        })
        return;
      }
      callSendAPI(sender_psid, {
        text: 'Here are your recipients! (Remember to keep it hush hush!)'
      })
      _.map(user.recipients, (recipient, i) => {
        UserModel.findOne({
          psid: recipient.id
        }, {
          name: 1,
          profile: 1,
          wishlist: 1
        }, (err, person) => {
          PartyModel.findOne({
            _id: recipient.party_id
          }, {
            name: 1
          }, (err, partyInfo) => {
            callSendAPI(sender_psid, messages.recipientDetailsPrompt(person, partyInfo.name));
          })
        });
      });
    } else {
      callSendAPI(sender_psid, {
        text: 'You are not in any parties! Please start or join a party then come back.'
      })
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
        callSendAPI(sender_psid, messages.partyDetailsPrompt(party));
      });
    } else {
      callSendAPI(sender_psid, {
        text: "You haven't created any party yet! Click on <Create a party> bellow to get started!"
      });
    }
  })
}

function disbandParty(partyID, reason) {
  PartyModel.findOne({
    _id: partyID
  }, {
    name: 1,
    participants: 1,
    gifting: 1
  }, (err, party) => {
    if (gifting.length === 0) {
      _.map(party.participants, (participant) => {
        callSendAPI(participant, {
          text: `${party.name} has been disbanded! Because: ${reason}.`
        })
      })
      PartyModel.deleteOne({
        _id: partyID
      });
    }
  })
}

// Define the template and webview
function setRoomPreferences(sender_psid) {
  jwt.sign({
    psid: sender_psid
  }, JWT_CERT, {
    expiresIn: '2h'
  }, (err, encoded) => {
    const tokenInstance = new TokenModel({
      token: encoded,
      target: 'NEW_PARTY'
    });
    tokenInstance.save((err) => {
      if (err) {
        console.log('Failed to register token.')
      } else {
        let response = {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              "text": "Sounds good, let's get your party going! 🎉🎉 \n(Please note this link will expire in 2 hours)",
              buttons: [{
                  type: "web_url",
                  url: SERVER_URL + "/options?access=" + encoded,
                  title: "Create Your Party",
                  webview_height_ratio: 'tall',
                  messenger_extensions: true
                },
                {
                  type: "web_url",
                  url: SERVER_URL + "/help",
                  title: "What are parties?",
                  webview_height_ratio: 'full',
                }
              ]
            }
          }
        };
        callSendAPI(sender_psid, response);
      }
    })
  })
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
        callback({
          message: "Failed to retrieve user profile from facebook",
          code: 1
        }, null)
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
      console.log('message sent!');
    } else {
      console.error("Unable to send message:" + err);
    }
  });
}