import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/auth-context";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";

/**
 * Sign-in via better-auth's email OTP: the desktop app asks for a code, the
 * server mails it, and the resulting session cookie is persisted locally.
 */
export default function LoginPage() {
  const { user, sendOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/blueprints";

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSendOtp(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await sendOtp(email.trim());
      setStep("otp");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "L'envoi du code a échoué.",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await verifyOtp(email.trim(), otp.trim());
      navigate(redirectTo, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Le code est invalide.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Connexion"
        description="Connectez-vous pour accéder à vos réputations, votre inventaire et vos organisations."
      />

      <Card className="p-6">
        {step === "email" ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <Field label="Adresse e-mail">
              <Input
                type="email"
                value={email}
                required
                autoFocus
                placeholder="pilote@exemple.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Envoi…" : "Recevoir un code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-xs text-nexus-accent/60">
              Un code a été envoyé à <span className="text-nexus-bright">{email}</span>.
            </p>

            <Field label="Code de vérification">
              <Input
                value={otp}
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                onChange={(event) => setOtp(event.target.value)}
              />
            </Field>

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Vérification…" : "Se connecter"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setStep("email");
                setOtp("");
                setError(null);
              }}
            >
              Changer d'adresse
            </Button>
          </form>
        )}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
