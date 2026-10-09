"use client";

export default function PlatformError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="plain-empty large-empty" role="alert"><h2>Platform data could not be loaded.</h2><p>Try again. If the issue continues, contact your platform administrator.</p><button className="secondary-button" type="button" onClick={reset}>Try again</button></section>;
}
