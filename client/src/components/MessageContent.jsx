import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function MessageContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const lang = match ? match[1] : null;

          if (!inline && (lang || String(children).includes('\n'))) {
            return (
              <div className="code-block-wrapper">
                {lang && <span className="code-lang">{lang}</span>}
                <SyntaxHighlighter
                  style={oneDark}
                  language={lang || 'text'}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '6px',
                    fontSize: '13px',
                    padding: '12px',
                  }}
                  {...props}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
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
