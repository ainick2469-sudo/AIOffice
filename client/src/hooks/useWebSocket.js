import { useEffect, useRef, useCallback, useState } from 'react';

export default function useWebSocket(channel) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [typingAgents, setTypingAgents] = useState([]);
  const reconnectTimer = useRef(null);
  const typingTimers = useRef({});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/${channel}`);

    ws.onopen = () => {
      setConnected(true);
      console.log(`WS connected: #${channel}`);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'chat' && data.message) {
          setMessages(prev => [...prev, data.message]);
          // Clear typing for this agent
          if (data.message.sender !== 'user') {
            setTypingAgents(prev => prev.filter(a => a.agent_id !== data.message.sender));
          }
        } else if (data.type === 'system') {
          // System messages (release gate status, etc.)
          setMessages(prev => [...prev, {
            id: Date.now(),
            sender: 'system',
            content: data.content,
            msg_type: 'system',
            created_at: new Date().toISOString(),
          }]);
        } else if (data.type === 'typing') {
          setTypingAgents(prev => {
            if (prev.find(a => a.agent_id === data.agent_id)) return prev;
            return [...prev, { agent_id: data.agent_id, display_name: data.display_name }];
          });
          // Auto-clear typing after 30s
          if (typingTimers.current[data.agent_id]) clearTimeout(typingTimers.current[data.agent_id]);
          typingTimers.current[data.agent_id] = setTimeout(() => {
            setTypingAgents(prev => prev.filter(a => a.agent_id !== data.agent_id));
          }, 30000);
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log(`WS disconnected: #${channel}`);
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
    wsRef.current = ws;
  }, [channel]);

  useEffect(() => {
    setMessages([]);
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [channel, connect]);

  const send = useCallback((content, msgType = 'message') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        channel,
        content,
        msg_type: msgType,
      }));
    }
  }, [channel]);

  return { connected, messages, setMessages, send, typingAgents };
}
