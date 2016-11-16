const dogapi = require('dogapi')
const Intercom = require('intercom-client')
const github = require('octonode')
const Promise = require('bluebird')
const SlackBot = require('slackbots')
const BigPoppaClient = require('@runnable/big-poppa-client')
const utils = require('./utils')

class Priest {
  constructor (config) {
    this.bot = new SlackBot({
      token: process.env.SLACK_BOT_TOKEN,
      name: process.env.SLACK_BOT_NAME
    })
    this.bpClient = new BigPoppaClient(process.env.BIG_POPPA_HOST)
    this.github = github.client({
      id: process.env.GITHUB_ID,
      secret: process.env.GITHUB_SECRET,
      hostname: process.env.GITHUB_HOST,
      port: process.env.GITHUB_PORT
    })
    this.datadog = dogapi.initialize({
      api_key: process.env.DATADOG_API_KEY,
      app_key: process.env.DATADOG_APP_KEY
    })
    this.intercom = new Intercom.Client({
      appId: process.env.INTERCOM_APP_ID,
      appApiKey: process.env.INTERCOM_API_KEY
    })
    this.companyList = []
    this.costList = {}
  }

  getBigPoppaOrgs () {
    return this.client.getOrganizations()
      .then((bigPoppaObj) => {
        return bigPoppaObj.length
      })
      .catch((err) => (this.throwError(err, `Cannot communicate with Big Poppa`)))
  }

  getBigPoppaOrgFromGithubOrg (company) {
    return this.client.getOrganizations({ githubId: company.custom_attributes.github_id })
      .then(orgs => orgs[0])
      .then((bigPoppaObj) => {
        let bpHasConfirmedSetup = bigPoppaObj.metadata.hasConfirmedSetup ? bigPoppaObj.metadata.hasConfirmedSetup : null

        company.custom_attributes.push({
          created_at: bigPoppaObj.createdAt,
          bp_activePeriodEnd: bigPoppaObj.activePeriodEnd,
          bp_firstDockCreated: bigPoppaObj.firstDockCreated,
          bp_hasPaymentMethod: bigPoppaObj.hasPaymentMethod,
          bp_stripeCustomerId: bigPoppaObj.stripeCustomerId,
          bp_trialEnd: bigPoppaObj.trialEnd,
          bp_isActive: bigPoppaObj.isActive,
          bp_users: bigPoppaObj.users.length,
          bp_is_allowed: bigPoppaObj.allowed,
          bp_is_in_trial: bigPoppaObj.isInTrial,
          bp_is_in_grace: bigPoppaObj.isInGracePeriod,
          bp_has_confirmed_setup: bpHasConfirmedSetup
        })
        console.log(`Added bigPoppa data for ${company.name}`)
        return company
      })
      .catch((err) => (this.throwError(err, `Cannot find organization: ${company.name} in Big Poppa`)))
  }

  getCompaniesFromIntercom () {
    console.log('Going to intercom to get all of our companies')
    return this.intercom.companies.list()
      .then(utils.extractCompaniesAndPagesFromResponse)
      .then(utils.promiseWhile(
        // until we don't have a next page
        (data) => (!(data.pages && data.pages.next)),
        (data) => {
          return this.intercom.nextPage(data.pages)
            .then(utils.extractCompaniesAndPagesFromResponse)
            .then(({ companies, pages }) => {
              Array.prototype.push.apply(data.companies, companies)
              data.pages = pages
              return data
            })
        }
      ))
      .then(({ companies }) => {
        return companies
          .filter((c) => (!!c.name))
          .map((c) => {
            if (c.custom_attributes && c.custom_attributes.github_id && c.custom_attributes.github_id > 0) {
              return c
            } else {
              return this.getId(c.name.toLowerCase)
                .then((githubId) => {
                  c.custom_attributes.github_id = githubId
                  return c
                })
                .catch(() => {
                  console.log(`Could not find Github ID for ${c.name}`)
                  c.custom_attributes.github_id = -1
                  return c
                })
            }
          })
      })
      .catch((err) => (this.throwError(err, 'Something went wrong talking to Intercom')))
  }

