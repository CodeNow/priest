'use strict'

require('loadenv')()

const log = require('logger').child({ module: 'priest' })
const ponos = require('ponos')

/**
 * The Priest ponos server.
 * @type {ponos~Server}
 * @module priest/server
 */
module.exports = new ponos.Server({
  name: process.env.APP_NAME,
  enableErrorEvents: true,
  rabbitmq: {
    channel: {
      prefetch: 25
    },
    hostname: process.env.RABBITMQ_HOSTNAME,
    port: process.env.RABBITMQ_PORT,
    username: process.env.RABBITMQ_USERNAME,
    password: process.env.RABBITMQ_PASSWORD
  },
  log: log,
  tasks: {
    'priest.update.organization': require('/workers/update.organization')
  },
  events: {
    'organization.updated': require('./events/organization.updated')
  }
})
