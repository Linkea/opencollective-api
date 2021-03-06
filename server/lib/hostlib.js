import models, {sequelize} from '../models';
import _ from 'lodash';
import { convertToCurrency } from '../lib/currency';
import Promise from 'bluebird';


export function getHostedGroups(hostid, endDate = new Date) {
  return sequelize.query(`
    SELECT g.* FROM "Groups" g LEFT JOIN "UserGroups" ug ON g.id = ug."GroupId" WHERE ug.role='HOST' AND ug."UserId"=:hostid AND g."deletedAt" IS NULL AND ug."deletedAt" IS NULL AND ug."createdAt" < :endDate AND g."createdAt" < :endDate
  `, {
    replacements: { hostid, endDate },
    model: models.Group,
    type: sequelize.QueryTypes.SELECT
  });
}

export function getBackersStats(startDate = new Date('2015-01-01'), endDate = new Date, groupids) {

  const getBackersIds = (startDate, endDate) => {
    const where = {
        type: 'DONATION',
        createdAt: { $gte: startDate, $lt: endDate }
      };

    if (groupids) {
      where.GroupId = { $in: groupids };
    }

    return models.Transaction.findAll({
      attributes: [ [sequelize.fn('DISTINCT', sequelize.col('UserId')), 'userid'] ],
      where
    })
    .then(rows => rows.map(r => r.dataValues.userid))
    ;
  }

  const stats = {};

  return Promise.all([
    getBackersIds(new Date('2015-01-01'), endDate),
    getBackersIds(new Date('2015-01-01'), startDate),
    getBackersIds(startDate, endDate)
  ]).then(results => {
    stats.total = results[0].length;
    stats.repeat = _.intersection(results[1], results[2]).length;
    stats.new = results[2].length - stats.repeat;
    stats.inactive = stats.total - (stats.repeat + stats.new);
    return stats;
  });
}

export function sumTransactionsByCurrency(attribute = 'netAmountInGroupCurrency', where) {
  const query = {
    attributes: [ [sequelize.fn('SUM', sequelize.col(attribute)), 'amount'], 'currency' ],
    group: ['currency'],
    where
  };
  return models.Transaction.findAll(query)
    .then(rows => rows.map(r => r.dataValues))
    ;
}

/**
 * Sum an attribute of the Transactions table and return the result by currency with the total in host currency
 * 
 * @param {*} attribute column to sum, e.g. 'netAmountInGroupCurrency' or 'hostFeeInTxnCurrency'
 * @param {*} where where clause to reduce the scope
 * @param {*} hostCurrency currency of the host
 *
 * @post { 
 *   byCurrency: [ { amount: Float!, currency: 'USD' }]
 *   totalInHostCurrency: Float!
 * }
 */
export function sumTransactions(attribute, where = {}, hostCurrency, date) {
  if (where.createdAt) {
    date = date || where.createdAt.$lt || where.createdAt.$gte;
  }
  const res = {};
  return sumTransactionsByCurrency(attribute, where)
    .tap(amounts => {
      res.byCurrency = amounts;
    })
    .then(amounts => Promise.map(amounts, s => convertToCurrency(s.amount, s.currency, hostCurrency || 'USD', date)))
    .then(amounts => {
      let total = 0;
      amounts.map(a => total += a);
      res.totalInHostCurrency = Math.round(total); // in cents
      return res;
    })
    ;
}

export function getTotalHostFees(groupids, type, startDate = new Date('2015-01-01'), endDate = new Date, hostCurrency = 'USD') {
  const where = {
    GroupId: { $in: groupids },
    createdAt: { $gte: startDate, $lt: endDate }
  }; 
  if (type) {
    where.type = type;
  }
  return sumTransactions('hostFeeInTxnCurrency', where, hostCurrency);
}

export function getTotalNetAmount(groupids, type, startDate = new Date('2015-01-01'), endDate = new Date, hostCurrency = 'USD') {
  const where = {
    GroupId: { $in: groupids },
    createdAt: { $gte: startDate, $lt: endDate }
  };
  if (type) {
    where.type = type;
  }
  return sumTransactions('netAmountInGroupCurrency', where, hostCurrency);
}