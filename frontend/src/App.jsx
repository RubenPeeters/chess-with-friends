import { useState, useEffect } from 'react';
import { Board } from './components/Board.jsx';
import { Clock } from './components/Clock.jsx';
import { ProfilePanel } from './components/ProfilePanel.jsx';
import { HistoryPanel } from './components/HistoryPanel.jsx';
import { FriendsPanel } from './components/FriendsPanel.jsx';
import { useGameSocket } from './hooks/useGameSocket.js';
import { apiFetch } from './api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decode JWT payload without verifying (server verifies). */
function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

/** Extract invite token from /play/:token URL paths. */
function getInviteTokenFromUrl() {
  const match = window.location.pathname.match(/^\/play\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken]         = useState(() => localStorage.getItem('cwf_token'));
  const [gameId, setGameId]       = useState(null);
  const [playerColour, setPlayerColour] = useState('white');

  // Auth
  const [authMode, setAuthMode]   = useState('login'); // 'login' | 'register'
  const [authForm, setAuthForm]   = useState({ email: '', password: '', displayName: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Invite token found in URL (e.g. someone opened a /play/:token link)
  const [pendingInviteToken] = useState(() => getInviteTokenFromUrl());

  // Lobby tab
  const [lobbyTab, setLobbyTab]   = useState('play'); // 'play' | 'history' | 'friends'

  // Lobby — play tab
  const [lobbyError, setLobbyError]     = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [joinInput, setJoinInput]       = useState(() => getInviteTokenFromUrl() ?? '');
  const [timeControl, setTimeControl]   = useState('10+0');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [joiningGame, setJoiningGame]   = useState(false);
  const [copied, setCopied]             = useState(false);

  const { gameState, sendMove, sendResign, sendDrawOffer, connected } =
    useGameSocket(gameId, token);

  // Derive user info from JWT
  const jwtPayload = token ? parseJwt(token) : null;
  const user = jwtPayload
    ? { id: jwtPayload.sub, email: jwtPayload.email, display_name: jwtPayload.display_name ?? jwtPayload.email?.split('@')[0] }
    : null;

  // Already logged in + landed on /play/:token → accept immediately
  useEffect(() => {
    if (token && pendingInviteToken && !gameId) {
      acceptInvite(pendingInviteToken).catch(() => {
        window.history.replaceState(null, '', '/');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // ── Auth handlers ─────────────────────────────────────────────────────────

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
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

      if (pendingInviteToken) {
        await acceptInvite(pendingInviteToken, data.token);
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  /** Accept an invite and transition straight into the game. */
  async function acceptInvite(inviteToken, jwt = token) {
    const data = await apiFetch(`/api/social/invites/${inviteToken}/accept`, {
      method: 'POST',
      token: jwt,
    });
    const userId = parseJwt(jwt)?.sub;
    const colour = data.white_id === userId ? 'white' : 'black';
    window.history.replaceState(null, '', '/');
    setPlayerColour(colour);
    setGameId(data.game_id);
    setCreatedInvite(null);
  }

  function handleLogout() {
    localStorage.removeItem('cwf_token');
    setToken(null);
    setGameId(null);
    setCreatedInvite(null);
    setJoinInput('');
    setAuthForm({ email: '', password: '', displayName: '' });
    setAuthMode('login');
    setLobbyTab('play');
  }

  function switchAuthMode(mode) {
    setAuthMode(mode);
    setAuthError('');
  }

  // ── Lobby handlers ────────────────────────────────────────────────────────

  async function handleCreateInvite() {
    setLobbyError('');
    setCreatingInvite(true);
    try {
      const data = await apiFetch('/api/social/invites', {
        method: 'POST',
        token,
        body: JSON.stringify({ time_control: timeControl, colour: 'random' }),
      });
      setCreatedInvite(data);
    } catch (err) {
      setLobbyError(err.message);
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setLobbyError('');
    setJoiningGame(true);
    const input = joinInput.trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    try {
      if (!uuidRe.test(input)) throw new Error('Enter a valid invite token or game ID (UUID format)');
      try {
        await acceptInvite(input);
      } catch (inviteErr) {
        if (!inviteErr.message.includes('not found') && !inviteErr.message.includes('already used')) {
          throw inviteErr;
        }
        setPlayerColour('white');
        setGameId(input);
        setCreatedInvite(null);
      }
    } catch (err) {
      setLobbyError(err.message);
    } finally {
      setJoiningGame(false);
    }
  }

  // ── SSE: watch for invite acceptance ─────────────────────────────────────
  useEffect(() => {
    if (!createdInvite || !token) return;

    const url = `/api/social/invites/${createdInvite.token}/watch?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('accepted', (e) => {
      const { game_id, white_id } = JSON.parse(e.data);
      const userId = parseJwt(token)?.sub;
      const colour = white_id === userId ? 'white' : 'black';
      setPlayerColour(colour);
      setGameId(game_id);
      setCreatedInvite(null);
      es.close();
    });

    es.onerror = () => es.close();
    return () => es.close();
  }, [createdInvite?.token, token]);

  function handleCopyLink() {
    if (!createdInvite) return;
    const link = `${location.origin}/play/${createdInvite.token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  /* Auth screen */
  if (!token) {
    const isRegister = authMode === 'register';
    return (
      <div style={s.authShell}>
        <div style={s.authLeft}>
          <span style={s.eyebrow}>High-performance chess</span>
          <h1 style={s.displayLg}>Chess<br />with<br />Friends.</h1>
        </div>

        <div style={s.authRight}>
          <div style={s.card}>
            <div style={s.tabRow}>
              <button style={s.tab(authMode === 'login')} onClick={() => switchAuthMode('login')}>
                Sign in
              </button>
              <button style={s.tab(authMode === 'register')} onClick={() => switchAuthMode('register')}>
                Create account
              </button>
            </div>

            <form onSubmit={handleAuth} style={s.form}>
              {isRegister && (
                <>
                  <label style={s.fieldLabel}>Display name</label>
                  <input
                    style={s.input}
                    placeholder="Magnus"
                    value={authForm.displayName}
                    onChange={(e) => setAuthForm((f) => ({ ...f, displayName: e.target.value }))}
                    required
                  />
                </>
              )}

              <label style={s.fieldLabel}>Email</label>
              <input
                style={s.input}
                type="email"
                placeholder="you@example.com"
                value={authForm.email}
                onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))}
                required
              />

              <label style={s.fieldLabel}>Password</label>
              <input
                style={s.input}
                type="password"
                placeholder="••••••••"
                value={authForm.password}
                onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
              />

              {authError && <p style={s.errorMsg}>{authError}</p>}

              <button style={s.btnPrimary} type="submit" disabled={authLoading}>
                {authLoading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  /* Lobby screen */
  if (!gameId) {
    return (
      <div style={s.lobbyShell}>
        {/* Left column — profile */}
        <div style={s.lobbyLeft}>
          <div style={s.brandMarkLobby}>CWF</div>
          <div style={s.profileCard}>
            <ProfilePanel token={token} user={user} onLogout={handleLogout} />
          </div>
        </div>

        {/* Right panel — tabbed */}
        <div style={s.lobbyRight}>
          {/* Tab bar */}
          <div style={s.tabBar}>
            {['play', 'history', 'friends'].map((tab) => (
              <button
                key={tab}
                style={s.tabBarBtn(lobbyTab === tab)}
                onClick={() => setLobbyTab(tab)}
              >
                {tab === 'play' ? 'Play' : tab === 'history' ? 'History' : 'Friends'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={s.tabContent}>
            {lobbyTab === 'play' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Create invite card */}
                <div style={s.card}>
                  <h2 style={s.cardHeading}>Create a game</h2>
                  <div style={s.form}>
                    <label style={s.fieldLabel}>Time control</label>
                    <select
                      style={s.input}
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

                    {createdInvite ? (
                      <div style={s.inviteBox}>
                        <span style={s.inviteLabel}>Share this link with your opponent</span>
                        <div style={s.inviteLinkRow}>
                          <span style={s.inviteToken}>{createdInvite.token}</span>
                          <button style={s.copyBtn} onClick={handleCopyLink}>
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <span style={{ ...s.inviteLabel, marginTop: '0.25rem' }}>
                          Waiting for opponent to join…
                        </span>
                        <button
                          style={{ ...s.btnTertiary, marginTop: '0.25rem' }}
                          onClick={() => setCreatedInvite(null)}
                        >
                          Create another
                        </button>
                      </div>
                    ) : (
                      <button style={s.btnPrimary} onClick={handleCreateInvite} disabled={creatingInvite}>
                        {creatingInvite ? 'Creating…' : 'Generate invite link'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Join card */}
                <div style={s.card}>
                  <h2 style={s.cardHeading}>Join a game</h2>
                  <form onSubmit={handleJoin} style={s.form}>
                    <label style={s.fieldLabel}>Invite token or game ID</label>
                    <input
                      style={{ ...s.input, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      required
                    />
                    {lobbyError && <p style={s.errorMsg}>{lobbyError}</p>}
                    <button style={s.btnPrimary} type="submit" disabled={joiningGame}>
                      {joiningGame ? 'Joining…' : 'Join'}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {lobbyTab === 'history' && (
              <HistoryPanel token={token} userId={user?.id} />
            )}

            {lobbyTab === 'friends' && (
              <FriendsPanel token={token} />
            )}
          </div>
        </div>
      </div>
    );
  }

  /* Game screen */
  const { fen, clocks, turn, clocksStarted, gameOver, drawOffer } = gameState;
  const opponentColour = playerColour === 'white' ? 'black' : 'white';

  return (
    <div style={s.gameShell}>
      <header style={s.topBar}>
        <span style={s.brandMark}>CWF</span>
        <span style={s.connChip(connected)}>
          {connected ? 'Live' : 'Reconnecting…'}
        </span>
      </header>

      <main style={s.gameMain}>
        <div style={s.playerRow}>
          <Clock
            label={opponentColour}
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

        <div style={s.playerRow}>
          <Clock
            label={`${playerColour} — you`}
            serverMs={clocks[playerColour] ?? 600_000}
            active={clocksStarted && !gameOver && turn === playerColour}
          />
          <div style={s.actions}>
            <button style={s.btnTertiary} onClick={sendDrawOffer} disabled={!!gameOver}>
              Offer draw
            </button>
            <button
              style={{ ...s.btnTertiary, color: '#b91c1c' }}
              onClick={sendResign}
              disabled={!!gameOver}
            >
              Resign
            </button>
          </div>
        </div>
      </main>

      {drawOffer && !gameOver && drawOffer !== playerColour && (
        <div style={s.glassOverlay}>
          <div style={s.glassCard}>
            <h3 style={s.glassHeading}>Draw offered</h3>
            <p style={s.glassSub}>Your opponent is offering a draw.</p>
            <button style={s.btnPrimary} onClick={() => sendDrawOffer()}>Accept draw</button>
          </div>
        </div>
      )}

      {gameOver && (
        <div style={s.glassOverlay}>
          <div style={s.glassCard}>
            <span style={s.eyebrow}>Game over</span>
            <h2 style={{ ...s.displayLg, fontSize: '2.5rem', marginTop: '0.25rem' }}>
              {gameOver.result === 'draw' ? 'Draw.' : `${gameOver.result} wins.`}
            </h2>
            <p style={s.glassSub}>{gameOver.reason?.replace(/_/g, ' ')}</p>
            <button style={s.btnPrimary} onClick={() => { setGameId(null); setLobbyTab('history'); }}>
              Back to lobby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  authShell: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    minHeight: '100vh',
    background: 'var(--surface)',
  },
  authLeft: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    padding: 'var(--space-24) var(--space-12)',
    background: 'var(--surface-low)',
  },
  authRight: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-12)',
    overflowY: 'auto',
  },

  // ── Lobby ─────────────────────────────────────────────────────────────────
  lobbyShell: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    minHeight: '100vh',
    background: 'var(--surface)',
  },
  lobbyLeft: {
    background: 'var(--surface-low)',
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-8) var(--space-6)',
    gap: 'var(--space-8)',
  },
  brandMarkLobby: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '1rem',
    letterSpacing: '-0.02em',
    color: 'var(--primary)',
  },
  profileCard: {
    background: 'var(--surface-lowest)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--ambient-shadow-raised)',
  },
  lobbyRight: {
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--space-8)',
    gap: 'var(--space-6)',
    overflowY: 'auto',
  },

  // Tab bar (lobby)
  tabBar: {
    display: 'flex',
    gap: '0.25rem',
    background: 'var(--surface-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.25rem',
    alignSelf: 'flex-start',
  },
  tabBarBtn: (active) => ({
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
    padding: '0.5rem 1.25rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--surface-lowest)' : 'transparent',
    color: active ? 'var(--on-surface)' : 'var(--on-surface-muted)',
    boxShadow: active ? 'var(--ambient-shadow)' : 'none',
    transition: 'background 0.15s, color 0.15s',
  }),
  tabContent: {
    flex: 1,
    maxWidth: 420,
  },

  // ── Shared ────────────────────────────────────────────────────────────────
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--primary)',
    marginBottom: '1rem',
    display: 'block',
  },
  displayLg: {
    fontFamily: 'var(--font-display)',
    fontSize: '3.5rem',
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    color: 'var(--on-surface)',
  },
  card: {
    background: 'var(--surface-lowest)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-8)',
    paddingBottom: 'calc(var(--space-8) * 1.5)',
    boxShadow: 'var(--ambient-shadow-raised)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    width: 360,
  },
  cardHeading: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.125rem',
    fontWeight: 700,
    color: 'var(--on-surface)',
  },
  tabRow: {
    display: 'flex',
    gap: '0.25rem',
    background: 'var(--surface-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.25rem',
  },
  tab: (active) => ({
    flex: 1,
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 400,
    padding: '0.5rem',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--surface-lowest)' : 'transparent',
    color: active ? 'var(--on-surface)' : 'var(--on-surface-muted)',
    boxShadow: active ? 'var(--ambient-shadow)' : 'none',
    transition: 'background 0.15s, color 0.15s',
  }),
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  fieldLabel: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--on-surface-muted)',
    marginBottom: '-0.25rem',
  },
  input: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    padding: '0.625rem 0.875rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--surface-high)',
    color: 'var(--on-surface)',
    width: '100%',
    transition: 'box-shadow 0.15s',
  },
  errorMsg: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    color: '#b91c1c',
  },
  btnPrimary: {
    fontFamily: 'var(--font-display)',
    fontSize: '0.9375rem',
    fontWeight: 700,
    padding: '0.75rem 1.5rem',
    borderRadius: 'var(--radius-xl)',
    border: 'none',
    background: 'var(--primary-gradient)',
    color: 'var(--on-primary)',
    cursor: 'pointer',
    marginTop: '0.5rem',
    letterSpacing: '-0.01em',
    transition: 'opacity 0.15s',
  },
  btnTertiary: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.875rem',
    fontWeight: 500,
    padding: '0.375rem 0',
    border: 'none',
    background: 'none',
    color: 'var(--primary)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    alignSelf: 'flex-start',
  },

  // Invite box
  inviteBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    background: 'var(--surface-low)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.875rem',
    marginTop: '0.25rem',
  },
  inviteLabel: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.75rem',
    color: 'var(--on-surface-muted)',
  },
  inviteLinkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  inviteToken: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: 'var(--on-surface)',
    flex: 1,
    wordBreak: 'break-all',
  },
  copyBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 600,
    padding: '0.3rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'var(--secondary-fixed)',
    color: 'var(--on-surface)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  // ── Game ─────────────────────────────────────────────────────────────────
  gameShell: {
    minHeight: '100vh',
    background: 'var(--surface)',
    display: 'flex',
    flexDirection: 'column',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 2rem',
    background: 'var(--surface-low)',
  },
  brandMark: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '1rem',
    letterSpacing: '-0.02em',
    color: 'var(--primary)',
  },
  connChip: (ok) => ({
    fontFamily: 'var(--font-mono)',
    fontSize: '0.6875rem',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '0.25rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    background: ok ? '#dcfce7' : 'var(--secondary-fixed)',
    color: ok ? '#15803d' : 'var(--on-surface-muted)',
  }),
  gameMain: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'var(--space-4)',
    padding: 'var(--space-8) var(--space-6)',
    maxWidth: 640,
    margin: '0 auto',
    width: '100%',
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 560,
  },
  actions: {
    display: 'flex',
    gap: 'var(--space-4)',
    alignItems: 'center',
  },
  glassOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(247, 249, 252, 0.6)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  glassCard: {
    background: 'rgba(255, 255, 255, 0.80)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-8)',
    paddingBottom: 'calc(var(--space-8) * 1.5)',
    boxShadow: '0 8px 40px rgba(25, 28, 30, 0.08)',
    maxWidth: 400,
    width: '90%',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  glassHeading: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.25rem',
    fontWeight: 700,
    color: 'var(--on-surface)',
  },
  glassSub: {
    fontFamily: 'var(--font-body)',
    fontSize: '0.9375rem',
    color: 'var(--on-surface-muted)',
  },
};
