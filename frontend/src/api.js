/**
 * Thin fetch wrapper used throughout the app.
 * Sends JSON, attaches a Bearer token when provided, and throws on non-2xx
 * responses using the server's `error` field as the message.
 */
export async function apiFetch(path, { token, ...opts } = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}
