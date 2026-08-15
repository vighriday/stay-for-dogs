import Link from "next/link";
import { HeroStrip } from "@/components/HeroStrip";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col pb-32 pt-8">
      <header className="column flex items-center justify-between">
        <span className="label text-bone">Stay</span>
        <span className="label">Voice by ElevenLabs</span>
      </header>

      <section className="column mt-24 flex flex-col gap-8">
        <h1 className="display text-[clamp(38px,9vw,64px)]">
          You leave.
          <br />
          Your voice doesn&apos;t.
        </h1>

        <p className="max-w-[46ch] text-[17px] leading-relaxed text-dim">
          About one in five dogs panics when it&apos;s left home alone. Stay listens,
          waits for your dog to go quiet, and answers in your voice — different words
          every time, never a loop.
        </p>
      </section>

      <div className="bleed my-16">
        <HeroStrip />
      </div>

      <div className="column flex flex-wrap items-center gap-4">
        <Link
          href="/demo"
          className="inline-flex items-center rounded-xs bg-bone px-5 py-3 text-[14px] font-medium text-ink transition-colors duration-[120ms] hover:bg-white"
        >
          Try it — no key, no microphone
        </Link>
        <Link
          href="/setup"
          className="inline-flex items-center rounded-xs border border-line px-5 py-3 text-[14px] font-medium transition-colors duration-[120ms] hover:border-line-bright hover:bg-ink-raised"
        >
          Set it up with my voice
        </Link>
      </div>

      <section className="column mt-32 flex flex-col gap-8">
        <span className="label">Why this works</span>
        <div className="flex max-w-[62ch] flex-col gap-6 text-[17px] leading-relaxed">
          <p>
            In 2021 a Finnish app called Digital Dogsitter was put through a proper trial.
            It listened for the dog crying and played back a short recording of the
            owner&apos;s voice. It worked — less barking, less howling, and owners
            reported less destroyed furniture eight months later.
          </p>
          <p>
            But the same literature carries a warning. A single clip, looped identically,
            can flip from comfort into a cue: the sound that means you&apos;re gone. In
            2021 there was no way around that, because you could only play back what you
            had already recorded.
          </p>
          <p className="text-bone">
            Stay is the version where the voice can say things it never said.
          </p>
        </div>
      </section>

      <section className="column mt-32 flex flex-col gap-10">
        <span className="label">How it works</span>
        <dl className="flex flex-col gap-10">
          {STEPS.map((step) => (
            <div key={step.title} className="grid gap-3 sm:grid-cols-[180px_1fr] sm:gap-8">
              <dt className="display text-[21px] text-bone">{step.title}</dt>
              <dd className="max-w-[52ch] text-dim">{step.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="column mt-32 flex flex-col gap-6">
        <span className="label">Being straight with you</span>
        <div className="flex max-w-[62ch] flex-col gap-5 text-[15px] leading-relaxed text-dim">
          <p>
            This is a prototype, not a treatment. A badly anxious dog needs a veterinary
            behaviourist, and nothing here replaces one.
          </p>
          <p>
            <span className="text-bone">
              The microphone audio never leaves your browser.
            </span>{" "}
            Stay measures how loud the room is and which frequencies are in it. Nothing is
            recorded, stored or uploaded — that is a property of how it&apos;s built, not
            a promise.
          </p>
          <p>
            I don&apos;t own a dog. So instead of filming one dog once and calling it
            proof, the detector is tested against recorded clips and the numbers are
            published, clips included, for anyone to re-run.{" "}
            <Link
              href="/test"
              className="text-bone underline decoration-line underline-offset-4 hover:decoration-bone"
            >
              See the test results
            </Link>
            .
          </p>
        </div>
      </section>

      <footer className="column mt-32 flex flex-wrap items-center justify-between gap-6 border-t border-line pt-8">
        <span className="label">Stay · you leave, your voice doesn&apos;t</span>
        <nav className="flex flex-wrap items-center gap-6">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="label transition-colors hover:text-bone">
              {l.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  );
}

const STEPS = [
  {
    title: "It listens",
    body: "Four things have to be true before a sound counts: loud enough, mostly in the 300–2500 Hz range where barks and whines live, held for at least four tenths of a second, and not Stay hearing its own voice. Traffic, the fridge and a door slamming all get ignored.",
  },
  {
    title: "It waits",
    body: "Answering a bark teaches a dog that barking summons you. So Stay marks the dog as upset, keeps listening, and only speaks after two and a half seconds of quiet — it answers the calm, not the noise. If the dog never settles, it speaks anyway after twenty seconds. Nobody should be ignored.",
  },
  {
    title: "It speaks",
    body: "Every line is written fresh by Gemini using your dog's name and the words you've banned, then spoken in your voice by ElevenLabs. All of it is rendered before the session starts, so the answer is instant instead of four seconds late.",
  },
  {
    title: "It keeps a record",
    body: "Every episode and every response lands on a timeline you can read at a glance or hand to a vet — including the times Stay decided to stay quiet.",
  },
];

const FOOTER_LINKS = [
  { href: "/demo", label: "Demo" },
  { href: "/test", label: "Test results" },
  { href: "/review", label: "Score a clip" },
  { href: "/privacy", label: "Privacy" },
];
