import { useEffect, useState, useRef } from "react";

export interface OnboardingModalProps {
  readonly onComplete: () => void;
}

interface OnboardingStep {
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly highlight: string;
}

const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    badge: "🔒 100% Private & Offline",
    title: "Welcome to RYPER AI OS",
    subtitle: "On-Device Intelligence & Privacy",
    description:
      "RYPER runs AI locally on your Windows PC. Your conversations, documents, and personal data never leave your device, and full intelligence works completely offline.",
    highlight: "No cloud dependencies, subscriptions, or remote data sharing.",
  },
  {
    badge: "🛡️ Safe System Control",
    title: "Hands-Free Desktop Power",
    subtitle: "Control Windows with Your Consent",
    description:
      "Ask RYPER to open applications, manage windows, search files, adjust volume, or check battery status. Privileged actions always ask for your explicit confirmation first.",
    highlight: "You always remain in full control of destructive actions.",
  },
  {
    badge: "🎙️ Push-to-Talk: Ctrl + Shift + Space",
    title: "Speak or Type Anytime",
    subtitle: "Natural Multilingual Voice",
    description:
      "Press Ctrl + Shift + Space anywhere in Windows to speak to Ryper, or type your requests in the chat. Ryper understands English, Hindi, and mixed Hinglish code-switching.",
    highlight: "Ready whenever you need it from your keyboard or microphone.",
  },
];

export function OnboardingModal({ onComplete }: OnboardingModalProps): JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const step = ONBOARDING_STEPS[currentStep] ?? ONBOARDING_STEPS[0]!;
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, [currentStep]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onComplete();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onComplete]);

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  return (
    <div className="onboarding-backdrop" role="presentation">
      <div
        className="onboarding-card glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-desc"
      >
        <span className="glass-highlight" />
        <div className="onboarding-header">
          <span className="onboarding-badge">{step.badge}</span>
          <button
            type="button"
            className="onboarding-skip-btn"
            onClick={onComplete}
            aria-label="Skip onboarding"
          >
            Skip
          </button>
        </div>

        <div className="onboarding-body">
          <h2 id="onboarding-title" className="onboarding-title">
            {step.title}
          </h2>
          <div className="onboarding-subtitle">{step.subtitle}</div>
          <p id="onboarding-desc" className="onboarding-desc">
            {step.description}
          </p>
          <div className="onboarding-highlight">
            <span className="onboarding-check" aria-hidden="true">✓</span>
            <span>{step.highlight}</span>
          </div>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-dots" aria-label={`Step ${currentStep + 1} of ${ONBOARDING_STEPS.length}`}>
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`onboarding-dot ${i === currentStep ? "onboarding-dot--active" : ""}`}
              />
            ))}
          </div>

          <div className="onboarding-actions">
            {currentStep > 0 && (
              <button
                type="button"
                className="onboarding-btn onboarding-btn--secondary"
                onClick={handleBack}
              >
                Back
              </button>
            )}
            <button
              ref={primaryButtonRef}
              type="button"
              className="onboarding-btn onboarding-btn--primary"
              onClick={handleNext}
            >
              {isLastStep ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
