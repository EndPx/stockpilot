export default function MarketsLoading() {
  return (
    <section role="status" aria-label="Loading markets" aria-busy="true">
      <span className="sr-only">Loading markets…</span>
      <div aria-hidden="true">
        <div className="mb-4 h-10 w-40 rounded-lg bg-slate-200" />
        <div className="mb-9 h-5 w-3/4 max-w-lg rounded bg-slate-200" />
        <div className="mb-6 h-11 w-full max-w-lg rounded-lg bg-slate-200" />
        <div className="surface divide-y divide-line">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-5 p-6"><div className="h-11 w-11 rounded-xl bg-slate-200" /><div className="h-4 w-1/3 rounded bg-slate-200" /><div className="ml-auto h-4 w-20 rounded bg-slate-200" /></div>)}
        </div>
      </div>
    </section>
  );
}
