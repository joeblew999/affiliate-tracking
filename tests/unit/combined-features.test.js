// Cases that only exist once several features are in together.
import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { recordConversion } from '../../src/webhook.js';
import { recordInvoicePayment } from '../../src/invoice.js';
import { releaseHeldConversions } from '../../src/hold.js';
import { database } from './_db.js';

const cleanups = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-01-31T10:00:00Z');

function setup() {
    const { sql, DB } = database();
    cleanups.push(() => sql.close());
    sql.exec(`INSERT INTO affiliates (id,email,code,status,commission_pct,created_at)
              VALUES (1,'nick@example.test','nick','active',20,0)`);
    sql.exec(`INSERT INTO links (id,affiliate_id,slug,destination,status,created_at)
              VALUES ('link-1',1,'nick-youtube','/pricing','active',0)`);
    return { sql, env: { DB, AFFILIATE_HOLD_DAYS: '30' } };
}

function subscribe(env, email) {
    return recordConversion({
        id: 'cs_sub', mode: 'subscription', amount_total: 2000, currency: 'usd',
        customer: 'cus_1', subscription: 'sub_1', invoice: 'in_first',
        customer_details: { email },
        metadata: { affiliate_id: '1', affiliate_link_id: 'link-1', affiliate_user_id: 'user-1' },
        discounts: [], total_details: { amount_discount: 0 },
    }, { id: 'evt_cs', created: Math.floor(START / 1000) }, env);
}

function renewal(n = 1, overrides = {}) {
    return {
        id: 'in_' + n, object: 'invoice', billing_reason: 'subscription_cycle', amount_paid: 2000, currency: 'usd',
        customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } }, payment_intent: 'pi_' + n,
        status_transitions: { paid_at: Math.floor((START + n * 31 * DAY) / 1000) }, lines: { data: [] },
        ...overrides,
    };
}

describe('features together', () => {
    it('a renewal keeps the first sale\'s link, user and fraud flag, so the hold period never pays it', async () => {
        const { sql, env } = setup();
        await subscribe(env, 'nick@example.test'); // the affiliate buying through their own link
        await recordInvoicePayment(renewal(), { id: 'evt_in_1' }, env);
        const rows = sql.prepare('SELECT kind, link_id, user_id, fraud_reason FROM conversions ORDER BY id').all().map(r => ({ ...r }));
        assert.deepEqual(rows, [
            { kind: 'checkout', link_id: 'link-1', user_id: 'user-1', fraud_reason: 'self_email' },
            { kind: 'renewal', link_id: 'link-1', user_id: 'user-1', fraud_reason: 'self_email' },
        ]);
        assert.equal(await releaseHeldConversions(env, START + 400 * DAY), 0);
    });

    it('a clean renewal keeps its link and is released by the hold period', async () => {
        const { sql, env } = setup();
        await subscribe(env, 'buyer@example.test');
        await recordInvoicePayment(renewal(), { id: 'evt_in_1' }, env);
        assert.equal(await releaseHeldConversions(env, START + 400 * DAY), 2);
        const rows = sql.prepare('SELECT kind, link_id, status FROM conversions ORDER BY id').all().map(r => ({ ...r }));
        assert.deepEqual(rows, [
            { kind: 'checkout', link_id: 'link-1', status: 'approved' },
            { kind: 'renewal', link_id: 'link-1', status: 'approved' },
        ]);
    });

    it('renewals go through the commission rules, and a per-customer cap counts them', async () => {
        const { sql, env } = setup();
        sql.exec(`INSERT INTO commission_rules (id,kind,percent,cap_per_customer_cents,created_at)
                  VALUES ('rule-1','percent',50,1500,0)`);
        await subscribe(env, 'buyer@example.test');
        for (let n = 1; n <= 3; n++) await recordInvoicePayment(renewal(n, { customer_email: 'buyer@example.test' }), {}, env);
        const rows = sql.prepare('SELECT kind, commission_cents, commission_pct FROM conversions ORDER BY id').all().map(r => ({ ...r }));
        assert.deepEqual(rows, [
            { kind: 'checkout', commission_cents: 1000, commission_pct: 50 },
            { kind: 'renewal', commission_cents: 500, commission_pct: 50 },
            { kind: 'renewal', commission_cents: 0, commission_pct: 50 },
            { kind: 'renewal', commission_cents: 0, commission_pct: 50 },
        ]);
    });
});
