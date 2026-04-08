import { useState, useEffect } from 'react';
import { Board } from './components/Board.jsx';
import { Clock } from './components/Clock.jsx';
import { ProfilePanel } from './components/ProfilePanel.jsx';
import { HistoryPanel } from './components/HistoryPanel.jsx';
import { FriendsPanel } from './components/FriendsPanel.jsx';
import { GameReview } from './components/GameReview.jsx';
import { PlayerProfile } from './components/PlayerProfile.jsx';
import { Leaderboard } from './components/Leaderboard.jsx';
import { useGameSocket } from './hooks/useGameSocket.js';
import { useNotifications } from './hooks/useNotifications.js';
import { apiFetch } from './api.js';
import { parsePgn } from './utils/pgn.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJwt(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

function getInviteTokenFromUrl() {
  const match = window.location.pathname.match(/^\/play\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

// ── Time-control helpers ──────────────────────────────────────────────────────

const TC_CARDS = [
  { key: 'bullet',    icon: '⚡', label: 'Bullet',    tc: '1+0',  sub: '1 min' },
  { key: 'blitz',     icon: '🔥', label: 'Blitz',     tc: '5+0',  sub: '5 min' },
  { key: 'rapid',     icon: '⏱', label: 'Rapid',     tc: '10+0', sub: '10 min' },
  { key: 'classical', icon: '♞', label: 'Classical', tc: '30+0', sub: '30 min' },
];

function tcCategory(tc) {
  const base = parseInt((tc ?? '10+0').split('+')[0], 10);
  if (base < 3)  return 'bullet';
  if (base < 10) return 'blitz';
  if (base < 30) return 'rapid';
  return 'classical';
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken]               = useState(() => localStorage.getItem('ff_token'));
  const [gameId, setGameId]             = useState(null);
  const [playerColour, setPlayerColour] = useState('white');

  const [authMode, setAuthMode]         = useState('login');
  const [authForm, setAuthForm]         = useState({ email: '', password: '', displayName: '' });
  const [authError, setAuthError]       = useState('');
  const [authLoading, setAuthLoading]   = useState(false);

  const [pendingInviteToken] = useState(() => getInviteTokenFromUrl());

  const [lobbyTab, setLobbyTab]             = useState('play');
  const [lobbyError, setLobbyError]         = useState('');
  const [createdInvite, setCreatedInvite]   = useState(null);
  const [joinInput, setJoinInput]           = useState(() => getInviteTokenFromUrl() ?? '');
  const [timeControl, setTimeControl]       = useState('10+0');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [joiningGame, setJoiningGame]       = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [drawOfferDismissed, setDrawOfferDismissed] = useState(null);
  const [viewingGameId, setViewingGameId]           = useState(null);
  const [viewingPlayerId, setViewingPlayerId]       = useState(null);
  const [pgnInput, setPgnInput]                     = useState('');
  const [pgnError, setPgnError]                     = useState('');
  // Holds the *parsed* PGN result, not the raw text. Truthy = the PGN review
  // surface is active. parsePgn runs exactly once (in handleAnalyzePgn) so
  // GameReview never has to re-parse the same input. Raw textarea content
  // lives in `pgnInput` for back-to-edit preservation.
  const [pgnReviewData, setPgnReviewData]           = useState(null);

  const { gameState, sendMove, sendResign, sendDrawOffer, sendDrawAccept, connected } =
    useGameSocket(gameId, token);
  const { notifications, dismiss } = useNotifications(token);

  const jwtPayload = token ? parseJwt(token) : null;
  const user = jwtPayload
    ? { id: jwtPayload.sub, email: jwtPayload.email, display_name: jwtPayload.display_name ?? jwtPayload.email?.split('@')[0] }
    : null;

  const { drawOffer: latestDrawOffer } = gameState;
  useEffect(() => {
    if (latestDrawOffer && latestDrawOffer !== drawOfferDismissed) setDrawOfferDismissed(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDrawOffer]);

  useEffect(() => {
    if (token && pendingInviteToken && !gameId) {
      acceptInvite(pendingInviteToken).catch(() => window.history.replaceState(null, '', '/'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError(''); setAuthLoading(true);
    try {
      const body = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : { email: authForm.email, password: authForm.password, display_name: authForm.displayName };
      const data = await apiFetch(
        authMode === 'login' ? '/api/auth/login' : '/api/auth/register',
        { method: 'POST', body: JSON.stringify(body) }
      );
      localStorage.setItem('ff_token', data.token);
      setToken(data.token);
      if (pendingInviteToken) await acceptInvite(pendingInviteToken, data.token);
    } catch (err) {
      setAuthError(err.message);
    } finally { setAuthLoading(false); }
  }

  async function acceptInvite(inviteToken, jwt = token) {
    const data   = await apiFetch(`/api/social/invites/${inviteToken}/accept`, { method: 'POST', token: jwt });
    const userId = parseJwt(jwt)?.sub;
    window.history.replaceState(null, '', '/');
    setPlayerColour(data.white_id === userId ? 'white' : 'black');
    setGameId(data.game_id);
    setCreatedInvite(null);
  }

  function handleLogout() {
    localStorage.removeItem('ff_token');
    setToken(null); setGameId(null); setCreatedInvite(null);
    setJoinInput(''); setAuthForm({ email: '', password: '', displayName: '' });
    setAuthMode('login'); setLobbyTab('play');
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  async function handleCreateInvite() {
    setLobbyError(''); setCreatingInvite(true);
    try {
      setCreatedInvite(await apiFetch('/api/social/invites', {
        method: 'POST', token,
        body: JSON.stringify({ time_control: timeControl, colour: 'random' }),
      }));
    } catch (err) { setLobbyError(err.message); }
    finally { setCreatingInvite(false); }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setLobbyError(''); setJoiningGame(true);
    const input  = joinInput.trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    try {
      if (!uuidRe.test(input)) throw new Error('Enter a valid invite token or game ID (UUID format)');
      try { await acceptInvite(input); }
      catch (inviteErr) {
        if (!inviteErr.message.includes('not found') && !inviteErr.message.includes('already used')) throw inviteErr;
        setPlayerColour('white'); setGameId(input); setCreatedInvite(null);
      }
    } catch (err) { setLobbyError(err.message); }
    finally { setJoiningGame(false); }
  }

  useEffect(() => {
    if (!createdInvite || !token) return;
    const url = `/api/social/invites/${createdInvite.token}/watch?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    es.addEventListener('accepted', (e) => {
      const { game_id, white_id } = JSON.parse(e.data);
      setPlayerColour(white_id === parseJwt(token)?.sub ? 'white' : 'black');
      setGameId(game_id); setCreatedInvite(null); es.close();
    });
    es.onerror = () => es.close();
    return () => es.close();
  }, [createdInvite?.token, token]);

  function handleCopyLink() {
    if (!createdInvite) return;
    const link = `${location.origin}/play/${createdInvite.token}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    } else {
      const el = Object.assign(document.createElement('textarea'), { value: link });
      Object.assign(el.style, { position: 'fixed', opacity: '0' });
      document.body.appendChild(el); el.focus(); el.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      catch { window.prompt('Copy this link:', link); }
      finally { document.body.removeChild(el); }
    }
  }

  // Parse the pasted PGN exactly once. On success, store the parsed result
  // and navigate to the review screen — GameReview consumes the parsed object
  // directly, so it never has to re-parse. On failure, surface the error
  // inline on the input form (better UX than bouncing into a failed review).
  function handleAnalyzePgn() {
    setPgnError('');
    try {
      const parsed = parsePgn(pgnInput);
      setPgnReviewData(parsed);
    } catch (err) {
      setPgnError(err.message);
    }
  }

  // Single back-button handler — clears whichever review surface is active.
  function handleCloseReview() {
    setViewingGameId(null);
    setPgnReviewData(null);
  }

  async function acceptChallenge(notif) {
    dismiss(notif.id);
    try { await acceptInvite(notif.invite_token); }
    catch (err) { console.warn('Failed to accept challenge:', err.message); }
  }

  // ── Notification toasts ───────────────────────────────────────────────────

  const challengeBanner = notifications.length > 0 && (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[200] max-w-sm w-full">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-center gap-3 bg-white rounded-md px-4 py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-surface-high">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-display font-bold text-sm text-on-surface">{n.from_name} challenged you!</span>
            <span className="font-mono text-[0.7rem] text-muted">{n.time_control} · Accept to start</span>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => acceptChallenge(n)} className="btn-primary text-xs py-2 px-3">Accept</button>
            <button onClick={() => dismiss(n.id)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface-high text-muted border-0 cursor-pointer hover:bg-surface-highest transition-colors text-xs">✕</button>
          </div>
        </div>
      ))}
    </div>
  );

  // ── Auth screen ───────────────────────────────────────────────────────────

  if (!token) {
    const isRegister = authMode === 'register';
    return (
      <div className="min-h-screen bg-white flex overflow-hidden">

        {/* Left — hero panel */}
        <div className="hidden lg:flex lg:w-[58%] shrink-0 relative overflow-hidden bg-[#0b1120]">
          {/* Chessboard grid texture */}
          <div className="absolute inset-0 grid grid-cols-8 opacity-[0.07] pointer-events-none" style={{ gridTemplateRows: 'repeat(8,1fr)' }}>
            {Array.from({ length: 64 }).map((_, i) => (
              <div key={i} className={(Math.floor(i / 8) + i) % 2 === 0 ? 'bg-white' : ''} />
            ))}
          </div>
          {/* Gradient vignette */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-transparent to-black/60 pointer-events-none" />
          {/* Decorative large piece */}
          <div className="absolute -bottom-8 -right-8 text-[22rem] leading-none select-none text-white/[0.04] pointer-events-none">♛</div>

          {/* Content */}
          <div className="relative z-10 flex flex-col justify-between p-16 h-full w-full">
            <span className="font-display font-extrabold text-lg tracking-[-0.02em] text-white/80">FF</span>

            <div className="max-w-lg">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-md px-4 py-1.5 mb-8">
                <span className="text-white/60 font-mono text-[0.65rem] uppercase tracking-[0.1em]">Glicko-2 Rated</span>
                <span className="w-1 h-1 rounded-full bg-white/30" />
                <span className="text-white/60 font-mono text-[0.65rem] uppercase tracking-[0.1em]">Live Games</span>
              </div>
              <h1 className="font-display text-[3.75rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white mb-6">
                Precision in<br />Every Move.
              </h1>
              <p className="font-body text-lg text-white/60 leading-relaxed max-w-sm">
                Play with friends, track per-format ratings, and review every game move by move.
              </p>
            </div>

            <p className="font-mono text-[0.6rem] text-white/20 tracking-widest uppercase">© 2026 Fianchetto Friends</p>
          </div>
        </div>

        {/* Right — form panel */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 md:px-16 py-12 bg-white">
          <div className="w-full max-w-[360px]">

            {/* Mobile logo */}
            <div className="lg:hidden mb-10 flex items-center gap-2">
              <span className="text-2xl select-none">♟</span>
              <span className="font-display font-extrabold text-xl tracking-[-0.02em] text-on-surface">Fianchetto Friends</span>
            </div>

            {/* Heading */}
            <h2 className="font-display font-extrabold text-[1.9rem] text-on-surface mb-1 tracking-[-0.025em]">
              {isRegister ? 'Create account' : 'Welcome back'}
            </h2>
            <p className="font-body text-sm text-muted mb-10">
              {isRegister ? 'Start playing in seconds.' : 'Sign in to resume your games.'}
            </p>

            {/* Form */}
            <form onSubmit={handleAuth} className="flex flex-col gap-5">
              {isRegister && (
                <div className="flex flex-col gap-1.5">
                  <label className="font-body text-xs font-semibold text-muted uppercase tracking-[0.07em]">Display name</label>
                  <input
                    className="w-full px-5 py-3.5 bg-surface rounded-md border border-surface-high outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-body text-sm text-on-surface placeholder:text-muted/50 transition-all"
                    placeholder="Magnus"
                    value={authForm.displayName}
                    onChange={(e) => setAuthForm((f) => ({ ...f, displayName: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="font-body text-xs font-semibold text-muted uppercase tracking-[0.07em]">Email address</label>
                <input
                  className="w-full px-5 py-3.5 bg-surface rounded-md border border-surface-high outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-body text-sm text-on-surface placeholder:text-muted/50 transition-all"
                  type="email"
                  placeholder="you@example.com"
                  value={authForm.email}
                  onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-body text-xs font-semibold text-muted uppercase tracking-[0.07em]">Password</label>
                <input
                  className="w-full px-5 py-3.5 bg-surface rounded-md border border-surface-high outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-body text-sm text-on-surface transition-all"
                  type="password"
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  minLength={8}
                />
              </div>

              {authError && (
                <p className="font-mono text-xs text-danger bg-danger-bg rounded-md px-4 py-2.5">{authError}</p>
              )}

              <button
                className="w-full py-3.5 bg-primary text-on-primary rounded-md font-display font-bold text-sm tracking-[-0.01em] shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all mt-1 border-0 cursor-pointer disabled:opacity-50"
                type="submit"
                disabled={authLoading}
              >
                {authLoading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in to Fianchetto'}
              </button>
            </form>

            {/* Mode switch */}
            <p className="mt-8 text-center font-body text-sm text-muted">
              {isRegister ? 'Already have an account?' : 'New here?'}{' '}
              <button
                onClick={() => { setAuthMode(isRegister ? 'login' : 'register'); setAuthError(''); }}
                className="text-primary font-semibold bg-transparent border-0 cursor-pointer hover:underline underline-offset-4 decoration-2"
              >
                {isRegister ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </div>

          {/* Bottom meta */}
          <p className="absolute bottom-6 font-mono text-[0.6rem] text-muted/40 tracking-wider uppercase">
            © 2026 Fianchetto Friends
          </p>
        </div>
      </div>
    );
  }

  // ── Lobby screen ──────────────────────────────────────────────────────────

  if (!gameId) {
    const NAV_ITEMS = [
      { key: 'play',        icon: '♟', label: 'Play' },
      { key: 'history',     icon: '◈', label: 'History' },
      { key: 'analyze',     icon: '🔍', label: 'Analyze' },
      { key: 'friends',     icon: '◎', label: 'Friends' },
      { key: 'leaderboard', icon: '🏆', label: 'Leaderboard' },
    ];

    return (
      <div className="min-h-screen bg-[#f1f2f4] flex">

        {/* ── Sidebar ── */}
        <aside className="w-64 fixed left-0 top-0 h-screen flex flex-col bg-[#f8f9fb] border-r border-black/[0.06] z-40">
          {/* Brand + user */}
          <div className="px-5 pt-7 pb-5">
            <div className="flex items-center gap-2 mb-7">
              <span className="text-xl select-none">♟</span>
              <span className="font-display font-extrabold text-sm tracking-[-0.01em] text-on-surface">Fianchetto Friends</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary font-display font-extrabold text-base flex-shrink-0 shadow-lg shadow-primary/30">
                {(user?.display_name ?? '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-display font-bold text-sm text-on-surface truncate">{user?.display_name}</p>
                <p className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.07em]">Player</p>
              </div>
            </div>
          </div>

          <div className="h-px bg-black/[0.06] mx-5" />

          {/* Nav */}
          <nav className="flex flex-col gap-0.5 px-3 pt-3 flex-1">
            {NAV_ITEMS.map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => setLobbyTab(key)}
                className={[
                  'flex items-center gap-3 py-3 px-3 rounded-md text-left w-full transition-all duration-150 border-0 cursor-pointer',
                  lobbyTab === key
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'bg-transparent text-muted hover:bg-black/[0.05] hover:text-on-surface',
                ].join(' ')}
              >
                <span className="w-5 text-center text-base leading-none flex-shrink-0">{icon}</span>
                <span className="font-body text-xs font-semibold uppercase tracking-[0.07em]">{label}</span>
              </button>
            ))}
          </nav>

          {/* Sign out */}
          <div className="px-3 pb-6 pt-3 border-t border-black/[0.06]">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 py-3 px-3 rounded-md text-left w-full transition-all border-0 cursor-pointer text-muted hover:bg-black/[0.05] hover:text-danger"
            >
              <span className="w-5 text-center text-sm leading-none flex-shrink-0">↩</span>
              <span className="font-body text-xs font-semibold uppercase tracking-[0.07em]">Sign out</span>
            </button>
          </div>
        </aside>

        {/* ── Main area ── */}
        <div className="ml-64 flex-1 flex flex-col min-h-screen">

          {/* Top header */}
          <header className="sticky top-0 z-30 bg-[#f1f2f4]/80 backdrop-blur-xl border-b border-black/[0.06] px-10 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {(viewingGameId || pgnReviewData) && (
                <button
                  onClick={handleCloseReview}
                  className="font-body text-sm text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  ← Back
                </button>
              )}
              <h1 className="font-display font-extrabold text-xl tracking-[-0.025em] text-on-surface">
                {viewingGameId                 ? 'Game Analysis'
                  : pgnReviewData               ? 'PGN Analysis'
                  : lobbyTab === 'play'         ? <>Welcome back, <span className="text-primary">{user?.display_name?.split(' ')[0]}</span>.</>
                  : lobbyTab === 'history'      ? 'Match History'
                  : lobbyTab === 'analyze'      ? 'Analyze a game'
                  : lobbyTab === 'friends'      ? 'Friends'
                  : lobbyTab === 'leaderboard'  ? 'Leaderboard'
                  : null}
              </h1>
            </div>
            {!viewingGameId && !pgnReviewData && (
              <button
                onClick={handleCreateInvite}
                disabled={creatingInvite}
                className="flex items-center gap-1.5 bg-primary text-on-primary rounded-md px-5 py-2.5 font-display font-bold text-sm border-0 cursor-pointer hover:opacity-90 active:scale-[0.97] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                <span className="text-lg leading-none">+</span> New Game
              </button>
            )}
          </header>

          {/* Content */}
          <main className="flex-1 px-10 py-8 overflow-y-auto">

            {/* ── Game analysis page (existing /history/:id flow) ── */}
            {viewingGameId && (
              <GameReview
                gameId={viewingGameId}
                token={token}
                onClose={handleCloseReview}
                inline
              />
            )}

            {/* ── PGN analysis page (new "paste any PGN" flow) ── */}
            {!viewingGameId && pgnReviewData && (
              <GameReview
                data={pgnReviewData}
                token={token}
                onClose={handleCloseReview}
                inline
              />
            )}

            {/* ── Leaderboard page ── */}
            {!viewingGameId && !pgnReviewData && lobbyTab === 'leaderboard' && (
              <Leaderboard
                token={token}
                onClose={() => setLobbyTab('play')}
                onViewProfile={setViewingPlayerId}
                inline
              />
            )}

            {/* ── Play tab ── */}
            {!viewingGameId && !pgnReviewData && lobbyTab === 'play' && (
              <div className="max-w-[1100px] mx-auto grid grid-cols-12 gap-6">

                {/* Match card */}
                <section className="col-span-12 lg:col-span-7 bg-white rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.05)] border border-black/[0.04] p-8">
                  <p className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.1em] mb-1">
                    {createdInvite ? 'Share with your opponent' : 'Start a game'}
                  </p>
                  <h2 className="font-display font-extrabold text-2xl text-on-surface tracking-[-0.02em] mb-6">
                    {createdInvite ? 'Invite link ready' : 'Choose time control'}
                  </h2>

                  {createdInvite ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3 p-4 bg-[#f1f2f4] rounded-md">
                        <span className="font-mono text-xs text-on-surface flex-1 break-all leading-relaxed">
                          {`${location.origin}/play/${createdInvite.token}`}
                        </span>
                        <button
                          onClick={handleCopyLink}
                          className={[
                            'font-mono text-xs font-bold px-4 py-2 rounded-md border-0 cursor-pointer whitespace-nowrap transition-all flex-shrink-0',
                            copied ? 'bg-success-bg text-success' : 'bg-primary text-on-primary hover:opacity-80',
                          ].join(' ')}
                        >{copied ? '✓ Copied' : 'Copy link'}</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse flex-shrink-0" />
                        <span className="font-mono text-[0.68rem] text-muted">Waiting for opponent to join…</span>
                      </div>
                      <button onClick={() => setCreatedInvite(null)} className="font-body text-sm text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer self-start transition-colors">
                        ← New invite
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Time control cards */}
                      <div className="grid grid-cols-4 gap-3 mb-5">
                        {TC_CARDS.map(({ key, icon, label, tc, sub }) => {
                          const active = tcCategory(timeControl) === key;
                          return (
                            <button
                              key={key}
                              onClick={() => setTimeControl(tc)}
                              className={[
                                'flex flex-col gap-2.5 p-4 rounded-lg text-left border-2 transition-all duration-150 cursor-pointer',
                                active
                                  ? 'bg-primary border-primary text-on-primary shadow-md shadow-primary/20'
                                  : 'bg-[#f1f2f4] border-transparent hover:border-primary/25 hover:bg-white',
                              ].join(' ')}
                            >
                              <span className="text-xl leading-none">{icon}</span>
                              <div>
                                <p className={`font-display font-bold text-sm ${active ? 'text-on-primary' : 'text-on-surface'}`}>{label}</p>
                                <p className={`font-mono text-[0.62rem] mt-0.5 ${active ? 'text-on-primary/70' : 'text-muted'}`}>{sub}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Custom TC */}
                      <div className="flex items-center gap-3 mb-5 p-3 bg-[#f1f2f4] rounded-md">
                        <span className="font-mono text-[0.62rem] text-muted uppercase tracking-[0.07em] whitespace-nowrap">Custom:</span>
                        <select
                          className="flex-1 bg-transparent border-0 outline-none font-body text-sm text-on-surface cursor-pointer"
                          value={timeControl}
                          onChange={(e) => setTimeControl(e.target.value)}
                        >
                          <option value="1+0">Bullet — 1 min</option>
                          <option value="3+0">Blitz — 3 min</option>
                          <option value="3+2">Blitz — 3 min + 2 sec</option>
                          <option value="5+0">Blitz — 5 min</option>
                          <option value="10+0">Rapid — 10 min</option>
                          <option value="15+10">Rapid — 15 min + 10 sec</option>
                          <option value="30+0">Classical — 30 min</option>
                        </select>
                      </div>

                      {lobbyError && (
                        <p className="font-mono text-xs text-danger bg-danger-bg rounded-md px-4 py-2.5 mb-4">{lobbyError}</p>
                      )}

                      <button
                        className="w-full py-3.5 bg-primary text-on-primary rounded-md font-display font-bold text-sm border-0 cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                        onClick={handleCreateInvite}
                        disabled={creatingInvite}
                      >
                        {creatingInvite ? 'Creating…' : 'Create invite link'}
                      </button>
                    </>
                  )}
                </section>

                {/* Profile ratings card */}
                <section className="col-span-12 lg:col-span-5 bg-white rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.05)] border border-black/[0.04] overflow-hidden">
                  <ProfilePanel token={token} user={user} />
                </section>

                {/* Join game strip */}
                <section className="col-span-12 bg-white rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.05)] border border-black/[0.04] px-8 py-6">
                  <h2 className="font-display font-bold text-base text-on-surface mb-4">Join a game</h2>
                  <form onSubmit={handleJoin} className="flex items-end gap-3">
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.07em]">Invite token or game ID</label>
                      <input
                        className="px-4 py-3 bg-[#f1f2f4] rounded-md border-0 outline-none focus:ring-2 focus:ring-primary/30 font-mono text-xs text-on-surface placeholder:text-muted/50 transition-all"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={joinInput}
                        onChange={(e) => setJoinInput(e.target.value)}
                        required
                      />
                    </div>
                    <button
                      className="py-3 px-6 bg-on-surface text-white rounded-md font-display font-bold text-sm border-0 cursor-pointer hover:opacity-80 transition-all whitespace-nowrap disabled:opacity-50 flex-shrink-0"
                      type="submit"
                      disabled={joiningGame}
                    >
                      {joiningGame ? 'Joining…' : 'Join game →'}
                    </button>
                  </form>
                  {lobbyError && (
                    <p className="font-mono text-xs text-danger mt-3">{lobbyError}</p>
                  )}
                </section>
              </div>
            )}

            {/* ── History tab ── */}
            {!viewingGameId && !pgnReviewData && lobbyTab === 'history' && (
              <div className="max-w-2xl mx-auto">
                <HistoryPanel
                  token={token}
                  userId={user?.id}
                  onViewGame={setViewingGameId}
                  onViewProfile={setViewingPlayerId}
                />
              </div>
            )}

            {/* ── Analyze tab — paste a PGN ── */}
            {!viewingGameId && !pgnReviewData && lobbyTab === 'analyze' && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.05)] border border-black/[0.04] p-8">
                  <p className="font-mono text-[0.6rem] text-muted uppercase tracking-[0.1em] mb-1">
                    Paste a PGN
                  </p>
                  <h2 id="analyze-heading" className="font-display font-extrabold text-2xl text-on-surface tracking-[-0.02em] mb-2">
                    Analyze any game
                  </h2>
                  <p className="font-body text-sm text-muted mb-6">
                    Paste a PGN from Lichess, Chess.com, or any other source. The full game opens in the review board with engine analysis on every position.
                  </p>
                  <textarea
                    aria-labelledby="analyze-heading"
                    className="w-full min-h-[260px] px-4 py-3 bg-[#f1f2f4] rounded-md border-0 outline-none focus:ring-2 focus:ring-primary/30 font-mono text-xs text-on-surface placeholder:text-muted/50 transition-all resize-y"
                    placeholder={'[Event "Casual game"]\n[White "Player A"]\n[Black "Player B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 ...'}
                    value={pgnInput}
                    onChange={(e) => { setPgnInput(e.target.value); setPgnError(''); }}
                    spellCheck={false}
                  />
                  {pgnError && (
                    <p className="font-mono text-xs text-danger bg-danger-bg rounded-md px-4 py-2.5 mt-4">{pgnError}</p>
                  )}
                  <button
                    onClick={handleAnalyzePgn}
                    disabled={!pgnInput.trim()}
                    className="mt-5 w-full py-3.5 bg-primary text-on-primary rounded-md font-display font-bold text-sm border-0 cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    Analyze →
                  </button>
                </div>
              </div>
            )}

            {/* ── Friends tab ── */}
            {!viewingGameId && !pgnReviewData && lobbyTab === 'friends' && (
              <div className="max-w-2xl mx-auto">
                <FriendsPanel
                  token={token}
                  onChallengeAccepted={({ game_id, white_id }) => {
                    setPlayerColour(white_id === parseJwt(token)?.sub ? 'white' : 'black');
                    setGameId(game_id);
                  }}
                />
              </div>
            )}
          </main>
        </div>

        {challengeBanner}

        {viewingPlayerId && (
          <PlayerProfile
            userId={viewingPlayerId}
            token={token}
            onClose={() => setViewingPlayerId(null)}
            onViewGame={(id) => { setViewingPlayerId(null); setViewingGameId(id); }}
          />
        )}
      </div>
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────────

  const { fen, clocks, turn, clocksStarted, gameOver, drawOffer } = gameState;
  const opponentColour = playerColour === 'white' ? 'black' : 'white';

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-surface-high">
        <div className="flex items-center gap-2">
          <span className="text-lg select-none">♟</span>
          <span className="font-display font-bold text-base text-on-surface tracking-[-0.01em]">Fianchetto Friends</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="font-body text-sm font-medium text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer transition-colors disabled:opacity-30 px-3 py-1.5 rounded-md hover:bg-surface-high"
            onClick={sendDrawOffer}
            disabled={!!gameOver}
          >
            Offer draw
          </button>
          <button
            className="font-body text-sm font-medium text-danger hover:bg-danger-bg bg-transparent border border-danger/20 cursor-pointer transition-all disabled:opacity-30 px-3 py-1.5 rounded-md"
            onClick={sendResign}
            disabled={!!gameOver}
          >
            Resign
          </button>
          <div className={[
            'flex items-center gap-1.5 font-mono text-xs font-medium px-3 py-1.5 rounded-md',
            connected ? 'bg-success-bg text-success' : 'bg-surface-high text-muted',
          ].join(' ')}>
            <div className={['w-1.5 h-1.5 rounded-full', connected ? 'bg-success animate-pulse' : 'bg-muted'].join(' ')} />
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
        </div>
      </header>

      {/* Board area */}
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-8">
        {/* Opponent clock */}
        <div className="w-full max-w-[560px]">
          <Clock
            label={`${opponentColour} · opponent`}
            serverMs={clocks[opponentColour] ?? 600_000}
            active={clocksStarted && !gameOver && turn === opponentColour}
          />
        </div>

        <Board
          fen={fen}
          playerColour={playerColour}
          onMove={(from, to, promotion) => sendMove({ from, to, promotion })}
          gameOver={gameOver}
        />

        {/* Your clock */}
        <div className="w-full max-w-[560px]">
          <Clock
            label={`${playerColour} · you`}
            serverMs={clocks[playerColour] ?? 600_000}
            active={clocksStarted && !gameOver && turn === playerColour}
          />
        </div>
      </main>

      {/* Draw offer overlay */}
      {drawOffer && !gameOver && drawOffer !== playerColour && drawOffer !== drawOfferDismissed && (
        <Overlay>
          <div className="text-3xl mb-1">🤝</div>
          <h3 className="font-display font-bold text-xl text-on-surface">Draw offered</h3>
          <p className="font-body text-sm text-muted">Your opponent wants to call it a draw.</p>
          <div className="flex gap-3 mt-3">
            <button className="btn-primary" onClick={sendDrawAccept}>Accept draw</button>
            <button className="btn-secondary" onClick={() => setDrawOfferDismissed(drawOffer)}>Decline</button>
          </div>
        </Overlay>
      )}

      {/* Game over overlay */}
      {gameOver && (() => {
        const isWin  = gameOver.result === playerColour;
        const isDraw = gameOver.result === 'draw';
        return (
          <Overlay>
            <div className="text-4xl select-none mb-1">
              {isDraw ? '🤝' : isWin ? '🏆' : '😞'}
            </div>
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted font-semibold">Game over</span>
            <h2 className={[
              'font-display text-[2.5rem] font-extrabold leading-tight tracking-[-0.02em] mt-0.5',
              isDraw ? 'text-on-surface' : isWin ? 'text-success' : 'text-on-surface',
            ].join(' ')}>
              {isDraw ? "It's a draw." : isWin ? 'You win!' : 'You lose.'}
            </h2>
            <p className="font-body text-sm text-muted capitalize">{gameOver.reason?.replace(/_/g, ' ')}</p>
            <div className="flex gap-2 mt-4">
              <button className="btn-primary" onClick={() => { setGameId(null); setLobbyTab('play'); }}>
                Play again
              </button>
              <button className="btn-secondary" onClick={() => { setGameId(null); setLobbyTab('history'); }}>
                View history
              </button>
            </div>
          </Overlay>
        );
      })()}

      {challengeBanner}

      {viewingGameId && (
        <GameReview gameId={viewingGameId} token={token} onClose={handleCloseReview} />
      )}
      {viewingPlayerId && (
        <PlayerProfile
          userId={viewingPlayerId}
          token={token}
          onClose={() => setViewingPlayerId(null)}
          onViewGame={(id) => { setViewingPlayerId(null); setViewingGameId(id); }}
        />
      )}
    </div>
  );
}

// ── Shared overlay ────────────────────────────────────────────────────────────
function Overlay({ children }) {
  return (
    <div className="fixed inset-0 bg-surface-low/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-md p-8 shadow-[0_24px_64px_rgba(0,0,0,0.12)] max-w-sm w-full flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}
