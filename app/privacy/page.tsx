import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Stay",
  description:
    "What Stay does with your microphone, your API key and your dog's data. Short version: almost nothing leaves your browser.",
};

/**
 * An always-on microphone in someone's living room demands a straight answer
 * about what happens to the audio. This page is that answer.
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh flex-col py-8">
      <div className="column flex items-center justify-between">
        <Link href="/" className="label transition-colors hover:text-bone">
          ← Stay
        </Link>
        <span className="label">Privacy</span>
      </div>

      <div className="column mt-16 flex flex-col gap-8">
        <h1 className="display text-[clamp(30px,6vw,44px)]">
          What Stay does with your data.
        </h1>
        <p className="max-w-[62ch] text-[17px] leading-relaxed text-bone">
          Stay asks to leave a microphone running in your home for hours while you are
          out. That deserves a straight answer rather than a policy.
        </p>
      </div>

      <div className="column mt-20 flex flex-col gap-20">
        {SECTIONS.map((s) => (
          <section key={s.title} className="flex flex-col gap-5">
            <span className="label">{s.eyebrow}</span>
            <h2 className="display text-[26px]">{s.title}</h2>
            <div className="flex max-w-[62ch] flex-col gap-4 text-[16px] leading-relaxed text-dim">
              {s.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="column mt-24 border-t border-line pt-8">
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-dim">
          Stay is a prototype built for a weekend challenge, not a commercial product.
          There is no company behind it, no analytics, and nowhere for your data to be
          sold to. If any of the above stops being true, this page changes first.
        </p>
      </div>
    </main>
  );
}

const SECTIONS = [
  {
    eyebrow: "The microphone",
    title: "The audio never leaves your browser.",
    body: [
      "During a session, Stay measures two things about the sound in the room: how loud it is, and how much of that loudness sits between 300 and 2500 Hz. Both numbers are computed on your device, in the browser's audio thread.",
      "<span class='text-bone'>No audio is recorded, buffered to disk, or uploaded.</span> There is no code path that sends microphone data anywhere, which is a stronger guarantee than a promise not to look at it.",
      "The strip you see on screen is drawn from those two numbers. That is the entire representation of your room that Stay ever holds, and it disappears when you close the tab.",
    ],
  },
  {
    eyebrow: "Your voice",
    title: "One deliberate upload, to ElevenLabs, only if you ask for it.",
    body: [
      "If your ElevenLabs plan supports cloning and you choose to record a sample, that recording is sent once — through Stay's server, straight to ElevenLabs — to create the voice. Stay does not keep a copy.",
      "On a free plan there is no upload at all. You create the voice in ElevenLabs' own dashboard and give Stay the voice ID.",
      "Every line Stay speaks is sent to ElevenLabs to be synthesised, because that is what synthesis is. Those are short calming sentences about your dog.",
    ],
  },
  {
    eyebrow: "Your API key",
    title: "Held in your browser, used, and forgotten.",
    body: [
      "Your ElevenLabs key is stored in this browser's local storage so you don't have to paste it every time. It is sent to Stay's server with each request, used to call ElevenLabs, and never written to a database, a log, or a file.",
      "Stay's server is stateless. There is no account, no session table, and nothing to breach.",
      "Clearing your browser data removes the key completely. So does the reset link in setup.",
    ],
  },
  {
    eyebrow: "Your dog",
    title: "The profile stays local. The clips do not.",
    body: [
      "Your dog's name, nickname, likes and banned words live in your browser's local storage. They are sent to Gemini with each request for new lines, because they are what makes the lines specific to your dog.",
      "If you use Session Review, the clip you upload is sent to Google's Gemini API to be scored and is not stored by Stay afterwards. Google's own terms govern what happens to it there — if that matters to you, don't upload the clip.",
      "The session timeline lives in the page. Close the tab and it is gone.",
    ],
  },
  {
    eyebrow: "Everything else",
    title: "No analytics, no cookies, no tracking.",
    body: [
      "Stay sets no cookies and runs no analytics, no tag manager, and no third-party scripts. Fonts are served from the same deployment rather than a font CDN.",
      "The only outbound requests Stay makes are to ElevenLabs and to Google's Gemini API, and only when a feature you triggered needs them.",
      "Demo mode makes no outbound requests at all.",
    ],
  },
];
