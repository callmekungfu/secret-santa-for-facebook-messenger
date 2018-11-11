var express = require('express');
const SubscriberModel = require('../api/newsletters');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/contacts', (req, res) => {
  res.send({
    hi: "yeah",
    hello: "hi"
  })
});

router.post('/subscribe', (req, res) => {
  console.log(req.body);
  const subscriberInstance = new SubscriberModel(req.body);
  subscriberInstance.save((err) => {
    if (err) {
      res.send({
        status: 'error',
        err
      });
    } else {
      res.send({
        status: 'success'
      });
    }
  })
})

module.exports = router;
