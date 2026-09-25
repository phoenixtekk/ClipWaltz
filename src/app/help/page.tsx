import { readFileSync } from "fs";
import { join } from "path";
import type { ReactNode } from "react";
import { LegalDoc } from "@/components/legal-doc";

export const metadata = { title: "Help Center", description: "How to use every ClipWaltz feature." };

// In-app Help Center: renders HELP_CENTER.md (the single source, kept in sync with FEATURES.md) so
// the page and the doc can't drift. Tiny Markdown subset → React elements (never raw HTML).
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[2]) out.push(<strong key={k}>{inline(m[2], key + 1)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) {
      const href = /^(https?:\/\/|\/)/.test(m[6]) ? m[6] : "#";
      out.push(<a key={k} href={href}>{m[5]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(md: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`ul${blocks.length}`}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>);
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^#\s/.test(line)) continue; // the H1 is the page title
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      flushList(); flushPara();
      blocks.push(h[1] === "##" ? <h2 key={`h${blocks.length}`}>{inline(h[2])}</h2> : <h3 key={`h${blocks.length}`}>{inline(h[2])}</h3>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^\s+\S/.test(line) && list.length) {
      list[list.length - 1] += ` ${line.trim()}`; // wrapped continuation of a bullet
    } else if (!line.trim()) {
      flushList(); flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList(); flushPara();
  return blocks;
}

export default function HelpPage() {
  let md = "";
  try {
    md = readFileSync(join(process.cwd(), "HELP_CENTER.md"), "utf8");
  } catch {
    md = "## Help is temporarily unavailable\nPlease try again later.";
  }
  return (
    <LegalDoc title="Help Center" updated="How to use every ClipWaltz feature — kept current with each release." legal={false}>
      {render(md)}
    </LegalDoc>
  );
}
