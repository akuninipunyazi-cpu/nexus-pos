import { FoundationEmptyState } from "@/components/empty-state";

export function FoundationPage({ eyebrow, title, intro, emptyTitle, description }: { eyebrow: string; title: string; intro: string; emptyTitle: string; description: string }) {
  return <><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1><p className="page-intro">{intro}</p><FoundationEmptyState title={emptyTitle} description={description} /></>;
}
