type FonglishLogoProps = {
  variant?: "lobby" | "compact";
};

export function FonglishLogo({ variant = "lobby" }: FonglishLogoProps) {
  return (
    <div className={`fonglish-logo fonglish-logo--${variant}`} aria-label="Fonglish">
      <svg
        className="fonglish-logo-mark"
        viewBox="0 0 24 14"
        width="24"
        height="14"
        aria-hidden
      >
        <polygon points="12,14 0,0 24,0" />
      </svg>
      <span className="fonglish-logo-word">Fonglish</span>
    </div>
  );
}
