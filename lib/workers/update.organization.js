'use strict'

require('loadenv')()

const keypather = require('keypather')()
const logger = require('logger')
const Promise = require('bluebird')
const schemas = require('models/schemas')
const WorkerStopError = require('error-cat/errors/worker-stop-error')

module.exports.jobSchema = schemas.containerLifeCycleEvent

/**
 * @param {Object} job - Job info
 * @returns {Promise}
 * @resolve {undefined}
 */
module.exports.task = (job) => {
  let log = logger.child({
    module: 'bigpoppa.organization.updated',
    data: job
  })
  return Promise
    // Get bigPoppa organization information
    // Get org cost from Datadog
    // Update company on Intercom
    .try(() => {
      const cvId = job.inspectData.Config.Labels['contextVersion._id'] || job.inspectData.Config.Labels['contextVersionId']
      log.trace({ cvId: cvId }, 'searching for instances by contextVersion')
      return mongoClient.findInstancesAsync({
        'contextVersion._id': new ObjectID(cvId),
        isTesting: true
      })
    })
    .tap((instances) => {
      if (!instances || instances.length === 0) {
        throw new WorkerStopError(
          'Testing instance not found with context version id',
          { instances: instances }, { level: 'info' }
        )
      }
    })
    .each((instance) => {
      if (job.inspectData.Config.Labels.type === 'user-container' &&
        keypather.get(instance, 'container.dockerContainer') &&
        keypather.get(instance, 'container.dockerContainer') !== job.inspectData.Id) {
        throw new WorkerStopError(
          'User container is not attached to instance', {}, { level: 'info' }
        )
      }
      const mainAcv = (keypather.get(instance, 'contextVersion.appCodeVersions') || [])
        .find((acv) => {
          return acv && !acv.additionalRepo
        })
      if (!mainAcv) {
        throw new WorkerStopError('Instance is not a repo based instance', {}, { level: 'info' })
      }
      const containerStatus = module.exports.calculateStatus(job)
      if (!containerStatus) {
        log.trace('Calculated status is null, not reporting')
        return
      }
      const githubStatus = new GitHubStatus()
      log.trace({ status: githubStatus, instance: instance._id }, 'Populating github status for instance')
      return githubStatus.setStatus(instance, mainAcv, containerStatus)
        .catch(PreconditionError, (err) => {
          throw new WorkerStopError(
            'Preconditions failed to report to github',
            { originalError: err }
          )
        })
        .catch(FatalGithubError, (err) => {
          throw new WorkerStopError(
            'Github error when setting status',
            { originalError: err }
          )
        })
    })
    .return()
}

module.exports.calculateStatus = (job) => {
  const exitedProperly = keypather.get(job, 'inspectData.State.ExitCode') === 0 &&
    !keypather.get(job, 'inspectData.State.Error')
  const containerType = keypather.get(job, 'inspectData.Config.Labels.type')
  if (containerType === 'image-builder-container') {
    // If it's an image builder container we only care if it failed to build
    if (!exitedProperly) {
      return 'failure'
    }
  } else {
    if (exitedProperly) {
      return 'success'
    }
    return 'error'
  }
}