  getCompanyStatisticsFromIntercom (company) {
    console.log(`Getting Intercom info for ${company.name}`)
    return this.intercom.companies.listUsers({ id: company.id })
      .then((users) => {
        let signedupDates = []

        if (users && users.body && users.body.users) {
          let wasNaviUserFound = false
          let numUsers = 0
          let numConfigs = company.custom_attributes.total_masters

          users.body.users.forEach(function (user) {
            if (user.user_id && user.user_id.indexOf('navi') > -1) {
              wasNaviUserFound = true
            }
            signedupDates.push(user.signed_up_at)
            numUsers++
          })

          // account for navi user
          if (wasNaviUserFound) {
            numUsers--
          }

          let payrate = utils.getPayrate(numConfigs, numUsers)

          company.custom_attributes.push({
            first_user_created_at: signedupDates.sort().shift(),
            datadog_link: 'https://app.datadoghq.com/screen/72673/customer-cost?tpl_var_org=' + company.custom_attributes.github_id,
            cost: company.cost,
            profit: payrate - company.cost,
            preview_rate: (payrate / 2).toFixed(2).toString(),
            pay_rate: payrate,
            hijack_link: 'https://eru.runnable.io/app/org/' + company.custom_attributes.company_id,
            bp_activePeriodEnd: -1
          })
        } else {
          console.log(`No users found for ${company.name}`)
        }
        console.log(`Added Intercom info for ${company.name}`)
        return company
      })
  }

  getOrgCostList () {
    let now = parseInt(new Date().getTime() / 1000)
    let then = now - 3600 // one hour ago
    let query = "top(( ( sum:system.mem.total{role:dock,env:production-delta} by {org} * 10.8 ) / 1046347776 ) + ( ( sum:system.disk.total{role:dock,env:production-delta} by {org} * 0.1 ) / 1072073362.9217391 ), 500, 'max', 'desc')"
    console.log('Going to Datadog to get a list of orgs -> costs.')
    const queryDatadog = Promise.promisify(dogapi.metric.query)
    return queryDatadog(then, now, query)
      .then((costs) => {
        let costList = {}
        costs.series.forEach(function (costItem) {
          var orgId = costItem.scope.split(':')[2].split(',')[0]
          try {
            var cost = costItem.pointlist[0][1] ? costItem.pointlist[0][1].toString() : -1
          } catch (err) {
            console.log({ message: 'Something went wrong parsing the costs', err })
          }

          costList[orgId] = cost
        })
        return costList
      })
      .catch((err) => (this.throwError(err, `Something went wrong querying datadog!`)))
  }

  getId (orgName) {
    return new Promise((resolve, reject) => {
      this.github.get('/users/' + orgName, function (err, status, body, headers) {
        if (err) {
          reject(err)
        } else {
          resolve(body.id)
        }
      })
    })
  }

  done () {
    this.bot.postMessageToChannel('analytics', 'Done Running Priest')
      .then(() => {
        console.log('iterating done')
        process.exit(0)
      })
  }

  run () {
    this.getBigPoppaOrgs()
      .then(console.log)
    // return Promise.props({
    //   companies: this.getCompaniesFromIntercom(),
    //   costList: this.getOrgCostList()
    // })
    //   .then(({companies, costList}) => {
    //     console.log(costList)
    //     let filteredCompanies = []
    //     companies.forEach((company) => {
    //       // Add cost of org to company object in companies array
    //       console.log(company.name, company.custom_attributes.github_id)
    //       if (company.custom_attributes.github_id > 0) {
    //         company.cost = costList[company.custom_attributes.github_id]
    //         filteredCompanies.push(company)
    //       }
    //     })
    //     console.log('Added costs to companies')
    //     return filteredCompanies
    //   })
    //   // append bigPoppa info
    //   .each((company) => this.getCompanyStatisticsFromIntercom(company))
    //   .each((company) => this.getBigPoppaOrgFromGithubOrg(company))
    //   .each((company) => this.updateCompanyOnIntercom(company))
    //   .catch((err) => {
    //     console.log('End of program')
    //     console.log(err)
    //     this.done
    //   })
    //   .finally(() => this.done)
  }

  throwError (err, message) {
    console.log(message)
    throw new Error(err)
  }

  updateCompanyOnIntercom (company) {
    console.log(company.custom_attributes)
    // return this.intercom.companies.create({ company_id: companyId })
    //   .then((res) => {
    //     console.log(res)
    //   })
    //   .catch((err) => {
    //     throw new Error(`Could not update company: ${companyId} on Intercom.`, err)
    //   })
  }

}
