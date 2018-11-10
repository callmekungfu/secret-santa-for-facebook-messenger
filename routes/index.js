var express = require('express');
let news    = require('../api/newsletters');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/contacts', (req, res) => {
  res.send({
    hi: "yeah"
  })
});

router.post('/news', (req, res) => {
  
})

module.exports = router;
