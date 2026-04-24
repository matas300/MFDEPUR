const request = require('supertest');

function makeApp() {
  delete require.cache[require.resolve('../../src/app')];
  return require('../../src/app');
}

function agent() {
  return request.agent(makeApp());
}

module.exports = { makeApp, agent, request };
