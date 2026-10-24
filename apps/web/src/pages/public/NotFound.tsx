import { Link } from "react-router-dom";
import { Logo } from "../../components/layouts";
import { buttonClass } from "../../components/ui";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold">We couldn't find that page</h1>
      <p className="mt-2 text-ink-muted">The link may be mistyped, or the page may have moved.</p>
      <div className="mt-6 flex gap-2">
        <Link to="/" className={buttonClass("secondary")}>
          Go to homepage
        </Link>
        <Link to="/app" className={buttonClass("primary")}>
          Open your workspace
        </Link>
      </div>
    </div>
  );
}
