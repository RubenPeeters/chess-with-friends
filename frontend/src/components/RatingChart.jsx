import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../api.js';

const GAME_TYPES = ['bullet', 'blitz', 'rapid', 'classical'];
const TYPE_COLORS = {
  bullet:    '#ef4444',
  blitz:     '#f59e0b',
  rapid:     '#3b82f6',
  classical: '#8b5cf6',
};

const SVG_W = 600;
const SVG_H = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 44 };
const PLOT_W = SVG_W - PAD.left - PAD.right;
const PLOT_H = SVG_H - PAD.top - PAD.bottom;

/**
 * Rating history chart — one line per game type, rendered as a pure SVG
 * (no charting library). Fetches data from `/api/social/users/:id/rating-history`.
 */
export function RatingChart({ userId, token }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [activeType, setActiveType] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const id = ++fetchIdRef.current;
    setLoading(true); setError('');
    try {
      const result = await apiFetch(`/api/social/users/${userId}/rating-history`, { token });
      if (id !== fetchIdRef.current) return; // stale response
      setData(result);
      const best = Object.entries(result).sort((a, b) => b[1].length - a[1].length)[0];
      if (best) setActiveType(best[0]);
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      setError(err.message);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, [userId, token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const points = useMemo(() => {
    if (!data || !activeType || !data[activeType] || data[activeType].length === 0) return [];
    return data[activeType];
  }, [data, activeType]);

  const { minR, maxR, scaleX, scaleY } = useMemo(() => {
    if (points.length === 0) return { minR: 1000, maxR: 1400, scaleX: () => 0, scaleY: () => 0 };
    const ratings = points.map((p) => p.rating);
    const min = Math.floor(Math.min(...ratings) / 50) * 50 - 50;
    const max = Math.ceil(Math.max(...ratings) / 50) * 50 + 50;
    return {
      minR: min,
      maxR: max,
      scaleX: (i) => PAD.left + (i / Math.max(1, points.length - 1)) * PLOT_W,
      scaleY: (r) => PAD.top + PLOT_H - ((r - min) / (max - min)) * PLOT_H,
    };
  }, [points]);

  const polyline = useMemo(() =>
    points.map((p, i) => `${scaleX(i)},${scaleY(p.rating)}`).join(' '),
  [points, scaleX, scaleY]);

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const ticks = [];
    const step = Math.max(50, Math.round((maxR - minR) / 4 / 50) * 50);
    for (let r = minR; r <= maxR; r += step) ticks.push(r);
    return ticks;
  }, [minR, maxR]);

  if (loading) return <p className="font-body text-sm text-muted text-center py-6">Loading chart…</p>;
  if (error) return <p className="font-mono text-xs text-danger text-center py-6">{error}</p>;
  if (!data || Object.keys(data).length === 0) {
    return <p className="font-body text-sm text-muted text-center py-6">Play some rated games to see your history.</p>;
  }

  const hoverPoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Type tabs */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Game type">
        {GAME_TYPES.filter((t) => data[t]?.length > 0).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeType === t}
            onClick={() => { setActiveType(t); setHoverIdx(null); }}
            className={[
              'font-body text-xs font-semibold px-3 py-1.5 rounded-md border-0 cursor-pointer transition-all capitalize',
              activeType === t ? 'bg-on-surface text-white shadow-sm' : 'bg-surface-high text-muted hover:text-on-surface',
            ].join(' ')}
            style={activeType === t ? { backgroundColor: TYPE_COLORS[t] } : undefined}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Chart */}
      {points.length < 2 ? (
        <p className="font-body text-sm text-muted text-center py-6">Not enough data for a chart — play more {activeType} games.</p>
      ) : (
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-auto select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Grid lines + Y labels */}
          {yTicks.map((r) => (
            <g key={r}>
              <line
                x1={PAD.left} y1={scaleY(r)} x2={SVG_W - PAD.right} y2={scaleY(r)}
                stroke="#e4e8ee" strokeWidth={1}
              />
              <text x={PAD.left - 6} y={scaleY(r) + 3} textAnchor="end" fontSize={9} fill="#5a6270" fontFamily="monospace">
                {r}
              </text>
            </g>
          ))}

          {/* Line */}
          <polyline
            points={polyline}
            fill="none"
            stroke={TYPE_COLORS[activeType] ?? '#3b82f6'}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Invisible hover targets — spacing matches actual point distance */}
          {points.map((p, i) => {
            const spacing = points.length > 1 ? PLOT_W / (points.length - 1) : PLOT_W;
            return (
            <rect
              key={i}
              x={scaleX(i) - spacing / 2}
              y={PAD.top}
              width={spacing}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
            );
          })}

          {/* Hover dot + label */}
          {hoverPoint && (
            <>
              <circle
                cx={scaleX(hoverIdx)}
                cy={scaleY(hoverPoint.rating)}
                r={4}
                fill={TYPE_COLORS[activeType] ?? '#3b82f6'}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={scaleX(hoverIdx)}
                y={scaleY(hoverPoint.rating) - 10}
                textAnchor="middle"
                fontSize={10}
                fontWeight="bold"
                fill="#191c1e"
                fontFamily="monospace"
              >
                {Math.round(hoverPoint.rating)}
              </text>
              <text
                x={scaleX(hoverIdx)}
                y={SVG_H - 4}
                textAnchor="middle"
                fontSize={8}
                fill="#5a6270"
                fontFamily="monospace"
              >
                {new Date(hoverPoint.recorded_at).toLocaleDateString()}
              </text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}
