export function FoundationEmptyState({ title, description }: { title: string; description: string }) {
  return <section className="empty-panel"><div><h2>{title}</h2><p>{description}</p></div><span className="status-mark" aria-hidden="true">—</span></section>;
}
