import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = 'http://localhost:8002';

// ── Miranda personas visible on-screen ───────────────────────────────────────
const ROLES = ['Engineer', 'Researcher', 'Strategist', 'Creator', 'Debugger'];

export function VoiceStudio() {
  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [role, setRole] = useState('Engineer');
  const [waveform, setWaveform] = useState(Array(32).fill(2));
  const [history, setHistory] = useState([]); // [{role:'user'|'miranda', text, ts}]
  const [actions, setActions] = useState([]); // non-hideable action log
  const [textInput, setTextInput] = useState('');
  const [sessionId] = useState(() => crypto.randomUUID());
  const mediaRef = useRef(null);
  const animRef = useRef(null);
  const transcriptRef = useRef('');
  const historyEndRef = useRef(null);
  const inputRef = useRef(null);

  // Waveform animation
  useEffect(() => {
    if (status === 'listening') {
      animRef.current = setInterval(() => {
        setWaveform(Array.from({ length: 32 }, () => 2 + Math.random() * 46));
      }, 60);
    } else if (status === 'speaking') {
      animRef.current = setInterval(() => {
        setWaveform(Array.from({ length: 32 }, () => 2 + Math.random() * 22));
      }, 100);
    } else {
      clearInterval(animRef.current);
      setWaveform(Array(32).fill(2));
    }
    return () => clearInterval(animRef.current);
  }, [status]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const logAction = (text) => {
    const entry = { id: Date.now(), text, time: new Date().toLocaleTimeString() };
    setActions(prev => [entry, ...prev].slice(0, 8));
  };

  const addHistory = (role, text) => {
    setHistory(prev => [...prev, { role, text, ts: Date.now() }]);
  };

  // ── Audio helpers ─────────────────────────────────────────────────────────
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const playAudioB64 = (b64) => {
    setStatus('speaking');
    const audio = new Audio(`data:audio/mp3;base64,${b64}`);
    audio.onended = () => setStatus('idle');
    audio.onerror = () => setStatus('idle');
    audio.play().catch(() => setStatus('idle'));
  };

  const speakWithBrowser = (text) => {
    setStatus('speaking');
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.93;
    utter.pitch = 0.85;
    const voices = speechSynthesis.getVoices();
    const female = voices.find(v =>
      /female|woman|girl|zira|samantha|victoria|karen|moira|tessa|fiona/i.test(v.name)
    );
    if (female) utter.voice = female;
    utter.onend = () => setStatus('idle');
    utter.onerror = () => setStatus('idle');
    speechSynthesis.speak(utter);
  };

  // ── Send to Miranda backend ───────────────────────────────────────────────
  const sendToMiranda = useCallback(async (text) => {
    if (!text?.trim()) { setStatus('idle'); return; }
    setStatus('thinking');
    addHistory('user', text);
    setTranscript('');

    try {
      const res = await fetch(`${API}/api/miranda/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'generation failed');

      const reply = data.data?.response || data.data || '';
      setResponse(reply);
      addHistory('miranda', reply);
      logAction(`Miranda responded (${role} mode)`);

      // Try local TTS
      const ttsRes = await fetch(`${API}/api/miranda/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      });
      const ttsData = await ttsRes.json();
      if (ttsData.success && ttsData.data?.audio_b64) {
        playAudioB64(ttsData.data.audio_b64);
      } else {
        speakWithBrowser(reply);
      }
    } catch (e) {
      const fallback = "I'm here — my reasoning engine isn't connected yet, but I can still hear you.";
      setResponse(fallback);
      addHistory('miranda', fallback);
      speakWithBrowser(fallback);
    }
  }, [sessionId, role]);

  // ── Browser SR fallback ───────────────────────────────────────────────────
  const startBrowserSR = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('idle'); return; }
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      setTranscript(t);
      transcriptRef.current = t;
    };
    recognition.onend = async () => {
      const final = transcriptRef.current;
      transcriptRef.current = '';
      if (final.trim()) await sendToMiranda(final);
      else setStatus('idle');
    };
    recognition.onerror = () => setStatus('idle');
    recognition.start();
    mediaRef.current = { type: 'browser-sr', recognition };
  };

  // ── Start / stop mic ──────────────────────────────────────────────────────
  const startListening = async () => {
    setStatus('listening');
    setTranscript('');
    setResponse('');
    transcriptRef.current = '';

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      startBrowserSR();
      return;
    }

    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setStatus('thinking');
      const blob = new Blob(chunks, { type: mimeType });
      let transcribed = null;
      try {
        const b64 = await blobToBase64(blob);
        const res = await fetch(`${API}/api/miranda/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_b64: b64, mime_type: mimeType }),
        });
        const data = await res.json();
        if (data.success && data.data?.transcript) transcribed = data.data.transcript;
      } catch {}
      if (transcribed) {
        setTranscript(transcribed);
        await sendToMiranda(transcribed);
      } else {
        startBrowserSR();
      }
    };
    recorder.start();
    mediaRef.current = { type: 'media', recorder };
  };

  const stopListening = () => {
    if (!mediaRef.current) return;
    if (mediaRef.current.type === 'media') mediaRef.current.recorder.stop();
    else if (mediaRef.current.type === 'browser-sr') mediaRef.current.recognition.stop();
    mediaRef.current = null;
  };

  const handleMicClick = () => {
    if (status === 'listening') stopListening();
    else if (status === 'idle') startListening();
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    setTextInput('');
    await sendToMiranda(text);
  };

  // ── Status label ─────────────────────────────────────────────────────────
  const statusLabel = {
    idle: 'Ready',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }[status];

  const statusColor = {
    idle: '#475569',
    listening: '#22c55e',
    thinking: '#a78bfa',
    speaking: '#38bdf8',
  }[status];

  return (
    <div style={s.page}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .mic-btn { transition: all 0.2s; }
        .mic-btn:hover:not(:disabled) { transform: scale(1.06); }
        .mic-btn:active:not(:disabled) { transform: scale(0.96); }
        .history-msg { animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .role-chip { cursor:pointer; transition: all 0.15s; border-radius:20px; padding:4px 12px;
          font-size:12px; border:1px solid #334155; }
        .role-chip:hover { border-color:#7c3aed; color:#c4b5fd; }
        .role-chip.active { background:#1e1b4b; border-color:#7c3aed; color:#a78bfa; }
        .send-btn { background:#7c3aed; color:white; border:none; border-radius:8px;
          padding:0 18px; cursor:pointer; font-size:14px; transition:background 0.15s; }
        .send-btn:hover { background:#6d28d9; }
        .send-btn:disabled { opacity:0.4; cursor:default; }
      `}</style>

      {/* ── Left: conversation ── */}
      <div style={s.left}>

        {/* Header */}
        <div style={s.leftHeader}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, color: '#e2e8f0', letterSpacing: '-0.01em' }}>
              Miranda
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Voice Agent Studio
            </div>
          </div>
          {/* Role selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ROLES.map(r => (
              <button key={r} className={`role-chip ${role === r ? 'active' : ''}`}
                style={{ background: 'none', color: role === r ? '#a78bfa' : '#64748b' }}
                onClick={() => setRole(r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Conversation history */}
        <div style={s.historyArea}>
          {history.length === 0 && (
            <div style={s.emptyState}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎙️</div>
              <div style={{ color: '#475569', fontSize: 15 }}>
                Press the mic or type to talk to Miranda
              </div>
              <div style={{ color: '#334155', fontSize: 13, marginTop: 8 }}>
                She hears you, thinks, and speaks back
              </div>
            </div>
          )}
          {history.map((msg, i) => (
            <div key={i} className="history-msg" style={{
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              gap: 10, marginBottom: 16, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: msg.role === 'user' ? '#1e3a5f' : '#1e1b4b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}>
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div style={{
                maxWidth: '72%', padding: '10px 14px', borderRadius: 12,
                background: msg.role === 'user' ? '#0f2744' : '#13111c',
                border: msg.role === 'user' ? '1px solid #1e3a5f' : '1px solid #1e1b4b',
                fontSize: 14, color: '#cbd5e1', lineHeight: 1.5,
                borderTopRightRadius: msg.role === 'user' ? 4 : 12,
                borderTopLeftRadius: msg.role === 'miranda' ? 4 : 12,
              }}>
                {msg.text}
              </div>
            </div>
          ))}
          {/* Thinking indicator */}
          {status === 'thinking' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1e1b4b',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤖</div>
              <div style={{ padding: '12px 16px', background: '#13111c', border: '1px solid #1e1b4b',
                borderRadius: 12, borderTopLeftRadius: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%', background: '#7c3aed',
                      animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={historyEndRef} />
        </div>

        {/* Live transcript while listening */}
        {transcript && status === 'listening' && (
          <div style={s.liveTranscript}>{transcript}</div>
        )}

        {/* Text input */}
        <form onSubmit={handleSend} style={s.inputRow}>
          <input
            ref={inputRef}
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder={status !== 'idle' ? statusLabel : 'Type a message or press the mic…'}
            disabled={status !== 'idle'}
            style={s.textInput}
          />
          <button type="submit" className="send-btn" disabled={!textInput.trim() || status !== 'idle'}>
            Send
          </button>
        </form>
      </div>

      {/* ── Right: controls ── */}
      <div style={s.right}>

        {/* Big mic button */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <button
            className="mic-btn"
            onClick={handleMicClick}
            disabled={status === 'thinking' || status === 'speaking'}
            style={{
              width: 120, height: 120, borderRadius: '50%', border: 'none',
              background: status === 'listening'
                ? 'radial-gradient(circle, #16a34a, #15803d)'
                : status === 'thinking' || status === 'speaking'
                ? 'radial-gradient(circle, #1e1b4b, #1e1b4b)'
                : 'radial-gradient(circle, #4c1d95, #3b0764)',
              cursor: status === 'thinking' || status === 'speaking' ? 'default' : 'pointer',
              fontSize: 44,
              boxShadow: status === 'listening'
                ? '0 0 0 12px rgba(22,163,74,0.15), 0 0 0 24px rgba(22,163,74,0.07)'
                : status === 'speaking'
                ? '0 0 0 12px rgba(56,189,248,0.15)'
                : '0 0 0 8px rgba(124,58,237,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
          >
            {status === 'thinking' ? (
              <div style={{ width: 32, height: 32, border: '3px solid #4c1d95',
                borderTop: '3px solid #a78bfa', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite' }} />
            ) : status === 'speaking' ? '🔊' : status === 'listening' ? '🔴' : '🎙️'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: statusColor, fontWeight: 600,
              animation: status !== 'idle' ? 'pulse 2s ease-in-out infinite' : 'none' }}>
              {statusLabel}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              {status === 'listening' ? 'Click to stop' : status === 'idle' ? 'Click to speak' : '…'}
            </div>
          </div>
        </div>

        {/* Waveform */}
        <div style={s.waveformWrap}>
          {waveform.map((h, i) => (
            <div key={i} style={{
              width: 3, borderRadius: 2,
              height: `${h}px`,
              background: status === 'listening'
                ? `rgba(34,197,94,${0.4 + (h / 48) * 0.6})`
                : status === 'speaking'
                ? `rgba(56,189,248,${0.4 + (h / 48) * 0.6})`
                : `rgba(100,116,139,${0.3 + (h / 48) * 0.4})`,
              transition: 'height 0.06s ease',
            }} />
          ))}
        </div>

        {/* Current role */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Current Mode
          </div>
          <div style={{ fontSize: 16, color: '#a78bfa', fontWeight: 600, marginTop: 4 }}>
            {role}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '100%', height: 1, background: '#1e293b' }} />

        {/* Action log — non-hideable (autonomy requirement) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 10 }}>
            Action Log
          </div>
          {actions.length === 0 ? (
            <div style={{ fontSize: 12, color: '#334155' }}>No actions yet</div>
          ) : (
            actions.map(a => (
              <div key={a.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#475569' }}>{a.time}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{a.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  page: {
    display: 'flex', height: '100%', overflow: 'hidden',
    background: '#080c14', color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  left: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    borderRight: '1px solid #0f1929',
  },
  leftHeader: {
    padding: '20px 24px 16px', borderBottom: '1px solid #0f1929',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: 16, flexShrink: 0,
  },
  historyArea: {
    flex: 1, overflowY: 'auto', padding: '20px 24px',
  },
  emptyState: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', textAlign: 'center',
  },
  liveTranscript: {
    margin: '0 24px 12px', padding: '10px 14px',
    background: '#0f172a', borderRadius: 8, fontSize: 13,
    color: '#94a3b8', fontStyle: 'italic', border: '1px solid #1e293b',
    flexShrink: 0,
  },
  inputRow: {
    display: 'flex', gap: 10, padding: '12px 24px 20px', flexShrink: 0,
    borderTop: '1px solid #0f1929',
  },
  textInput: {
    flex: 1, background: '#0f172a', border: '1px solid #1e293b',
    borderRadius: 8, padding: '10px 14px', color: '#e2e8f0', fontSize: 14,
    outline: 'none',
  },
  right: {
    width: 220, flexShrink: 0, padding: '28px 20px',
    display: 'flex', flexDirection: 'column', gap: 24,
    background: '#06090f',
  },
  waveformWrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 3, height: 56, flexShrink: 0,
  },
};
