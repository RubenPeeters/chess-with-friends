import { useState, useEffect } from 'react';
import { Board } from './components/Board.jsx';
import { Clock } from './components/Clock.jsx';
import { ProfilePanel } from './components/ProfilePanel.jsx';
import { HistoryPanel } from './components/HistoryPanel.jsx';
import { FriendsPanel } from './components/FriendsPanel.jsx';
import { GameReview } from './components/GameReview.jsx';
import { PlayerProfile } from './components/PlayerProfile.jsx';
import { useGameSocket } from './hooks/useGameSocket.js';
import { useNotifications } from './hooks/useNotifications.js';
import { apiFetch } from './api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJwt(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

function getInviteTokenFromUrl() {
  const match = window.location.pathname.match(/^\/play\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken]               = useState(() => localStorage.getItem('cwf_token'));
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
      localStorage.setItem('cwf_token', data.token);
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
    localStorage.removeItem('cwf_token');
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

  async function acceptChallenge(notif) {
    dismiss(notif.id);
    try { await acceptInvite(notif.invite_token); }
    catch (err) { console.warn('Failed to accept challenge:', err.message); }
  }

  // ── Notification toasts ───────────────────────────────────────────────────

  const challengeBanner = notifications.length > 0 && (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[200] max-w-sm w-full">
      {notifications.map((n) => (
        <div key={n.id} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-surface-high">
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
      <div className="min-h-screen bg-surface flex">
        {/* Left — branding panel */}
        <div className="hidden lg:flex flex-col justify-between w-[460px] shrink-0 bg-primary px-12 py-16">
          <span className="font-display font-extrabold text-xl tracking-[-0.02em] text-on-primary/90">CWF</span>
          <div>
            <div className="text-5xl mb-8 select-none">♟</div>
            <h1 className="font-display text-[3.5rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-on-primary">
              Chess<br />with<br />Friends.
            </h1>
            <p className="mt-5 font-body text-base text-on-primary/70 leading-relaxed max-w-xs">
              Play with friends, track your Glicko-2 rating, and climb the leaderboard.
            </p>
          </div>
          <p className="font-mono text-[0.65rem] text-on-primary/30 tracking-wide">© 2026 Chess with Friends</p>
        </div>

        {/* Right — form */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
          <div className="w-full max-w-sm">
            {/* Mobile logo */}
            <div className="lg:hidden mb-10 flex items-center gap-2">
              <span className="text-3xl select-none">♟</span>
              <span className="font-display font-extrabold text-2xl tracking-[-0.02em] text-primary">Chess with Friends</span>
            </div>

            <h2 className="font-display font-extrabold text-[1.75rem] text-on-surface mb-1 tracking-[-0.02em]">
              {isRegister ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="font-body text-sm text-muted mb-8">
              {isRegister ? 'Join the game.' : 'Sign in to continue playing.'}
            </p>

            {/* Tab toggle */}
            <div className="flex gap-1 bg-surface-low rounded-2xl p-1 mb-8 border border-surface-high">
              {['login', 'register'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setAuthMode(mode); setAuthError(''); }}
                  className={[
                    'flex-1 font-body text-sm py-2.5 rounded-xl border-0 cursor-pointer transition-all duration-200',
                    authMode === mode
                      ? 'bg-primary text-on-primary font-semibold shadow-sm'
                      : 'bg-transparent text-muted hover:text-on-surface',
                  ].join(' ')}
                >
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <form onSubmit={handleAuth} className="flex flex-col gap-4">
              {isRegister && (
                <div className="flex flex-col gap-1.5">
                  <label className="field-label">Display name</label>
                  <input className="text-input" placeholder="Magnus"
                    value={authForm.displayName}
                    onChange={(e) => setAuthForm((f) => ({ ...f, displayName: e.target.value }))}
                    required />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Email</label>
                <input className="text-input" type="email" placeholder="you@example.com"
                  value={authForm.email}
                  onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
                  required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Password</label>
                <input className="text-input" type="password" placeholder="••••••••"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                  required minLength={8} />
              </div>

              {authError && (
                <p className="font-mono text-xs text-danger bg-danger-bg rounded-lg px-3 py-2">{authError}</p>
              )}

              <button className="btn-primary w-full mt-2" type="submit" disabled={authLoading}>
                {authLoading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── Lobby screen ──────────────────────────────────────────────────────────

  if (!gameId) {
    return (
      <div className="min-h-screen bg-surface flex">
        {/* Sidebar */}
        <aside className="w-[280px] shrink-0 bg-white border-r border-surface-high flex flex-col">
          {/* Brand */}
          <div className="px-6 py-5 border-b border-surface-high flex items-center gap-2">
            <span className="text-xl select-none">♟</span>
            <span className="font-display font-extrabold text-base tracking-[-0.02em] text-on-surface">Chess with Friends</span>
          </div>
          {/* Profile */}
          <div className="flex-1 overflow-y-auto">
            <ProfilePanel token={token} user={user} onLogout={handleLogout} />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-h-screen overflow-y-auto bg-surface">
          {/* Page header */}
          <div className="flex justify-center px-8 pt-8 pb-0">
            <div className="flex gap-1 bg-white rounded-2xl p-1.5 w-fit border border-surface-high shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
              {['play', 'history', 'friends'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLobbyTab(tab)}
                  className={[
                    'font-body text-sm py-2 px-5 rounded-xl border-0 cursor-pointer transition-all duration-200 capitalize',
                    lobbyTab === tab
                      ? 'bg-primary text-on-primary font-semibold shadow-sm'
                      : 'bg-transparent text-muted hover:text-on-surface',
                  ].join(' ')}
                >
                  {tab === 'play' ? 'Play' : tab === 'history' ? 'History' : 'Friends'}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 flex justify-center px-8 py-6">
            {lobbyTab === 'play' && (
              <div className="flex flex-col gap-5 w-full max-w-md">
                {/* Create game card */}
                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] border border-surface-high p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <span className="text-xl select-none">✦</span>
                    <h2 className="font-display font-bold text-lg text-on-surface">New game</h2>
                  </div>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Time control</label>
                      <select className="text-input" value={timeControl} onChange={(e) => setTimeControl(e.target.value)}>
                        <option value="1+0">Bullet — 1 min</option>
                        <option value="3+0">Blitz — 3 min</option>
                        <option value="3+2">Blitz — 3 min + 2 sec</option>
                        <option value="5+0">Blitz — 5 min</option>
                        <option value="10+0">Rapid — 10 min</option>
                        <option value="15+10">Rapid — 15 min + 10 sec</option>
                        <option value="30+0">Classical — 30 min</option>
                      </select>
                    </div>

                    {createdInvite ? (
                      <div className="flex flex-col gap-3 bg-surface rounded-2xl p-4 border border-surface-high">
                        <span className="font-mono text-[0.68rem] text-muted uppercase tracking-[0.06em]">Share with your opponent</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[0.625rem] text-on-surface flex-1 break-all bg-surface-high rounded-xl px-3 py-2.5 leading-relaxed">
                            {`${location.origin}/play/${createdInvite.token}`}
                          </span>
                          <button onClick={handleCopyLink} className={[
                            'font-mono text-xs font-bold px-3.5 py-2.5 rounded-xl border-0 cursor-pointer whitespace-nowrap transition-all flex-shrink-0',
                            copied ? 'bg-success-bg text-success' : 'bg-primary text-on-primary hover:opacity-80',
                          ].join(' ')}>
                            {copied ? '✓' : 'Copy'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse flex-shrink-0" />
                          <span className="font-mono text-[0.68rem] text-muted">Waiting for opponent…</span>
                        </div>
                        <button onClick={() => setCreatedInvite(null)} className="btn-ghost text-xs self-start">
                          ← New invite
                        </button>
                      </div>
                    ) : (
                      <button className="btn-primary w-full" onClick={handleCreateInvite} disabled={creatingInvite}>
                        {creatingInvite ? 'Creating…' : 'Create invite link'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Join game card */}
                <div className="bg-white rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.06)] border border-surface-high p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <span className="text-xl select-none">⤵</span>
                    <h2 className="font-display font-bold text-lg text-on-surface">Join a game</h2>
                  </div>
                  <form onSubmit={handleJoin} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Invite token or game ID</label>
                      <input
                        className="text-input font-mono text-xs"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={joinInput}
                        onChange={(e) => setJoinInput(e.target.value)}
                        required
                      />
                    </div>
                    {lobbyError && (
                      <p className="font-mono text-xs text-danger bg-danger-bg rounded-xl px-3 py-2">{lobbyError}</p>
                    )}
                    <button className="btn-primary w-full" type="submit" disabled={joiningGame}>
                      {joiningGame ? 'Joining…' : 'Join game'}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {lobbyTab === 'history' && (
              <div className="w-full max-w-md">
                <h2 className="font-display font-bold text-lg text-on-surface mb-4">Match history</h2>
                <HistoryPanel
                  token={token}
                  userId={user?.id}
                  onViewGame={setViewingGameId}
                  onViewProfile={setViewingPlayerId}
                />
              </div>
            )}

            {lobbyTab === 'friends' && (
              <div className="w-full max-w-md">
                <h2 className="font-display font-bold text-lg text-on-surface mb-4">Friends</h2>
                <FriendsPanel
                  token={token}
                  onChallengeAccepted={({ game_id, white_id }) => {
                    setPlayerColour(white_id === parseJwt(token)?.sub ? 'white' : 'black');
                    setGameId(game_id);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {challengeBanner}

        {viewingGameId && (
          <GameReview gameId={viewingGameId} token={token} onClose={() => setViewingGameId(null)} />
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

  // ── Game screen ───────────────────────────────────────────────────────────

  const { fen, clocks, turn, clocksStarted, gameOver, drawOffer } = gameState;
  const opponentColour = playerColour === 'white' ? 'black' : 'white';

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-surface-high">
        <div className="flex items-center gap-2">
          <span className="text-lg select-none">♟</span>
          <span className="font-display font-bold text-base text-on-surface tracking-[-0.01em]">Chess with Friends</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="font-body text-sm font-medium text-muted hover:text-on-surface bg-transparent border-0 cursor-pointer transition-colors disabled:opacity-30 px-3 py-1.5 rounded-xl hover:bg-surface-high"
            onClick={sendDrawOffer}
            disabled={!!gameOver}
          >
            Offer draw
          </button>
          <button
            className="font-body text-sm font-medium text-danger hover:bg-danger-bg bg-transparent border border-danger/20 cursor-pointer transition-all disabled:opacity-30 px-3 py-1.5 rounded-xl"
            onClick={sendResign}
            disabled={!!gameOver}
          >
            Resign
          </button>
          <div className={[
            'flex items-center gap-1.5 font-mono text-xs font-medium px-3 py-1.5 rounded-full',
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
        <GameReview gameId={viewingGameId} token={token} onClose={() => setViewingGameId(null)} />
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
      <div className="bg-white rounded-2xl p-8 shadow-[0_24px_64px_rgba(0,0,0,0.12)] max-w-sm w-full flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}
