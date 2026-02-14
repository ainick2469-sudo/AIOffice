import { useState } from 'react';
import MessageContent from './MessageContent';

export default function SearchPanel({ agents, onJumpToChannel }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    fetch(`/api/messages/search?q=${encodeURIComponent(query.trim())}`)
      .then(r => r.json())
      .then(data => { setResults(Array.isArray(data) ? data : []); setSearching(false); })
      .catch(() => setSearching(false));
  };

  const getSender = (msg) => {
    if (msg.sender === 'user') return { name: 'You', color: '#3B82F6', emoji: '🧑' };
    const agent = agents[msg.sender];
    return agent
      ? { name: agent.display_name, color: agent.color, emoji: agent.emoji || '🤖' }
      : { name: msg.sender, color: '#6B7280', emoji: '🤖' };
  };

  return (
    <div className="panel search-panel">
      <div className="panel-header">
        <h3>🔍 Search Messages</h3>
      </div>
      <form className="search-form" onSubmit={search}>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search all messages..." autoFocus />
        <button type="submit" disabled={searching}>{searching ? '...' : 'Search'}</button>
      </form>
      <div className="search-results">
        {results.length === 0 && query && !searching && (
          <div className="search-empty">No results for "{query}"</div>
        )}
        {results.map(msg => {
          const sender = getSender(msg);
          return (
            <div key={msg.id} className="search-result" onClick={() => onJumpToChannel?.(msg.channel)}>
              <div className="search-result-header">
                <span className="msg-emoji">{sender.emoji}</span>
                <span style={{ color: sender.color, fontWeight: 600, fontSize: 13 }}>{sender.name}</span>
                <span className="search-channel">#{msg.channel}</span>
                <span className="msg-time">{new Date(msg.created_at).toLocaleString()}</span>
              </div>
              <div className="search-result-body">
                <MessageContent content={msg.content} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
