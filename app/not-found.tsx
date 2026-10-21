import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p className="lead">We could not find that page.</p>
      <Link prefetch={false} className="btn" href="/">
        See all states
      </Link>
    </>
  );
}
