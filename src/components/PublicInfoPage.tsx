import Link from "next/link";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";

export function PublicInfoPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: string; sections: Array<{ title: string; body: string }> }) {
  return (
    <main className="public-info-page">
      <header><Logo /><Link href="/"><ArrowLeft size={17} /> Ana sayfa</Link></header>
      <article>
        <span className="public-info-icon"><ShieldCheck size={24} /></span>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="public-info-intro">{intro}</p>
        {sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p></section>)}
        <footer><Mail size={17} /> Geri bildirim için: <a href="mailto:hello@mrap.local">hello@mrap.local</a></footer>
      </article>
    </main>
  );
}
