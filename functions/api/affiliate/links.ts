//   GET  /api/affiliate/links                    the signed-in affiliate's links, with clicks and sales
//   POST /api/affiliate/links { destination, campaign?, slug? }   create a link
//   POST /api/affiliate/link-archive { id }      archive a link (it stops redirecting)

import { signedInAffiliate } from './_dashboard.ts';
import { readJsonObject } from '../_public.ts';
import { isSameOrigin } from '../_admin-auth.ts';
import { listLinks, createLink, archiveLink } from '../../../src/links.ts';
import type { AffiliateRouteContext } from '../../../src/types.ts';
import { hasDb } from '../../../src/env.ts';

export async function onRequestGet({ request, env }: AffiliateRouteContext) {
    const aff = await signedInAffiliate(request, env);
    if (aff instanceof Response) return aff;
    if (!hasDb(env)) return Response.json({ error: 'Affiliate login is not configured' }, { status: 503 });
    return Response.json({ links: await listLinks(env, request, aff.id) });
}

export async function onRequestPost({ request, env }: AffiliateRouteContext) {
    if (!isSameOrigin(request)) return Response.json({ error: 'Cross-origin request denied' }, { status: 403 });
    const aff = await signedInAffiliate(request, env);
    if (aff instanceof Response) return aff;
    if (!hasDb(env)) return Response.json({ error: 'Affiliate login is not configured' }, { status: 503 });
    const result = await createLink(env, request, aff, await readJsonObject(request));
    if (result.error) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ link: result.link }, { status: 201 });
}

export async function onArchivePost({ request, env }: AffiliateRouteContext) {
    if (!isSameOrigin(request)) return Response.json({ error: 'Cross-origin request denied' }, { status: 403 });
    const aff = await signedInAffiliate(request, env);
    if (aff instanceof Response) return aff;
    if (!hasDb(env)) return Response.json({ error: 'Affiliate login is not configured' }, { status: 503 });
    const { id } = await readJsonObject(request);
    return await archiveLink(env, aff.id, id)
        ? Response.json({ ok: true })
        : Response.json({ error: 'Link not found' }, { status: 404 });
}
