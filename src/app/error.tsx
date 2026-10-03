"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="page">
      <h1>Something interrupted this frame.</h1>
      <p>Your saved work remains in the local library.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
