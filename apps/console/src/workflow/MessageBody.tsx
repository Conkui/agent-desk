import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Agent text stays text/Markdown. No model-supplied HTML or remote image requests. */
export function MessageBody({
  text,
  plain = false,
}: {
  text: string;
  plain?: boolean;
}) {
  if (plain) return <pre className="plain-message">{text}</pre>;
  return (
    <div className="markdown-message">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="hint">[图片：{alt || "附件"}]</span>
          ),
          table: ({ children }) => (
            <div className="message-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
