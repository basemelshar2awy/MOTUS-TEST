'use strict';
/* Tiny SQL builders. Column names always come from code (never from user input). */
const COL = /^[a-z_][a-z0-9_]*$/;

async function insert(c, table, row) {
  const cols = Object.keys(row).filter(k => row[k] !== undefined);
  cols.forEach(k => { if (!COL.test(k)) throw new Error('bad column ' + k); });
  const vals = cols.map(k => (row[k] !== null && typeof row[k] === 'object' && !Array.isArray(row[k]) && !(row[k] instanceof Date) && !Buffer.isBuffer(row[k])) ? JSON.stringify(row[k]) : row[k]);
  const r = await c.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, vals);
  return r.rows[0];
}
async function update(c, table, id, row) {
  const cols = Object.keys(row).filter(k => row[k] !== undefined);
  if (!cols.length) return null;
  cols.forEach(k => { if (!COL.test(k)) throw new Error('bad column ' + k); });
  const vals = cols.map(k => (row[k] !== null && typeof row[k] === 'object' && !Array.isArray(row[k]) && !(row[k] instanceof Date) && !Buffer.isBuffer(row[k])) ? JSON.stringify(row[k]) : row[k]);
  const r = await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING *`, [...vals, id]);
  return r.rows[0] || null;
}
/* remove keys whose value is undefined (used to build partial updates) */
const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

module.exports = { insert, update, defined };
