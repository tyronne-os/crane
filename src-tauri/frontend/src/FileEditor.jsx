import React, { useState, useEffect } from 'react';

export function FileEditor({ projectName }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (projectName) {
      loadProjectTree();
    }
  }, [projectName]);

  const loadProjectTree = async () => {
    try {
      const response = await fetch(`http://localhost:8002/api/files/tree?project=${projectName}`);
      const data = await response.json();
      setFiles(data.data || data.tree || []);
    } catch (err) {
      console.error('Error loading file tree:', err);
    }
  };

  const loadFile = async (filePath) => {
    setLoading(true);
    try {
      const response = await fetch(
        `http://localhost:8002/api/files/read?project=${projectName}&path=${encodeURIComponent(filePath)}`
      );
      const data = await response.json();
      setFileContent(data.data?.content || data.content || '');
      setSelectedFile(filePath);
    } catch (err) {
      console.error('Error loading file:', err);
      setFileContent(`Error loading file: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    try {
      await fetch(`http://localhost:8002/api/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: projectName,
          path: selectedFile,
          content: fileContent
        })
      });
      alert('File saved!');
    } catch (err) {
      alert('Error saving file: ' + err.message);
    }
  };

  const toggleDir = (path) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const FileTreeNode = ({ node, depth = 0 }) => (
    <div style={{ marginLeft: `${depth * 16}px` }}>
      <div
        onClick={() => {
          if (node.type === 'dir') {
            toggleDir(node.path);
          } else {
            loadFile(node.path);
          }
        }}
        style={{
          padding: '6px 8px',
          cursor: 'pointer',
          background: selectedFile === node.path ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
          borderLeft: selectedFile === node.path ? '2px solid #3b82f6' : 'none',
          fontSize: '12px',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
      >
        {node.type === 'dir' ? (
          expandedDirs.has(node.path) ? '▼' : '▶'
        ) : (
          '📄'
        )}
        <span>{node.name}</span>
      </div>
      {node.type === 'dir' && expandedDirs.has(node.path) && node.children && (
        <div>
          {node.children.map((child, i) => (
            <FileTreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      background: '#0f172a',
      color: '#e2e8f0'
    }}>
      {/* File Tree */}
      <div style={{
        width: '250px',
        background: '#1e293b',
        borderRight: '1px solid #334155',
        overflowY: 'auto',
        padding: '12px'
      }}>
        <h3 style={{ fontSize: '12px', margin: '0 0 12px 0', color: '#94a3b8' }}>
          {projectName}
        </h3>
        {files.map((node, i) => (
          <FileTreeNode key={i} node={node} />
        ))}
      </div>

      {/* Editor */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#0f172a'
      }}>
        {selectedFile ? (
          <>
            <div style={{
              background: '#1e293b',
              borderBottom: '1px solid #334155',
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '12px' }}>{selectedFile}</span>
              <button
                onClick={saveFile}
                style={{
                  padding: '6px 12px',
                  background: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                💾 Save
              </button>
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              style={{
                flex: 1,
                background: '#1e293b',
                color: '#e2e8f0',
                border: 'none',
                padding: '16px',
                fontFamily: 'monospace',
                fontSize: '13px',
                outline: 'none',
                resize: 'none'
              }}
            />
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b'
          }}>
            Select a file to view/edit
          </div>
        )}
      </div>
    </div>
  );
}
