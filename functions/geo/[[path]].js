export async function onRequest(context) {
  const url = new URL(context.request.url);
  const key = url.pathname.replace(/^\/geo\//, '');

  if (!key || !key.endsWith('.geojson')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await context.env.GEOJSON.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/geo+json',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
