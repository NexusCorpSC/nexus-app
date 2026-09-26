import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import { Button, Card, PageHeader } from "@/components/ui";

/**
 * Sign-in happens on Nexus Tools, in the browser: already signed in there, the
 * browser comes straight back; otherwise the site asks, then comes back. See
 * `signInWithBrowser` in `src/lib/api/auth.ts`.
 */
export default function LoginPage() {
  const { user, signingIn, signInError, signIn, cancelSignIn } = useAuth();
  const location = useLocation();

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/blueprints";

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Connexion"
        description="Connectez-vous pour accéder à vos réputations, votre inventaire et vos organisations."
      />

      <Card className="space-y-4 p-6">
        {signingIn ? (
          <>
            <p className="text-xs text-nexus-accent/70">
              Terminez la connexion dans votre navigateur : Nexus App reprendra
              la main dès que ce sera fait.
            </p>

            <Button
              type="button"
              variant="ghost"
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
            <p className="text-xs text-nexus-accent/70">
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
