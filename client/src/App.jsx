import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatRoom from './components/ChatRoom';
import AuditLog from './components/AuditLog';
import Controls from './components/Controls';
import TaskBoard from './components/TaskBoard';
import FileViewer from './components/FileViewer';
import SearchPanel from './components/SearchPanel';
import DecisionLog from './components/DecisionLog';
import AgentProfile from './components/AgentProfile';
import './App.css';

export default function App() {
  const [channel, setChannel] = useState('main');
  const [panel, setPanel] = useState('chat');
  const [profileAgent, setProfileAgent] = useState(null);
  const [agents, setAgents] = useState({});

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(list => {
      const m = {};
      list.forEach(a => { m[a.id] = a; });
      setAgents(m);
    });
  }, []);

  return (
    <div className="app">
      <Sidebar
        currentChannel={channel}
        onSelectChannel={(ch) => { setChannel(ch); setPanel('chat'); }}
        onAgentClick={(id) => setProfileAgent(id)}
      />
      <div className="main-area">
        <div className="panel-tabs">
          <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>💬 Chat</button>
          <button className={panel === 'tasks' ? 'active' : ''} onClick={() => setPanel('tasks')}>📋 Tasks</button>
          <button className={panel === 'files' ? 'active' : ''} onClick={() => setPanel('files')}>📁 Files</button>
          <button className={panel === 'search' ? 'active' : ''} onClick={() => setPanel('search')}>🔍 Search</button>
          <button className={panel === 'decisions' ? 'active' : ''} onClick={() => setPanel('decisions')}>📌 Decisions</button>
          <button className={panel === 'audit' ? 'active' : ''} onClick={() => setPanel('audit')}>📊 Audit</button>
          <button className={panel === 'controls' ? 'active' : ''} onClick={() => setPanel('controls')}>⚙️ Controls</button>
        </div>
        {panel === 'chat' && <ChatRoom channel={channel} />}
        {panel === 'tasks' && <TaskBoard />}
        {panel === 'files' && <FileViewer />}
        {panel === 'search' && <SearchPanel agents={agents} onJumpToChannel={(ch) => { setChannel(ch); setPanel('chat'); }} />}
        {panel === 'decisions' && <DecisionLog />}
        {panel === 'audit' && <AuditLog />}
        {panel === 'controls' && <Controls />}
      </div>

      {profileAgent && (
        <AgentProfile agentId={profileAgent} onClose={() => setProfileAgent(null)} />
      )}
    </div>
  );
}
