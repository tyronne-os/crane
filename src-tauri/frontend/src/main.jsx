import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  const [view, setView] = useState('splash');
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [containerized, setContainerized] = useState(false);
  const [containerRuntime, setContainerRuntime] = useState('podman');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('http://localhost:8002/api/projects');
      const data = await response.json();
      setProjects(data.data || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8002/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName,
          language: 'rust',
          containerized,
          container_runtime: containerRuntime
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setProjects([...projects, data.data]);
        setNewProjectName('');
        setContainerized(false);
        setView('splash');
      }
    } catch (err) {
      alert('Failed to create project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      height: '100vh',
      background: 'linear-gradient(135deg, #0f172a, #1e293b)',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {view === 'splash' ? (
        <>
          <div style={{ fontSize: '80px', marginBottom: '20px', filter: 'drop-shadow(0 0 10px rgba(59, 130, 246, 0.5))' }}>🏗️</div>
          <h1 style={{ fontSize: '32px', marginBottom: '30px', fontWeight: '700' }}>CRANE</h1>
          
          {projects.length > 0 && (
            <div style={{ marginBottom: '30px', textAlign: 'center' }}>
              <h2 style={{ marginBottom: '15px', color: '#94a3b8' }}>Recent Projects</h2>
              <ul style={{ listStyle: 'none', padding: 0, minWidth: '400px' }}>
                {projects.map(p => (
                  <li key={p.name} style={{ 
                    padding: '12px 16px', 
                    margin: '8px 0', 
                    background: 'rgba(148, 163, 184, 0.1)',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }} 
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(148, 163, 184, 0.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)'}
                  onClick={() => alert('Opening: ' + p.name)}>
                    <span style={{ fontWeight: '600' }}>{p.name}</span>
                    <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
                      [{p.language}] {p.containerized ? `📦 ${p.container_runtime}` : '💻 local'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <button 
            onClick={() => setView('new')}
            style={{
              marginTop: '20px',
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)'}
          >
            ✨ New Project
          </button>
        </>
      ) : (
        <>
          <h2 style={{ marginBottom: '30px' }}>Create New Project</h2>
          
          <input
            type="text"
            placeholder="Project name (e.g., my-app)"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && handleCreateProject()}
            disabled={loading}
            style={{
              padding: '12px 16px',
              marginBottom: '20px',
              borderRadius: '8px',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              width: '350px',
              background: 'rgba(148, 163, 184, 0.1)',
              color: '#e2e8f0',
              fontSize: '14px',
              outline: 'none',
              transition: 'border 0.2s ease'
            }}
          />
          
          <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              id="containerized"
              checked={containerized}
              onChange={(e) => setContainerized(e.target.checked)}
              disabled={loading}
            />
            <label htmlFor="containerized" style={{ cursor: 'pointer', fontSize: '14px' }}>
              📦 Containerized (Podman/Docker)
            </label>
          </div>
          
          {containerized && (
            <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label htmlFor="runtime" style={{ fontSize: '14px' }}>Container runtime:</label>
              <select
                id="runtime"
                value={containerRuntime}
                onChange={(e) => setContainerRuntime(e.target.value)}
                disabled={loading}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(148, 163, 184, 0.1)',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="podman">🔒 Podman (safer, rootless)</option>
                <option value="docker">🐳 Docker (fallback)</option>
              </select>
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={handleCreateProject}
              disabled={loading}
              style={{
                padding: '12px 24px',
                background: loading ? '#94a3b8' : '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => !loading && (e.currentTarget.style.background = '#16a34a')}
              onMouseLeave={(e) => !loading && (e.currentTarget.style.background = '#22c55e')}
            >
              {loading ? '⏳ Creating...' : '✅ Create'}
            </button>
            <button 
              onClick={() => setView('splash')}
              disabled={loading}
              style={{
                padding: '12px 24px',
                background: 'rgba(148, 163, 184, 0.3)',
                color: '#e2e8f0',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '600'
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
