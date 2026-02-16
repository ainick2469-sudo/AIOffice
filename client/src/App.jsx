import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatRoom from './components/ChatRoom';
import DashboardHome from './components/DashboardHome';
import AuditLog from './components/AuditLog';
import Controls from './components/Controls';
import TaskBoard from './components/TaskBoard';
import FileViewer from './components/FileViewer';
import SearchPanel from './components/SearchPanel';
import DecisionLog from './components/DecisionLog';
import AgentProfile from './components/AgentProfile';
import AgentConfig from './components/AgentConfig';
import ProjectPanel from './components/ProjectPanel';
import GitPanel from './components/GitPanel';
import './App.css';

export default function App() {
  const [channel, setChannel] = useState('main');
  const [panel, setPanel] = useState('home');
  const [profileAgent, setProfileAgent] = useState(null);
  const [agents, setAgents] = useState({});
  const [theme, setTheme] = useState(() => localStorage.getItem('ai-office-theme') || 'dark');
  const [auditCount, setAuditCount] = useState(0);

  const refreshAuditCount = () => {
    fetch('/api/audit/count')
      .then(r => (r.ok ? r.json() : { count: 0 }))
      .then(payload => setAuditCount(Number(payload?.count || 0)))
      .catch(() => setAuditCount(0));
  };

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(list => {
        const map = {};
        list.forEach((agent) => {
          map[agent.id] = agent;
        });
        setAgents(map);
      });
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('ai-office-theme', theme);
  }, [theme]);

  useEffect(() => {
    refreshAuditCount();
    const interval = setInterval(refreshAuditCount, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <Sidebar
        currentChannel={channel}
        theme={theme}
        onToggleTheme={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
        onSelectChannel={(ch) => {
          setChannel(ch);
          setPanel('chat');
        }}
        onAgentClick={(id) => setProfileAgent(id)}
      />

      <div className="main-area">
        <div className="panel-tabs">
          <button className={panel === 'home' ? 'active' : ''} onClick={() => setPanel('home')}>
            Home
          </button>
          <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>
            Chat
          </button>
          <button className={panel === 'tasks' ? 'active' : ''} onClick={() => setPanel('tasks')}>
            Tasks
          </button>
          <button className={panel === 'files' ? 'active' : ''} onClick={() => setPanel('files')}>
            Files
          </button>
          <button className={panel === 'search' ? 'active' : ''} onClick={() => setPanel('search')}>
            Search
          </button>
          <button className={panel === 'decisions' ? 'active' : ''} onClick={() => setPanel('decisions')}>
            Decisions
          </button>
          <button className={panel === 'audit' ? 'active' : ''} onClick={() => setPanel('audit')}>
            Audit ({auditCount})
          </button>
          <button className={panel === 'controls' ? 'active' : ''} onClick={() => setPanel('controls')}>
            Controls
          </button>
          <button className={panel === 'projects' ? 'active' : ''} onClick={() => setPanel('projects')}>
            Projects
          </button>
          <button className={panel === 'git' ? 'active' : ''} onClick={() => setPanel('git')}>
            Git
          </button>
          <button className={panel === 'agents' ? 'active' : ''} onClick={() => setPanel('agents')}>
            Agents
          </button>
        </div>

        {panel === 'home' && (
          <DashboardHome
            onJumpToChannel={(ch) => {
              setChannel(ch);
              setPanel('chat');
            }}
            onOpenTasks={() => setPanel('tasks')}
            onOpenDecisions={() => setPanel('decisions')}
          />
        )}
        {panel === 'chat' && <ChatRoom channel={channel} />}
        {panel === 'tasks' && <TaskBoard />}
        {panel === 'files' && <FileViewer />}
        {panel === 'search' && (
          <SearchPanel
            agents={agents}
            onJumpToChannel={(ch) => {
              setChannel(ch);
              setPanel('chat');
            }}
          />
        )}
        {panel === 'decisions' && <DecisionLog />}
        {panel === 'audit' && <AuditLog onAuditChanged={refreshAuditCount} />}
        {panel === 'controls' && <Controls />}
        {panel === 'projects' && <ProjectPanel channel={channel} />}
        {panel === 'git' && <GitPanel channel={channel} />}
        {panel === 'agents' && <AgentConfig />}
      </div>

      {profileAgent && (
        <AgentProfile key={profileAgent} agentId={profileAgent} onClose={() => setProfileAgent(null)} />
      )}
    </div>
  );
}
