import { useEffect, useState } from 'react';

/**
 * Opens an SSE connection to the notifications stream for the logged-in user.
 * Returns a list of pending notifications and a function to dismiss one.
 *
 * Each notification: { id, type, invite_token, from_name, from_id, time_control }
 */
export function useNotifications(token) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!token) return;

    const url = `/api/social/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('challenge', (e) => {
      const data = JSON.parse(e.data);
      setNotifications((prev) => [
        ...prev,
        { id: data.invite_token, ...data },
      ]);
    });

    es.onerror = () => {}; // silently ignore disconnects — browser auto-reconnects

    return () => es.close();
  }, [token]);

  function dismiss(id) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  return { notifications, dismiss };
}
