const express = require('express');
const { createTicket, getTickets, updateTicket } = require('../controllers/ticketController');

const router = express.Router();

router.post('/create', createTicket);
router.get('/', getTickets);
router.put('/update', updateTicket);

module.exports = router;
