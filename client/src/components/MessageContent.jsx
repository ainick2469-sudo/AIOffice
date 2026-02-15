import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const RUNNABLE = new Set(['python', 'javascript', 'bash', 'js', 'sh']);

function normalizeLanguage(lang) {
  if (!lang) return '';
  const value = lang.toLowerCase();
  if (value === 'js') return 'javascript';
  if (value === 'sh' || value === 'shell') return 'bash';
  return value;
}

function ExecutableCodeBlock({ lang, code, props }) {
  const normalized = normalizeLanguage(lang || 'text');
  const runnable = RUNNABLE.has(normalized);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runCode = () => {
    if (!runnable || running) return;
    setRunning(true);
    setResult(null);
    fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: normalized, code }),
    })
      .then(r => r.json())
      .then((payload) => setResult(payload))
      .catch((err) => setResult({ stderr: err?.message || 'Execution failed', exit_code: -1 }))
      .finally(() => setRunning(false));
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-tools">
        {lang && <span className="code-lang">{lang}</span>}
        {runnable && (
          <button className="code-run-btn" onClick={runCode} disabled={running}>
            {running ? 'Running...' : 'Run'}
          </button>
        )}
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={normalized || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: '6px',
          fontSize: '13px',
          padding: '12px',
        }}
        {...props}
      >
        {code}
      </SyntaxHighlighter>
      {result && (
        <pre className="code-run-output">
          {`exit=${result.exit_code} (${result.duration_ms || 0} ms)\n`}
          {(result.stdout || '')}
          {(result.stderr ? `\nSTDERR:\n${result.stderr}` : '')}
        </pre>
      )}
    </div>
  );
}

export default function MessageContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const lang = match ? match[1] : null;
          const code = String(children).replace(/\n$/, '');

          if (!inline && (lang || String(children).includes('\n'))) {
            return (
              <ExecutableCodeBlock lang={lang} code={code} props={props} />
            );
          }
          return (
            <code className="inline-code" {...props}>
              {children}
            </code>
          );
        },
        // Make links open in new tab
        a({ href, children }) {
          return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
        },
        // Style tables
        table({ children }) {
          return <div className="md-table-wrap"><table>{children}</table></div>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
