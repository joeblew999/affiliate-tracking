//   GET  /api/admin/links?affiliate_id=1                         an affiliate's links
//   POST /api/admin/links { affiliate_id, destination, campaign?, slug? }   create one for them
//   POST /api/admin/link-archive { affiliate_id, id }            archive one

import { requireAdmin } from './_gate.ts';
import { readJsonObject } from '../_public.ts';
import { listLinks, createLink, archiveLink } from '../../../src/links.ts';
import type { AffiliateRouteContext, AffiliatesRow, DbEnv } from '../../../src/types.ts';
import { hasDb } from '../../../src/env.ts';

async function affiliateById(env: DbEnv, id: unknown): Promise<Pick<AffiliatesRow, 'id' | 'code'> | null> {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    return env.DB.prepare('SELECT id, code FROM affiliates WHERE id=?1').bind(id).first<Pick<AffiliatesRow, 'id' | 'code'>>();
}

export async function onRequestGet({ request, env }: AffiliateRouteContext) {
    const gate = await requireAdmin(env, request);
    if (gate) return gate;
    if (!hasDb(env)) return Response.json({ ok: false, error: 'DB not bound' }, { status: 500 });
    const aff = await affiliateById(env, Number(new URL(request.url).searchParams.get('affiliate_id')));
    if (!aff) return Response.json({ ok: false, error: 'Affiliate not found' }, { status: 404 });
    return Response.json({ ok: true, links: await listLinks(env, request, aff.id) });
}

export async function onRequestPost({ request, env }: AffiliateRouteContext) {
    const gate = await requireAdmin(env, request);
    if (gate) return gate;
    if (!hasDb(env)) return Response.json({ ok: false, error: 'DB not bound' }, { status: 500 });
    const body = await readJsonObject(request);
    const aff = await affiliateById(env, body.affiliate_id);
    if (!aff) return Response.json({ ok: false, error: 'Affiliate not found' }, { status: 404 });
    const result = await createLink(env, request, aff, body);
    if (result.error) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, link: result.link }, { status: 201 });
}

export async function onArchivePost({ request, env }: AffiliateRouteContext) {
    const gate = await requireAdmin(env, request);
    if (gate) return gate;
    if (!hasDb(env)) return Response.json({ ok: false, error: 'DB not bound' }, { status: 500 });
    const { affiliate_id: affiliateId, id } = await readJsonObject(request);
    return await archiveLink(env, affiliateId, id)
        ? Response.json({ ok: true })
        : Response.json({ ok: false, error: 'Link not found' }, { status: 404 });
}
