import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = 'http://localhost:8002';

const SAMPLERS = [
  'DPM++ 2M Karras',
  'DPM++ SDE Karras',
  'DPM++ 2M SDE Karras',
  'Euler a',
  'Euler',
  'DDIM',
  'PLMS',
  'UniPC',
];

const RESOLUTIONS = [
  { label: '512 × 512', w: 512, h: 512 },
  { label: '512 × 768', w: 512, h: 768 },
  { label: '768 × 512', w: 768, h: 512 },
  { label: '768 × 768', w: 768, h: 768 },
  { label: '1024 × 576', w: 1024, h: 576 },
  { label: '576 × 1024', w: 576, h: 1024 },
  { label: '1024 × 1024', w: 1024, h: 1024 },
];

function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 48, height: 48, border: '3px solid #333', borderTop: '3px solid #a78bfa',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ color: '#a78bfa', fontSize: 14 }}>Generating…</span>
    </div>
  );
}

export function ImagesPage({ mirandaTranscript }) {
  const [prompt, setPrompt] = useState('');
  const [negPrompt, setNegPrompt] = useState('(worst quality, low quality, blurry, deformed)');
  const [steps, setSteps] = useState(20);
  const [cfg, setCfg] = useState(7);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [sampler, setSampler] = useState(SAMPLERS[0]);
  const [batchSize, setBatchSize] = useState(1);
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState([]); // { b64, prompt, ts }
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('generate'); // generate | history
  const promptRef = useRef(null);

  // Load models from A1111
  useEffect(() => {
    fetch(`${API}/api/images/models`)
      .then(r => r.json())
      .then(d => { if (d.data?.length) setModels(d.data); })
      .catch(() => {});
  }, []);

  // If Miranda speaks a prompt via voice, pre-fill it
  useEffect(() => {
    if (!mirandaTranscript) return;
    const m = mirandaTranscript.match(/(?:generate|draw|make|create|paint|render)\s+(?:an?\s+)?(?:image\s+of\s+|picture\s+of\s+)?(.+)/i);
    if (m) setPrompt(m[1].trim());
  }, [mirandaTranscript]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) { promptRef.current?.focus(); return; }
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/images/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negative_prompt: negPrompt,
          steps,
          cfg_scale: cfg,
          width: resolution.w,
          height: resolution.h,
          sampler_name: sampler,
          batch_size: batchSize,
          model,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Generation failed');
        return;
      }
      const newImages = (data.data.images || []).map(b64 => ({
        b64, prompt: data.data.prompt, ts: data.data.timestamp,
      }));
      setImages(prev => [...newImages, ...prev]);
      setSelected(newImages[0] || null);
    } catch (e) {
      setError(`Could not reach CRANE backend: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }, [prompt, negPrompt, steps, cfg, resolution, sampler, batchSize, model]);

  const loadHistory = useCallback(() => {
    fetch(`${API}/api/images/history?limit=100`)
      .then(r => r.json())
      .then(d => { if (d.data) setHistory(d.data); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (activeTab === 'history') loadHistory(); }, [activeTab]);

  const downloadImage = (b64, filename = 'crane-image.png') => {
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${b64}`;
    link.download = filename;
    link.click();
  };

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .img-thumb { cursor: pointer; border: 2px solid transparent; border-radius: 6px; transition: border-color 0.15s; }
        .img-thumb:hover, .img-thumb.active { border-color: #a78bfa; }
        .gen-btn { background: linear-gradient(135deg, #7c3aed, #a78bfa); color: white; border: none;
          padding: 12px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;
          transition: opacity 0.15s; }
        .gen-btn:hover:not(:disabled) { opacity: 0.9; }
        .gen-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tab-btn { background: none; border: none; color: #888; font-size: 14px; padding: 8px 16px;
          cursor: pointer; border-bottom: 2px solid transparent; }
        .tab-btn.active { color: #a78bfa; border-bottom-color: #a78bfa; }
        .ctrl-row { display: flex; flex-direction: column; gap: 4px; }
        .ctrl-row label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
        .ctrl-row select, .ctrl-row input[type=range] { width: 100%; }
        .ctrl-row select { background: #1a1a1a; color: #ddd; border: 1px solid #333; border-radius: 4px; padding: 4px 6px; font-size: 13px; }
      `}</style>

      {/* ── Header tabs ── */}
      <div style={styles.header}>
        <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 18 }}>🎨 Images</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`tab-btn ${activeTab === 'generate' ? 'active' : ''}`}
            onClick={() => setActiveTab('generate')}>Generate</button>
          <button className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}>History</button>
        </div>
      </div>

      {activeTab === 'generate' ? (
        <div style={styles.body}>
          {/* ── Left: controls ── */}
          <div style={styles.controls}>

            {/* Prompt */}
            <div style={styles.ctrlSection}>
              <label style={styles.sectionLabel}>Prompt</label>
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate(); }}
                placeholder="A cinematic shot of a neon-lit city at midnight, rain-soaked streets reflecting purple light…"
                style={styles.promptBox}
                rows={4}
              />
            </div>

            {/* Negative prompt */}
            <div style={styles.ctrlSection}>
              <label style={styles.sectionLabel}>Negative Prompt</label>
              <textarea
                value={negPrompt}
                onChange={e => setNegPrompt(e.target.value)}
                style={{ ...styles.promptBox, fontSize: 12, color: '#888', rows: 2 }}
                rows={2}
              />
            </div>

            {/* Model */}
            {models.length > 0 && (
              <div className="ctrl-row">
                <label>Model</label>
                <select value={model} onChange={e => setModel(e.target.value)}>
                  <option value="">— current —</option>
                  {models.map(m => (
                    <option key={m.title} value={m.title}>{m.model_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Resolution */}
            <div className="ctrl-row">
              <label>Resolution</label>
              <select
                value={`${resolution.w}x${resolution.h}`}
                onChange={e => {
                  const r = RESOLUTIONS.find(r => `${r.w}x${r.h}` === e.target.value);
                  if (r) setResolution(r);
                }}
              >
                {RESOLUTIONS.map(r => (
                  <option key={r.label} value={`${r.w}x${r.h}`}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Sampler */}
            <div className="ctrl-row">
              <label>Sampler</label>
              <select value={sampler} onChange={e => setSampler(e.target.value)}>
                {SAMPLERS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>

            {/* Steps */}
            <div className="ctrl-row">
              <label>Steps — {steps}</label>
              <input type="range" min={1} max={60} value={steps}
                onChange={e => setSteps(Number(e.target.value))} />
            </div>

            {/* CFG Scale */}
            <div className="ctrl-row">
              <label>CFG Scale — {cfg}</label>
              <input type="range" min={1} max={20} step={0.5} value={cfg}
                onChange={e => setCfg(Number(e.target.value))} />
            </div>

            {/* Batch */}
            <div className="ctrl-row">
              <label>Batch Size — {batchSize}</label>
              <input type="range" min={1} max={8} value={batchSize}
                onChange={e => setBatchSize(Number(e.target.value))} />
            </div>

            {/* Generate */}
            <button className="gen-btn" onClick={generate} disabled={generating || !prompt.trim()}>
              {generating ? 'Generating…' : '⚡ Generate  ⌘↵'}
            </button>

            {error && (
              <div style={styles.errorBox}>
                <strong>Error:</strong> {error}
                {error.includes('7860') && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                    Start AUTOMATIC1111:<br />
                    <code style={{ color: '#a78bfa' }}>cd ~/stable-diffusion-webui && ./webui.sh --api --listen</code>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: canvas ── */}
          <div style={styles.canvas}>
            {generating ? (
              <div style={styles.spinnerWrap}><Spinner /></div>
            ) : selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
                {/* Main image */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={`data:image/png;base64,${selected.b64}`}
                    alt={selected.prompt}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
                  />
                </div>
                {/* Controls under image */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexShrink: 0 }}>
                  <button onClick={() => downloadImage(selected.b64, `crane-${selected.ts}.png`)}
                    style={styles.imgBtn}>⬇ Download</button>
                  <button onClick={() => setPrompt(selected.prompt)}
                    style={styles.imgBtn}>↺ Remix</button>
                  <button onClick={() => setSelected(null)}
                    style={styles.imgBtn}>✕ Clear</button>
                </div>
                <p style={{ color: '#555', fontSize: 12, textAlign: 'center', margin: 0 }}>
                  {selected.prompt}
                </p>
              </div>
            ) : images.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={{ fontSize: 64, marginBottom: 16 }}>🎨</div>
                <div style={{ color: '#555', fontSize: 14 }}>
                  Enter a prompt and hit Generate — or tell Miranda:
                </div>
                <div style={{ color: '#7c3aed', fontSize: 13, marginTop: 8, fontStyle: 'italic' }}>
                  "Generate an image of a cyberpunk city at night"
                </div>
                {models.length === 0 && (
                  <div style={{ marginTop: 24, color: '#555', fontSize: 12, textAlign: 'center' }}>
                    ⚠ AUTOMATIC1111 not detected on port 7860<br />
                    <code style={{ color: '#a78bfa' }}>./webui.sh --api --listen</code>
                  </div>
                )}
              </div>
            ) : null}

            {/* Thumbnail strip */}
            {images.length > 0 && !generating && (
              <div style={styles.thumbStrip}>
                {images.map((img, i) => (
                  <img
                    key={i}
                    className={`img-thumb ${selected === img ? 'active' : ''}`}
                    src={`data:image/png;base64,${img.b64}`}
                    alt=""
                    style={{ width: 72, height: 72, objectFit: 'cover' }}
                    onClick={() => setSelected(img)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── History tab ── */
        <div style={{ padding: 24 }}>
          <button onClick={loadHistory} style={{ ...styles.imgBtn, marginBottom: 16 }}>↺ Refresh</button>
          {history.length === 0 ? (
            <div style={{ color: '#555', textAlign: 'center', paddingTop: 64 }}>
              No image history yet. Generate something first.
            </div>
          ) : (
            <table style={styles.histTable}>
              <thead>
                <tr style={{ color: '#666', fontSize: 12, textTransform: 'uppercase' }}>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>Prompt</th>
                  <th style={styles.th}>Model</th>
                  <th style={styles.th}>Size</th>
                  <th style={styles.th}>Steps</th>
                  <th style={styles.th}>CFG</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={styles.td}>{new Date(h.ts * 1000).toLocaleTimeString()}</td>
                    <td style={{ ...styles.td, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.prompt}</td>
                    <td style={styles.td}>{h.model || '—'}</td>
                    <td style={styles.td}>{h.width}×{h.height}</td>
                    <td style={styles.td}>{h.steps}</td>
                    <td style={styles.td}>{h.cfg_scale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#0d0d0d', color: '#ddd', fontFamily: 'system-ui, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 20px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
  },
  body: {
    display: 'flex', flex: 1, overflow: 'hidden',
  },
  controls: {
    width: 280, flexShrink: 0, padding: 20, overflowY: 'auto',
    borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 16,
  },
  ctrlSection: {
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  sectionLabel: {
    fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  promptBox: {
    width: '100%', background: '#111', color: '#ddd', border: '1px solid #2a2a2a',
    borderRadius: 6, padding: '8px 10px', fontSize: 13, resize: 'vertical',
    fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
  },
  canvas: {
    flex: 1, display: 'flex', flexDirection: 'column', padding: 20,
    overflow: 'hidden', position: 'relative',
  },
  spinnerWrap: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  emptyState: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', color: '#444',
  },
  thumbStrip: {
    display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12,
    borderTop: '1px solid #1a1a1a', flexShrink: 0,
  },
  errorBox: {
    background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: 6,
    padding: '10px 14px', fontSize: 13, color: '#f87171',
  },
  imgBtn: {
    background: '#1a1a1a', border: '1px solid #333', color: '#ccc',
    padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
  },
  histTable: {
    width: '100%', borderCollapse: 'collapse', fontSize: 13,
  },
  th: {
    textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #222',
  },
  td: {
    padding: '8px 12px', color: '#aaa',
  },
};
