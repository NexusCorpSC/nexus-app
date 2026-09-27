import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import { Button, Card } from "@/components/ui";

/**
 * Sign-in happens on Nexus Tools, in the browser: already signed in there, the
 * browser comes straight back; otherwise the site asks, then comes back. See
 * `signInWithBrowser` in `src/lib/api/auth.ts`.
 */
export default function LoginPage() {
  const { user, signingIn, signInError, signIn, cancelSignIn } = useAuth();
  const location = useLocation();

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/home";

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md space-y-4 p-7">
        <div className="mb-2 text-center">
          <h1 className="font-display text-[28px] leading-tight font-bold text-nexus-white">
            Connexion
          </h1>
          <p className="mt-1 text-sm text-nexus-muted">
            Connectez-vous pour accéder à vos réputations, votre inventaire et
            vos organisations.
          </p>
        </div>

        {signingIn ? (
          <>
            <p className="text-center text-xs leading-relaxed text-nexus-dim">
              Terminez la connexion dans votre navigateur : Nexus App reprendra
              la main dès que ce sera fait.
            </p>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void signIn()}
            >
              Rouvrir le navigateur
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void cancelSignIn()}
            >
              Annuler
            </Button>
          </>
        ) : (
          <>
            <p className="text-center text-xs leading-relaxed text-nexus-dim">
              La connexion se fait sur Nexus Tools, dans votre navigateur. Si
              vous y êtes déjà connecté, il n'y a rien d'autre à faire.
            </p>

            <Button
              type="button"
              className="w-full"
              onClick={() => void signIn()}
            >
              Se connecter avec Nexus Tools
            </Button>
          </>
        )}

        {signInError ? (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
            {signInError}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
