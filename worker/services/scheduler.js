const cron = require('node-cron');

function initScheduler() {
  console.log('ℹ️  Автоматското испраќање нарачки по распоред е ИСКЛУЧЕНО.');
  console.log('   Нарачките се праќаат рачно преку копчето „Прати нарачка за утре" во апликацијата.');
  // To re-enable: uncomment below and require runAllOrders from orderSubmitter
  // const { runAllOrders } = require('./orderSubmitter');
  // const scheduleTimes = ['0 12 * * *', '0 13 * * *', '0 14 * * *'];
  // scheduleTimes.forEach(time => {
  //   cron.schedule(time, async () => {
  //     console.log(`[Cron] Извршување: ${time}`);
  //     await runAllOrders();
  //   });
  // });
}

module.exports = { initScheduler };
