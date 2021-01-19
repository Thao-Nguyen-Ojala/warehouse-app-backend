const express = require('express');
const router = express.Router();

/* GET home page. */
router.get('/', cors(corsOptions), (req, res) => {
  res.send(productsData)
});

module.exports = router;
