import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { FileEditor } from './FileEditor';
import './index.css';

const API = 'http://localhost:8002';

// ===== Miranda Voice Panel =====

// Detect project-creation voice commands.
// Returns { name, containerized } or null.
function parseCreateProject(text) {
  // Catches: "create [a/new] [rust/python/go/js] project [called/named] <name>"
  // Also: "make/start/build a project called <name>", "spin up a project <name>"
  const m = text.match(
    /(?:create|make|start|build|spin\s+up)\s+(?:a\s+)?(?:new\s+)?(?:rust|python|go|js|javascript|node|typescript)?\s*project\s+(?:called|named|for me called|for me named)?\s*['"]?([\w][\w-]*)['"]?/i
  );
  if (!m) return null;
  return {
    name: m[1].toLowerCase().replace(/\s+/g, '-'),
    containerized: /container|podman|docker/i.test(text),
  };
}

function MirandaVoicePanel({ isOpen, onToggle, onProjectCreated }) {
  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [sessionId] = useState(() => crypto.randomUUID());
  const [memoryNote, setMemoryNote] = useState(null);
  const [waveform, setWaveform] = useState(Array(12).fill(4));
  const [actions, setActions] = useState([]); // visible action log (autonomy requirement)
  const mediaRef = useRef(null);
  const animRef = useRef(null);
  const transcriptRef = useRef('');

  const logAction = (text) => {
    const entry = { id: Date.now(), text, time: new Date().toLocaleTimeString() };
    setActions(prev => [entry, ...prev].slice(0, 8)); // keep last 8
  };

  // Fake waveform animation when listening
  useEffect(() => {
    if (status === 'listening') {
      animRef.current = setInterval(() => {
        setWaveform(Array.from({ length: 12 }, () => 4 + Math.random() * 28));
      }, 80);
    } else {
      clearInterval(animRef.current);
      setWaveform(Array(12).fill(4));
    }
    return () => clearInterval(animRef.current);
  }, [status]);

  // Convert Blob to base64 string
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  // Play base64-encoded MP3 audio
  const playAudioB64 = (b64) => {
    const audio = new Audio(`data:audio/mp3;base64,${b64}`);
    audio.onended = () => setStatus('idle');
    audio.onerror = () => setStatus('idle');
    audio.play().catch(() => setStatus('idle'));
    return audio;
  };

  // Browser SpeechSynthesis fallback
  const speakWithBrowser = (text) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 0.88;
    const voices = speechSynthesis.getVoices();
    const female = voices.find(v => /female|woman|girl|zira|samantha|victoria|karen/i.test(v.name));
    if (female) utter.voice = female;
    utter.onend = () => setStatus('idle');
    speechSynthesis.speak(utter);
  };

  // Browser SpeechRecognition fallback
  const startBrowserSR = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscript('No speech input available. Type your message.');
      setStatus('idle');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setTranscript(text);
      transcriptRef.current = text;
    };
    recognition.onend = async () => {
      const finalText = transcriptRef.current;
      transcriptRef.current = '';
      if (finalText.trim()) await sendToMiranda(finalText);
      else setStatus('idle');
    };
    recognition.onerror = () => setStatus('idle');
    recognition.start();
    mediaRef.current = { type: 'browser-sr', recognition };
  };

  const startListening = async () => {
    setStatus('listening');
    setTranscript('');
    setResponse('');
    transcriptRef.current = '';

    // Try MediaRecorder (real audio for Parakeet ASR)
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (_) {
      // Mic access denied — fall back to browser SR
      startBrowserSR();
      return;
    }

    const chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      setStatus('thinking');

      const blob = new Blob(chunks, { type: mimeType });
      let transcript = null;

      // Try Parakeet ASR on backend
      try {
        const b64 = await blobToBase64(blob);
        const res = await fetch(`${API}/api/miranda/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_b64: b64 }),
        });
        const data = await res.json();
        if (data.success && data.data?.transcript?.trim()) {
          transcript = data.data.transcript;
          setTranscript(transcript);
        }
      } catch (_) {}

      if (transcript) {
        await sendToMiranda(transcript);
      } else {
        // Parakeet not up yet — fall back to browser SR
        setStatus('listening');
        startBrowserSR();
      }
    };

    recorder.start();
    mediaRef.current = { type: 'media', recorder, stream };
  };

  const stopListening = () => {
    if (!mediaRef.current) return;
    if (mediaRef.current.type === 'media') {
      mediaRef.current.recorder.stop();
    } else if (mediaRef.current.type === 'browser-sr') {
      mediaRef.current.recognition.stop();
    }
    setStatus('thinking');
  };

  const sendToMiranda = async (text) => {
    if (!text?.trim()) { setStatus('idle'); return; }
    setStatus('thinking');

    // ── Voice command detection (runs before LLM so Miranda can acknowledge) ──
    let commandContext = '';
    const cmd = parseCreateProject(text);
    if (cmd) {
      try {
        const res = await fetch(`${API}/api/projects/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cmd.name, language: 'rust', containerized: cmd.containerized }),
        });
        const data = await res.json();
        if (data.success) {
          logAction(`Created project: ${cmd.name}`);
          commandContext = ` [ACTION COMPLETED: Created Rust project '${cmd.name}' successfully]`;
          if (onProjectCreated) onProjectCreated(data.data);
        } else {
          commandContext = ` [ACTION FAILED: ${data.error}]`;
        }
      } catch (e) {
        commandContext = ` [ACTION FAILED: ${e.message}]`;
      }
    }

    try {
      const res = await fetch(`${API}/api/miranda/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text + commandContext, session_id: sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        const responseText = data.data.response;
        setResponse(responseText);
        setStatus('speaking');

        // Try backend TTS (VibeVoice/Kokoro) first
        let ttsHandled = false;
        try {
          const ttsRes = await fetch(`${API}/api/miranda/speak`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: responseText }),
          });
          const ttsData = await ttsRes.json();
          if (ttsData.success && ttsData.data?.audio_b64) {
            playAudioB64(ttsData.data.audio_b64);
            ttsHandled = true;
          }
        } catch (_) {}

        if (!ttsHandled) speakWithBrowser(responseText);
      } else {
        setResponse(data.error || 'Miranda is offline. Check localhost:8003.');
        setStatus('idle');
      }
    } catch (err) {
      setResponse(`Connection error: ${err.message}`);
      setStatus('idle');
    }
  };

  const statusColors = { idle: '#64748b', listening: '#3b82f6', thinking: '#f59e0b', speaking: '#10b981' };
  const statusLabels = { idle: '🎤 Ready', listening: '🎧 Listening...', thinking: '💭 Thinking...', speaking: '🗣️ Speaking...' };

  if (!isOpen) {
    return (
      <button onClick={onToggle} style={{
        width: '100%', padding: '10px', background: 'rgba(59,130,246,0.15)',
        border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px',
        color: '#94a3b8', cursor: 'pointer', fontSize: '12px', textAlign: 'left'
      }}>
        🎤 Miranda — click to open
      </button>
    );
  }

  return (
    <div style={{
      background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(59,130,246,0.3)',
      borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#e2e8f0', letterSpacing: '0.1em' }}>MIRANDA</span>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}>×</button>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[status],
          boxShadow: status !== 'idle' ? `0 0 6px ${statusColors[status]}` : 'none' }} />
        <span style={{ fontSize: '11px', color: statusColors[status] }}>{statusLabels[status]}</span>
      </div>

      {/* Waveform */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px' }}>
        {waveform.map((h, i) => (
          <div key={i} style={{
            flex: 1, height: `${h}px`, background: statusColors[status],
            borderRadius: '2px', transition: 'height 0.1s ease', opacity: 0.8
          }} />
        ))}
      </div>

      {/* Transcript */}
      {transcript && (
        <div style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(148,163,184,0.1)',
          padding: '6px 8px', borderRadius: '4px', maxHeight: '60px', overflowY: 'auto' }}>
          <span style={{ color: '#60a5fa' }}>You: </span>{transcript}
        </div>
      )}

      {/* Response */}
      {response && (
        <div style={{ fontSize: '11px', color: '#e2e8f0', background: 'rgba(59,130,246,0.1)',
          padding: '6px 8px', borderRadius: '4px', maxHeight: '80px', overflowY: 'auto',
          borderLeft: '2px solid #3b82f6' }}>
          <span style={{ color: '#34d399' }}>Miranda: </span>{response}
        </div>
      )}

      {memoryNote && (
        <div style={{ fontSize: '10px', color: '#f59e0b' }}>📚 {memoryNote}</div>
      )}

      {/* Action log — always visible, non-hideable (autonomy requirement) */}
      {actions.length > 0 && (
        <div style={{ fontSize: '10px', color: '#64748b', borderTop: '1px solid rgba(100,116,139,0.2)', paddingTop: '6px' }}>
          <div style={{ color: '#475569', marginBottom: '3px', fontWeight: '600', letterSpacing: '0.05em' }}>ACTIONS</div>
          {actions.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
              <span style={{ color: '#334155' }}>{a.time}</span>
              <span style={{ color: '#10b981' }}>✓</span>
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {status === 'idle' && (
          <button onClick={startListening} style={{
            flex: 1, padding: '8px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
            border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer',
            fontSize: '12px', fontWeight: '600'
          }}>🎤 Speak</button>
        )}
        {status === 'listening' && (
          <button onClick={stopListening} style={{
            flex: 1, padding: '8px', background: '#ef4444', border: 'none',
            borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
          }}>⏹ Done</button>
        )}
        {(status === 'thinking' || status === 'speaking') && (
          <button disabled style={{
            flex: 1, padding: '8px', background: '#374151', border: 'none',
            borderRadius: '6px', color: '#9ca3af', fontSize: '12px'
          }}>{status === 'thinking' ? '⏳ ...' : '🔊 Speaking'}</button>
        )}
      </div>
    </div>
  );
}

// ===== Left Sidebar =====

function Sidebar({ projects, currentProject, onSelectProject, onNewProject, onProjectCreated }) {
  const [mirandaOpen, setMirandaOpen] = useState(true);

  return (
    <div style={{
      width: '220px', minWidth: '220px', background: '#1e293b',
      borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column',
      height: '100%'
    }}>
      {/* Logo */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #334155',
        display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px' }}>🏗️</span>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#e2e8f0', letterSpacing: '0.05em' }}>CRANE</span>
      </div>

      {/* Project list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        <div style={{ fontSize: '10px', color: '#64748b', padding: '4px 8px',
          textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Projects</div>
        {projects.map(p => (
          <div key={p.name}
            onClick={() => onSelectProject(p.name)}
            style={{
              padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
              background: currentProject === p.name ? 'rgba(59,130,246,0.2)' : 'transparent',
              borderLeft: currentProject === p.name ? '2px solid #3b82f6' : '2px solid transparent',
              color: currentProject === p.name ? '#93c5fd' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { if (currentProject !== p.name) e.currentTarget.style.background = 'rgba(148,163,184,0.1)'; }}
            onMouseLeave={e => { if (currentProject !== p.name) e.currentTarget.style.background = 'transparent'; }}>
            <div style={{ fontWeight: '600' }}>{p.name}</div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>
              {p.containerized ? '📦 podman' : '💻 local'}
            </div>
          </div>
        ))}
        <button onClick={onNewProject} style={{
          width: '100%', padding: '8px', marginTop: '8px',
          background: 'rgba(59,130,246,0.1)', border: '1px dashed rgba(59,130,246,0.4)',
          borderRadius: '6px', color: '#60a5fa', cursor: 'pointer', fontSize: '12px'
        }}>+ New Project</button>
      </div>

      {/* Miranda panel at the bottom */}
      <div style={{ padding: '8px', borderTop: '1px solid #334155' }}>
        <MirandaVoicePanel isOpen={mirandaOpen} onToggle={() => setMirandaOpen(o => !o)} onProjectCreated={onProjectCreated} />
      </div>
    </div>
  );
}

// ===== New Project Modal =====

function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [containerized, setContainerized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, language: 'rust', containerized }),
      });
      const data = await res.json();
      if (data.success) {
        onCreated(data.data);
      } else {
        setError(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
        padding: '32px', width: '400px', color: '#e2e8f0'
      }}>
        <h2 style={{ margin: '0 0 24px', fontSize: '18px' }}>New Project</h2>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)} placeholder="project-name"
          onKeyDown={e => e.key === 'Enter' && !loading && handleCreate()}
          autoFocus disabled={loading}
          style={{
            width: '100%', padding: '10px 12px', marginBottom: '16px', boxSizing: 'border-box',
            background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.3)',
            borderRadius: '6px', color: '#e2e8f0', fontSize: '14px', outline: 'none'
          }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', cursor: 'pointer' }}>
          <input type="checkbox" checked={containerized} onChange={e => setContainerized(e.target.checked)} disabled={loading} />
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>📦 Run in Podman container</span>
        </label>
        {error && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '16px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={{
            padding: '8px 16px', background: 'rgba(148,163,184,0.2)', border: 'none',
            borderRadius: '6px', color: '#94a3b8', cursor: 'pointer'
          }}>Cancel</button>
          <button onClick={handleCreate} disabled={loading || !name.trim()} style={{
            padding: '8px 20px',
            background: loading || !name.trim() ? '#374151' : 'linear-gradient(135deg,#3b82f6,#2563eb)',
            border: 'none', borderRadius: '6px', color: 'white', cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '600'
          }}>
            {loading ? '⏳ Creating...' : '✅ Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Splash (no project selected) =====

function Splash({ onNewProject }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '16px', color: '#64748b' }}>
      <div style={{ fontSize: '48px', opacity: 0.4 }}>🏗️</div>
      <div style={{ fontSize: '14px' }}>Select a project or create a new one</div>
      <button onClick={onNewProject} style={{
        padding: '10px 20px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)',
        border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer',
        fontSize: '14px', fontWeight: '600'
      }}>✨ New Project</button>
    </div>
  );
}

// ===== App root =====

function App() {
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/projects`)
      .then(r => r.json())
      .then(d => setProjects(d.data || []))
      .catch(() => {});
  }, []);

  const handleCreated = (project) => {
    setProjects(prev => [...prev, project]);
    setCurrentProject(project.name);
    setShowNewProject(false);
  };

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: '#0f172a', color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, monospace'
    }}>
      <Sidebar
        projects={projects}
        currentProject={currentProject}
        onSelectProject={setCurrentProject}
        onNewProject={() => setShowNewProject(true)}
        onProjectCreated={handleCreated}
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {currentProject
          ? <FileEditor projectName={currentProject} />
          : <Splash onNewProject={() => setShowNewProject(true)} />
        }
      </div>

      {showNewProject && (
        <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
