// The admin dashboard and the example pages run their scripts in the browser,
// where no test executes them. Parse each inline script so a syntax error
// (such as TypeScript slipping into the page) fails here instead, and check
// the page's own markup closes every section, div and form it opens.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { adminDashboard } from '../../src/admin-dashboard.ts';

function inlineScripts(html) {
    return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

function assertParses(html, name) {
    const scripts = inlineScripts(html);
    for (const [i, script] of scripts.entries()) {
        try {
            new Function(`return async () => {\n${script}\n}`);
        } catch (err) {
            assert.fail(`${name}, script ${i + 1}: ${err.message}`);
        }
    }
    return scripts.length;
}

describe('page scripts', () => {
    it('the admin dashboard script is valid browser JavaScript', async () => {
        const res = adminDashboard({ request: new Request('https://example.test/admin/affiliates/'), env: {} });
        const html = await res.text();
        assert.ok(assertParses(html, 'admin dashboard') > 0);
        const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
        for (const tag of ['section', 'div', 'form', 'table', 'nav']) {
            const opened = markup.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length || 0;
            const closed = markup.match(new RegExp(`</${tag}>`, 'g'))?.length || 0;
            assert.equal(closed, opened, `<${tag}> opened ${opened} times, closed ${closed}`);
        }
    });

    it('every example page script is valid browser JavaScript', () => {
        const dir = new URL('../../examples/', import.meta.url);
        for (const file of readdirSync(dir).filter(f => f.endsWith('.html'))) {
            assertParses(readFileSync(new URL(file, dir), 'utf8'), file);
        }
    });
});
