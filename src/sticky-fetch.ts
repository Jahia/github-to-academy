/**
 * The Academy runs as a cluster behind a load balancer: without session
 * affinity, consecutive requests may hit different servers, and JCR cluster
 * synchronization is not instantaneous — a node created by one request may
 * not be visible to the next one yet. Replaying the load balancer's session
 * cookies (e.g. SERVERID, slb_route) keeps all requests of a run on the same
 * server. See also `retry` for the complementary belt-and-braces mechanism.
 */
export const createStickyFetch = (baseFetch: typeof fetch = fetch): typeof fetch => {
  const cookies = new Map<string, string>();

  return async (input, init) => {
    // Merge headers from a Request input and from init (init wins), so
    // neither source is lost when adding the cookie header
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));

    if (cookies.size > 0) {
      const jar = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      const existing = headers.get('cookie');
      headers.set('cookie', existing ? `${existing}; ${jar}` : jar);
    }

    const response = await baseFetch(input, { ...init, headers });

    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) {
        cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    }

    return response;
  };
};
