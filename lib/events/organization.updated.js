'use strict'

require('loadenv')({ project: 'shiva', debugName: 'astral:shiva:env' })

var isEmpty = require('101/is-empty')
var isObject = require('101/is-object')
var isString = require('101/is-string')
var Promise = require('bluebird')
var WorkerStopError = require('error-cat/errors/worker-stop-error')

var RabbitMQ = require('../../common/models/astral-rabbitmq')

module.exports = priestOrganizationUpdated

/**
 * Job to convert organization.updated events into intercom.update tasks
 * @param {Object} job
 * @param {Object} job.organization
 * @param {string} job.organization.githubId
 * @returns {promise}
 */
function priestOrganizationUpdated (job) {
  return Promise
    .try(() => {
      if (!isObject(job)) {
        throw new WorkerStopError('Encountered non-object job')
      }
      if (isEmpty(job.organization.githubId)) {
        throw new WorkerStopError('Job `githubId` field cannot be empty')
      }
      if (Number.isSafeInteger(job.organization.githubId) && !isString(job.organization.githubId)) {
        job.organization.githubId = job.organization.githubId.toString()
      }
      if (!isString(job.githubId)) {
        throw new WorkerStopError(
          'Job missing `githubId` field of type {string}'
        )
      }
    })
    .then(() => {
      return Promise.using(RabbitMQ.getClient(), (rabbit) => {
        return rabbit.publishTask('update.organization', { githubId: job.githubId })
      })
    })
}
