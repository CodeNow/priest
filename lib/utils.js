module.exports = {
  getPayrate (numConfig, numUsers) {
    var realNumUsers = numUsers

    if (numUsers < 3) {
      realNumUsers = 3
    }

    if (numConfig > 7) {
      return 49 * realNumUsers
    } else if (numConfig > 2) {
      return 29 * realNumUsers
    } else {
      return 9 * realNumUsers
    }
  },

  promiseWhile (condition, action) {
    function loop (data) {
      if (condition(data)) { return Promise.resolve(data) }
      return action(data).then(loop)
    }
    return loop
  },

  extractCompaniesAndPagesFromResponse ({ body }) {
    return { companies: body.companies, pages: body.pages }
  }
}
