const serverless = require("serverless-http");
const app = require("../app");
module.exports = (req, res) => serverless(app)(req, res);
