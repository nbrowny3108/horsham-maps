import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm rounded-lg bg-elevated p-6 shadow-md">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-fg">
            <MapPin className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Horsham Maps</h1>
            <p className="text-xs text-muted">Sign in to keep saved pins across devices</p>
          </div>
        </div>
        {authEnabled ? (
          <div className="space-y-2">
            {GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                className="h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-fg"
              >
                Continue with {p.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled.</p>
        )}
        <Link to="/" className="mt-4 block text-center text-sm text-primary">
          Back to map
        </Link>
      </div>
    </main>
  );
}
