import Link from "next/link";
export default function NotFound() {
  return (
    <section className="page">
      <h1>This frame is missing.</h1>
      <Link href="/" className="primary">
        Return to studio
      </Link>
    </section>
  );
}
