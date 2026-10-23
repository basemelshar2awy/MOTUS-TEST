'use strict';
/* the sample data lives with the demo-data console tool; this file keeps the command-line use:
   node test/e2e/seed.js <base> <email> <password> */
const { seed } = require('../../server/tools/lib/sample-data');
module.exports = { seed };
if (require.main === module) {
  const H = require('../helpers');
  (async () => {
    const [base, email, pw] = process.argv.slice(2);
    const c = H.client(base);
    const l = await c.login(email, pw); if (l.status !== 200) throw new Error(JSON.stringify(l.data));
    console.log(JSON.stringify(Object.keys(await seed(c))));
  })().catch(e => { console.error(e.message); process.exit(1); });
}
