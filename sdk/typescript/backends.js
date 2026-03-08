'use strict';

const sdk = require('./index.js');

const api = {
  PandoraAgentClient: sdk.PandoraAgentClient,
  PandoraMcpBackend: sdk.PandoraMcpBackend,
  PandoraStdioBackend: sdk.PandoraStdioBackend,
  PandoraRemoteBackend: sdk.PandoraRemoteBackend,
  createPandoraStdioBackend: sdk.createPandoraStdioBackend,
  createPandoraRemoteBackend: sdk.createPandoraRemoteBackend,
  createLocalPandoraAgentClient: sdk.createLocalPandoraAgentClient,
  createRemotePandoraAgentClient: sdk.createRemotePandoraAgentClient,
  createPandoraAgentClient: sdk.createPandoraAgentClient,
  connectPandoraAgentClient: sdk.connectPandoraAgentClient,
};

api.default = api;

module.exports = Object.freeze(api);
