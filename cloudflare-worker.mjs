const CLEAN_HTML_ROUTES = {
  '/': '/index.html',
  '/lapor': '/lapor.html',
  '/track': '/track.html',
  '/qrcodes': '/qrcodes.html'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const normalizedPath = url.pathname.length > 1
      ? url.pathname.replace(/\/+$/, '')
      : url.pathname;
    const targetPath = CLEAN_HTML_ROUTES[normalizedPath];

    if (targetPath && env && env.ASSETS) {
      const targetUrl = new URL(targetPath + url.search, url.origin);
      return env.ASSETS.fetch(new Request(targetUrl.toString(), request));
    }

    return new Response('Not Found', { status: 404 });
  }
};
