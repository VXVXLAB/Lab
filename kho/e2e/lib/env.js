const path = require('path');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:18091';
const OUT = path.resolve(__dirname, '..', 'out');

module.exports = { BASE_URL, OUT };
