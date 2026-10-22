'use strict';
/* Action registry. Each business action declares who may run it; the dispatcher checks the
   role, opens a company-scoped transaction, checks the company's activities (lib/activities),
   runs the handler, writes the data version and translates database errors into plain
   bilingual messages. An action of one activity declares it with define(name, roles, fn,
   { activity: 'cargo' }) or is listed in activities.ACTION_ACTIVITY. */
const db = require('../lib/db');
const core = require('../lib/core');
const activities = require('../lib/activities');
const { forbidden, AppError, fromPg } = require('../lib/errors');

const ROLES = ['super_admin', 'company_admin', 'fleet_manager', 'operations', 'accountant', 'maintenance', 'viewer'];
/* role groups (super_admin is always allowed inside the company it is working in) */
const G = {
  admin: ['company_admin'],
  fleet: ['company_admin', 'fleet_manager'],
  ops: ['company_admin', 'fleet_manager', 'operations'],
  finance: ['company_admin', 'fleet_manager', 'accountant'],
  accounting: ['company_admin', 'accountant'],
  maint: ['company_admin', 'fleet_manager', 'maintenance'],
  stock: ['company_admin', 'fleet_manager', 'maintenance', 'accountant'],
  opsMaint: ['company_admin', 'fleet_manager', 'operations', 'maintenance'],
  opsFin: ['company_admin', 'fleet_manager', 'operations', 'accountant'],
  providers: ['company_admin', 'fleet_manager', 'accountant'],
  anyWriter: ['company_admin', 'fleet_manager', 'operations', 'accountant', 'maintenance'],
};

const actions = new Map();
function define(name, roles, handler, opts = {}) {
  if (actions.has(name)) throw new Error('duplicate action ' + name);
  actions.set(name, { name, roles, handler, opts });
}

/* 'integration' = an Open API key; its scopes are checked by the API layer before calling */
function allowed(role, def) { return role === 'super_admin' || role === 'integration' || def.roles.includes(role); }

let onChange = () => {};
const setOnChange = fn => { onChange = fn; };

/* ctx: { companyId, user: {id, name, role, apiKey?}, ip, source } */
async function run(ctx, name, input) {
  const def = actions.get(name);
  if (!def) throw new AppError(404, 'unknown_action', 'إجراء غير معروف', 'Unknown action: ' + name);
  if (!ctx.user || !allowed(ctx.user.role, def)) throw forbidden();
  if (!ctx.companyId) throw new AppError(400, 'no_company', 'اختر شركة أولاً', 'Select a company first');
  try {
    const out = await db.tx(ctx.companyId, async c => {
      // activity check: an action (or an input field) of an activity the company does not have is refused here
      const gated = await activities.gate(c, ctx, name, def, input || {});
      const res = await def.handler(ctx, gated, c);
      if (!def.opts.readOnly && !def.opts.noTouch) await core.touch(c, ctx);
      return res;
    });
    if (!def.opts.readOnly && !def.opts.noTouch) onChange(ctx.companyId);
    return out === undefined ? { ok: true } : out;
  } catch (e) {
    throw fromPg(e);
  }
}

const list = () => [...actions.values()].map(a => ({ name: a.name, roles: a.roles }));
module.exports = { define, run, G, ROLES, allowed, actions, list, setOnChange };
