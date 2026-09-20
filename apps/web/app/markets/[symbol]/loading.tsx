export default function AssetLoading() {
  return (
    <section role="status" aria-label="Loading asset details" aria-busy="true">
      <span className="sr-only">Loading asset details…</span>
      <div aria-hidden="true">
        <div className="mb-10 h-5 w-24 rounded bg-slate-200" />
        <div className="mb-10 flex items-center gap-5"><div className="h-16 w-16 rounded-xl bg-slate-200" /><div className="h-10 w-1/2 rounded-lg bg-slate-200" /></div>
        <div className="surface mb-10 grid grid-cols-2 gap-8 p-7 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index}><div className="mb-4 h-4 w-20 rounded bg-slate-200" /><div className="h-8 w-full max-w-32 rounded bg-slate-200" /></div>)}
        </div>
        <div className="space-y-4"><div className="h-5 w-24 rounded bg-slate-200" /><div className="h-4 w-4/5 rounded bg-slate-200" /><div className="h-4 w-3/5 rounded bg-slate-200" /></div>
      </div>
    </section>
  );
}
