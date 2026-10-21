/**
 * Shown on the privacy and terms pages until LEGAL_REVIEWED=true is set. These texts describe what the software
 * actually does, but they are a starting draft, not legal advice. Have a qualified Nigerian lawyer review them
 * (including data protection registration duties) before launch, then set the variable.
 */
export default function LegalBanner() {
  if (process.env.LEGAL_REVIEWED === "true") return null;
  return (
    <p className="notice" role="note">
      <b>Draft.</b> This page has not yet been reviewed by a lawyer.
    </p>
  );
}

export const contactLine = () =>
  process.env.CONTACT_EMAIL ? `Email ${process.env.CONTACT_EMAIL}.` : "Contact details will be added here before launch.";
