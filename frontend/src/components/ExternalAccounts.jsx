import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

const PLATFORMS = [
  { value: 'lichess', label: 'Lichess', icon: '♞' },
  { value: 'chesscom', label: 'Chess.com', icon: '♚' },
];

export function ExternalAccounts({ token, onSelectAccount }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [platform, setPlatform] = useState('lichess');
  const [username, setUsername] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking]     = useState(false);
  const [syncing, setSyncing]     = useState(null); // account id being synced
  const [syncResult, setSyncResult] = useState(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const rows = await apiFetch('/api/social/external/accounts', { token });
      setAccounts(rows);
    } catch (e) {
      console.error('[external] fetch accounts:', e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleLink(e) {
    e.preventDefault();
    if (!username.trim()) return;
    setLinking(true); setLinkError('');
    try {
      await apiFetch('/api/social/external/link', {
        token,
        method: 'POST',
        body: JSON.stringify({ platform, username: username.trim() }),
      });
      setUsername('');
      await fetchAccounts();
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinking(false);
    }
  }

  async function handleSync(accountId) {
    setSyncing(accountId); setSyncResult(null);
    try {
      const result = await apiFetch(`/api/social/external/accounts/${accountId}/sync`, {
        token,
        method: 'POST',
      });
      setSyncResult({ id: accountId, ...result });
      await fetchAccounts(); // refresh last_synced_at
    } catch (err) {
      setSyncResult({ id: accountId, error: err.message });
    } finally {
      setSyncing(null);
    }
  }

  async function handleUnlink(accountId) {
    try {
      await apiFetch(`/api/social/external/accounts/${accountId}`, {
        token,
        method: 'DELETE',
      });
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
      if (syncResult?.id === accountId) setSyncResult(null);
    } catch (err) {
      console.error('[external] unlink error:', err.message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Link form */}
      <div className="bg-white rounded-md border border-black/[0.04] p-6">
        <h3 className="font-display font-bold text-base text-on-surface mb-4">Link an account</h3>
        <form onSubmit={handleLink} className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.07em]">Platform</span>
            <select
              className="px-3 py-2.5 bg-[#f1f2f4] rounded-md border-0 outline-none font-body text-sm text-on-surface cursor-pointer"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <span className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.07em]">Username</span>
            <input
              className="px-4 py-2.5 bg-[#f1f2f4] rounded-md border-0 outline-none focus:ring-2 focus:ring-primary/30 font-mono text-xs text-on-surface placeholder:text-muted/50 transition-all"
              placeholder="e.g. DrNykterstein"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setLinkError(''); }}
              required
            />
          </div>
          <button
            type="submit"
            disabled={linking || !username.trim()}
            className="py-2.5 px-5 bg-primary text-on-primary rounded-md font-display font-bold text-sm border-0 cursor-pointer hover:opacity-90 transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {linking ? 'Linking…' : 'Link'}
          </button>
        </form>
        {linkError && (
          <p className="font-mono text-xs text-danger bg-danger-bg rounded-md px-4 py-2 mt-3">{linkError}</p>
        )}
      </div>

      {/* Account list */}
      {loading ? (
        <p className="font-body text-sm text-muted text-center py-8">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="font-body text-sm text-muted text-center py-8">No linked accounts yet. Link one above to get started.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((acct) => {
            const platformInfo = PLATFORMS.find((p) => p.value === acct.platform);
            const isSyncing = syncing === acct.id;
            const result = syncResult?.id === acct.id ? syncResult : null;
            return (
              <div key={acct.id} className="bg-white rounded-md border border-black/[0.04] p-5 flex items-center gap-4">
                <span className="text-2xl">{platformInfo?.icon ?? '?'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-sm text-on-surface">{acct.username}</p>
                  <p className="font-mono text-[0.6rem] text-muted">
                    {platformInfo?.label ?? acct.platform}
                    {acct.last_synced_at && ` · synced ${new Date(acct.last_synced_at).toLocaleDateString()}`}
                  </p>
                  {result && !result.error && (
                    <p className="font-mono text-[0.6rem] text-success mt-1">
                      Imported {result.imported}, skipped {result.skipped}
                    </p>
                  )}
                  {result?.error && (
                    <p className="font-mono text-[0.6rem] text-danger mt-1">{result.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSync(acct.id)}
                    disabled={isSyncing}
                    className="py-2 px-4 bg-surface-high text-on-surface rounded-md font-body font-semibold text-xs border-0 cursor-pointer hover:bg-surface-highest transition-all disabled:opacity-50"
                  >
                    {isSyncing ? 'Syncing…' : 'Sync'}
                  </button>
                  <button
                    onClick={() => onSelectAccount(acct)}
                    className="py-2 px-4 bg-primary text-on-primary rounded-md font-body font-semibold text-xs border-0 cursor-pointer hover:opacity-90 transition-all"
                  >
                    Games
                  </button>
                  <button
                    onClick={() => handleUnlink(acct.id)}
                    className="py-2 px-4 bg-transparent text-danger rounded-md font-body font-semibold text-xs border border-danger/20 cursor-pointer hover:bg-danger-bg transition-all"
                  >
                    Unlink
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
