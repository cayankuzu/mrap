export function RouteLoadingState() {
  return (
    <section className="content-page route-loading-state" role="status" aria-live="polite">
      <span className="visually-hidden">Ekran hazırlanıyor</span>
      <div className="route-loading-heading" aria-hidden="true" />
      <div className="route-loading-panel" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}
