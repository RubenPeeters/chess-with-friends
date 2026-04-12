import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api.js';

const TIME_CONTROLS = [
  { value: '1+0',   label: 'Bullet — 1 min' },
  { value: '3+0',   label: 'Blitz — 3 min' },
  { value: '3+2',   label: 'Blitz — 3+2' },
  { value: '5+0',   label: 'Blitz — 5 min' },
  { value: '10+0',  label: 'Rapid — 10 min' },
  { value: '15+10', label: 'Rapid — 15+10' },
  { value: '30+0',  label: 'Classical — 30 min' },
];

export function FriendsPanel({ token, onChallengeAccepted }) {
  const [friends, setFriends]         = useState([]);
  const [pending, setPending]         = useState([]);
  const [searchQ, setSearchQ]         = useState('');
  const [results, setResults]         = useState([]);
  const [searching, setSearching]     = useState(false);
  const [searchErr, setSearchErr]     = useState('');
  const [actionMsg, setActionMsg]     = useState('');
  const [loading, setLoading]         = useState(true);
  const [challenge, setChallenge]     = useState(null); // { friendId, friendName, timeControl, invite }
  const [challenging, setChallenging] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [f, p] = await Promise.all([
        apiFetch('/api/social/friends', { token }),
        apiFetch('/api/social/friends/pending', { token }),
      ]);
      setFriends(f);
      setPending(p);
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  // SSE — watch for challenge acceptance
  useEffect(() => {
    if (!challenge?.invite || !token) return;
    const url = `/api/social/invites/${challenge.invite.token}/watch?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    es.addEventListener('accepted', (e) => {
      es.close();
      setChallenge(null);
      onChallengeAccepted?.(JSON.parse(e.data));
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [challenge?.invite?.token, token, onChallengeAccepted]);

  async function sendChallenge() {
    if (!challenge) return;
    setChallenging(true);
    try {
      const invite = await apiFetch('/api/social/invites', {
        method: 'POST', token,
        body: JSON.stringify({ time_control: challenge.timeControl, colour: 'random', addressee_id: challenge.friendId }),
      });
      setChallenge((prev) => ({ ...prev, invite }));
    } catch (err) {
      flash(err.message);
      setChallenge(null);
    } finally { setChallenging(false); }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (searchQ.trim().length < 2) return;
    setSearching(true); setSearchErr(''); setResults([]);
    try {
      setResults(await apiFetch(`/api/social/friends/search?q=${encodeURIComponent(searchQ.trim())}`, { token }));
    } catch (err) { setSearchErr(err.message); }
    finally { setSearching(false); }
  }

  async function sendRequest(addresseeId, name) {
    try {
      await apiFetch('/api/social/friends/request', { method: 'POST', token, body: JSON.stringify({ addressee_id: addresseeId }) });
      flash(`Request sent to ${name}!`);
      setResults((prev) => prev.filter((u) => u.id !== addresseeId));
    } catch (err) { flash(err.message); }
  }

  async function respondRequest(requesterId, action) {
    try {
      await apiFetch(`/api/social/friends/request/${requesterId}`, { method: 'PATCH', token, body: JSON.stringify({ action }) });
      flash(action === 'accept' ? 'Friend added!' : 'Request declined');
      refresh();
    } catch (err) { flash(err.message); }
  }

  async function removeFriend(userId, name) {
    if (!confirm(`Remove ${name} from friends?`)) return;
    try {
      await apiFetch(`/api/social/friends/${userId}`, { method: 'DELETE', token });
      flash(`${name} removed`);
      setFriends((prev) => prev.filter((f) => f.id !== userId));
    } catch (err) { flash(err.message); }
  }

  function flash(msg) {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(''), 3500);
  }

  if (loading) return (
    <div className="flex flex-col gap-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-[60px] rounded-md bg-surface-high animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">

      {/* Toast */}
      {actionMsg && (
        <div className="font-mono text-[0.8rem] bg-success-bg text-success rounded-md px-4 py-2.5 flex items-center gap-2">
          <span>✓</span> {actionMsg}
        </div>
      )}

      {/* Challenge card */}
      {challenge && (
        <div className="flex flex-col gap-3 bg-surface-lowest rounded-md p-5 border border-primary/20 shadow-[0_2px_12px_rgba(0,90,183,0.08)]">
          {challenge.invite ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="font-display font-bold text-base text-on-surface">
                  Waiting for {challenge.friendName}…
                </span>
              </div>
              <span className="font-mono text-xs text-muted">{challenge.timeControl} · Challenge sent</span>
              <button onClick={() => setChallenge(null)} className="btn-secondary self-start text-sm">
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="font-display font-bold text-base text-on-surface">
                Challenge {challenge.friendName}
              </span>
              <select
                className="text-input"
                value={challenge.timeControl}
                onChange={(e) => setChallenge((p) => ({ ...p, timeControl: e.target.value }))}
              >
                {TIME_CONTROLS.map((tc) => <option key={tc.value} value={tc.value}>{tc.label}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={sendChallenge} disabled={challenging} className="btn-primary text-sm py-2.5 px-5">
                  {challenging ? 'Sending…' : 'Send challenge'}
                </button>
                <button onClick={() => setChallenge(null)} className="btn-secondary text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle>Pending requests ({pending.length})</SectionTitle>
          {pending.map((u) => (
            <UserRow key={u.id} name={u.display_name} rating={u.rating}>
              <button onClick={() => respondRequest(u.id, 'accept')} className="btn-primary text-xs py-2 px-3.5">Accept</button>
              <button onClick={() => respondRequest(u.id, 'reject')} className="btn-secondary text-xs">Decline</button>
            </UserRow>
          ))}
        </section>
      )}

      {/* Friends list */}
      <section className="flex flex-col gap-2">
        <SectionTitle>
          {friends.length === 0 ? 'No friends yet' : `Friends · ${friends.length}`}
        </SectionTitle>
        {friends.length === 0 ? (
          <p className="font-body text-sm text-muted py-2">
            Search for players below and send them a friend request.
          </p>
        ) : friends.map((f) => (
          <UserRow key={f.id} name={f.display_name} rating={f.rating}>
            <button
              onClick={() => setChallenge({ friendId: f.id, friendName: f.display_name, timeControl: '10+0', invite: null })}
              className="btn-primary text-xs py-2 px-3.5"
            >
              Challenge
            </button>
            <button
              onClick={() => removeFriend(f.id, f.display_name)}
              className="font-body text-xs font-medium text-muted underline underline-offset-[2px] bg-transparent border-0 cursor-pointer hover:text-danger transition-colors"
            >
              Remove
            </button>
          </UserRow>
        ))}
      </section>

      {/* Search */}
      <section className="flex flex-col gap-2.5">
        <SectionTitle>Add a friend</SectionTitle>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            className="text-input"
            placeholder="Search by name or email…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <button type="submit" disabled={searching} className="btn-primary text-sm py-2.5 px-5 whitespace-nowrap">
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {searchErr && (
          <p className="font-mono text-[0.8rem] text-danger bg-danger-bg rounded-md px-3 py-2">{searchErr}</p>
        )}

        {results.map((u) => (
          <UserRow key={u.id} name={u.display_name} sub={u.email}>
            <button onClick={() => sendRequest(u.id, u.display_name)} className="btn-primary text-xs py-2 px-3.5">
              Add friend
            </button>
          </UserRow>
        ))}

        {results.length === 0 && searchQ.length >= 2 && !searching && !searchErr && (
          <p className="font-body text-sm text-muted italic">No users found for "{searchQ}".</p>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 className="font-mono text-[0.68rem] font-semibold text-muted uppercase tracking-[0.08em]">
      {children}
    </h3>
  );
}

function UserRow({ name, rating, sub, children }) {
  const initial = (name ?? '?')[0].toUpperCase();
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-md bg-surface-lowest border border-surface-high shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      {/* Mini avatar + info */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-full bg-primary-gradient text-on-primary font-display font-bold text-sm flex items-center justify-center flex-shrink-0">
          {initial}
        </div>
        <div className="flex flex-col gap-0 min-w-0">
          <span className="font-body text-[0.9375rem] font-semibold text-on-surface truncate leading-tight">{name}</span>
          {rating != null && (
            <span className="font-mono text-[0.68rem] text-primary font-semibold">{Math.round(Number(rating))}</span>
          )}
          {sub && <span className="font-mono text-[0.68rem] text-muted truncate">{sub}</span>}
        </div>
      </div>
      <div className="flex gap-1.5 items-center flex-shrink-0">{children}</div>
    </div>
  );
}
