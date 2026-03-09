import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-text-700 space-y-6">
      <h1 className="text-2xl font-bold text-text-900">Privacy Policy</h1>
      <p className="text-sm text-text-500">Last updated: March 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-text-800">We don&apos;t use your data</h2>
        <p>
          Your questions and conversations exist only so you can access them. We
          do not analyze, sell, or share your data. We do not use it for
          training, advertising, or any purpose beyond showing it back to you.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-text-800">How it works</h2>
        <p>
          When you ask a question, it&apos;s sent to an AI language model to
          generate an answer — the same way ChatGPT, Gemini, or any other AI
          assistant works. We don&apos;t do anything more with your data than
          what&apos;s needed to give you a response.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-text-800">No tracking</h2>
        <p>
          We don&apos;t use tracking cookies or analytics. Browser local storage
          is used only to remember your village selection and theme preference.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-text-800">Contact</h2>
        <p>
          Questions about this policy? Email us at{" "}
          <a href="mailto:contact@askmura.com" className="text-sage hover:underline">
            contact@askmura.com
          </a>.
        </p>
      </section>
    </div>
  );
}
