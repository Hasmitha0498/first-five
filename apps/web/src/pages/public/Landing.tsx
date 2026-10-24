import clsx from "clsx";
import { ArrowRight, Check, CheckSquare, ClipboardCheck, Link2, MousePointerClick, Sparkles, Target, Users } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { captureUtm, track } from "../../lib/track";

/* Shared marketing building blocks ------------------------------------------------ */

const wrap = "mx-auto max-w-[1180px] px-5 sm:px-[34px]";

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11px] font-extrabold uppercase tracking-[2px] text-accent", className)}>{children}</div>;
}

const darkBtn =
  "inline-flex items-center justify-center gap-2.5 rounded-[11px] bg-deep px-[21px] py-[15px] text-[14px] font-bold text-white shadow-cta transition-colors hover:bg-deep-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#79BDB0] focus-visible:ring-offset-2";
const lightBtn =
  "inline-flex items-center justify-center gap-2 rounded-[11px] border border-[#C9D9D3] bg-white px-[21px] py-[15px] text-[14px] font-bold text-ink transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#79BDB0] focus-visible:ring-offset-2";

export function PaidCta({ placement, className, children = "Run your first test — ₹99" }: { placement: string; className?: string; children?: ReactNode }) {
  return (
    <Link to="/access" onClick={() => track("paid_cta_clicked", placement)} className={clsx(darkBtn, className)}>
      {children} <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

export function WaitlistCta({ placement, className, variant = "light" }: { placement: string; className?: string; variant?: "light" | "ghost" }) {
  return (
    <Link
      to={`/waitlist?from=${placement}`}
      onClick={() => track("waitlist_cta_clicked", placement)}
      className={clsx(
        variant === "light"
          ? lightBtn
          : "inline-flex items-center justify-center rounded-[11px] border border-[#719188] px-[21px] py-[15px] text-[14px] font-bold text-white transition-colors hover:border-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#79BDB0] focus-visible:ring-offset-2 focus-visible:ring-offset-deep",
        className,
      )}
    >
      Join free waitlist
    </Link>
  );
}

function SampleTag({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-[#F4DFB5] bg-[#FFF3DE] px-[9px] py-[5px] text-[10px] font-extrabold text-[#7E6034]">{children}</span>
  );
}

/* Hero product preview (illustrative) ----------------------------------------------- */

function HeroPreview() {
  const bars = [
    { label: "Opened signup", value: 5 },
    { label: "Started form", value: 4 },
    { label: "Reached account", value: 3 },
  ];
  return (
    <figure className="relative mx-auto w-[94%] max-w-[530px] min-w-0 lg:w-full lg:max-w-none" aria-label="Illustrative example of a First Five study overview. Sample data, not a real study.">
      <div className="overflow-hidden rounded-[18px] border border-[#DCE8E2] bg-white shadow-float motion-safe:rotate-[1.3deg]">
        <div className="flex items-center justify-between border-b border-[#E8EFEA] bg-[#FCFDFB] px-[17px] py-[14px]" aria-hidden>
          <div className="flex gap-[5px]">
            <i className="h-2 w-2 rounded-full bg-[#E4A5A0]" />
            <i className="h-2 w-2 rounded-full bg-[#E6D394]" />
            <i className="h-2 w-2 rounded-full bg-[#D1DDD6]" />
          </div>
          <div className="rounded-md bg-[#F2F7F3] px-4 py-[7px] text-[10px] text-[#8A9D94]">firstfive · onboarding test</div>
          <div className="w-[25px]" />
        </div>
        <div className="p-4 sm:p-[26px]">
          <div className="text-[10px] font-extrabold tracking-[1px] text-[#7B8E87]">STUDY OVERVIEW</div>
          <div className="flex items-center justify-between gap-1.5">
            <div className="mb-[13px] mt-1.5 text-[17px] font-extrabold tracking-[-0.5px] sm:text-[19px]">Your onboarding flow</div>
            <SampleTag>Sample data</SampleTag>
          </div>
          <dl className="grid grid-cols-3 gap-[9px]">
            {[
              ["5", "Tested"],
              ["3", "Completed"],
              ["2", "Didn't finish"],
            ].map(([v, l]) => (
              <div key={l} className="rounded-[9px] border border-[#E2EDE7] bg-[#FAFDFA] px-[7px] py-[10px] sm:px-[11px] sm:py-[13px]">
                <dd className="block text-[20px] font-bold tracking-[-1px] sm:text-[23px]">{v}</dd>
                <dt className="text-[9px] text-[#5A6B65] sm:text-[10px]">{l}</dt>
              </div>
            ))}
          </dl>
          <div className="border-b border-[#E8EEEA] pb-1.5 pt-[15px]">
            <div className="mb-[11px] text-[11px] font-bold text-[#566861]">How people moved through signup</div>
            {bars.map((b) => (
              <div key={b.label} className="my-2 flex items-center gap-[9px]">
                <span className="w-[84px] shrink-0 text-[10px] text-[#5A6B65]">{b.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E8F0EC]">
                  <div className="h-full rounded-full bg-[#2B9580]" style={{ width: `${(b.value / 5) * 100}%` }} />
                </div>
                <b className="w-4 text-right text-[10px]">{b.value}</b>
              </div>
            ))}
          </div>
          <div className="mt-[15px] rounded-[10px] border border-[#D9E9DD] bg-[#EEF7F1] p-4">
            <div className="text-[10px] font-extrabold tracking-[1px] text-[#2E7A65]">✦ RESEARCH FINDING</div>
            <h3 className="my-[7px] text-[13px] font-bold leading-[1.35]">Pricing questions may be slowing signup.</h3>
            <p className="m-0 text-[11px] leading-[1.55] text-[#4F6A60]">Three testers checked pricing. Two said they wanted to know the cost before creating an account.</p>
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="relative -mt-3 ml-2 inline-block rounded-[13px] border border-[#E1E9E4] bg-white px-3 py-2.5 text-[11px] leading-[1.6] text-[#42605A] shadow-[0_14px_38px_rgba(30,70,60,0.12)] motion-safe:-rotate-[3deg] sm:absolute sm:-left-[31px] sm:bottom-[34px] sm:ml-0 sm:mt-0 sm:px-4 sm:py-[13px] sm:text-[12px] sm:motion-safe:-rotate-[4deg]"
      >
        <strong className="block text-[#174638]">From clicks to clarity.</strong>
        See what happened.
        <br />
        Understand what to test next.
      </div>
    </figure>
  );
}

/* Example report (illustrative) ------------------------------------------------------ */

function ExampleReportCard() {
  const item = "border-t border-[#E9EFEA] py-[13px]";
  const label = "text-[12px] font-bold tracking-wide text-[#36574C]";
  return (
    <article className="rounded-2xl border border-[#DFE9E4] bg-white p-[19px] shadow-float sm:p-[26px]" aria-label="Illustrative example report">
      <div className="flex items-center justify-between gap-2.5 border-b border-[#E6EEE9] pb-4">
        <div>
          <small className="text-[11px] text-[#5A6B65]">FIRST FIVE · EXAMPLE REPORT</small>
          <h3 className="mt-[5px] text-[18px] font-bold tracking-[-0.6px]">Signup usability study</h3>
        </div>
        <SampleTag>Illustrative</SampleTag>
      </div>
      <dl className="my-[19px] grid grid-cols-3 gap-[9px]">
        {[
          ["5", "Attempts"],
          ["3", "Completed"],
          ["2", "Didn't finish"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-[9px] bg-[#F5F8F5] p-[14px]">
            <dd className="block text-[23px] font-bold tracking-[-1px]">{v}</dd>
            <dt className="text-[10px] text-[#56675F]">{l}</dt>
          </div>
        ))}
      </dl>
      <div className={item}>
        <div className={label}>WHAT WE OBSERVED</div>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-[#5E7268]">Three testers opened Pricing before returning to the signup screen.</p>
      </div>
      <div className={item}>
        <div className={label}>WHAT THEY SAID</div>
        <blockquote className="mt-[9px] rounded border-l-[3px] border-[#4C9E83] bg-[#EDF6F0] px-[14px] py-3 text-[13px] leading-[1.6] text-[#355F4D]">
          “I wanted to know if there was a free plan before registering.”
        </blockquote>
      </div>
      <div className={item}>
        <div className={label}>WHAT THIS MIGHT MEAN</div>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-[#5E7268]">Pricing uncertainty may be adding friction before account creation.</p>
      </div>
      <div className={item}>
        <div className={label}>WHAT TO TEST NEXT</div>
        <p className="mt-1.5 text-[13px] leading-[1.6] text-[#5E7268]">Try a concise pricing explanation near the primary signup button, then repeat the study.</p>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-[#5A6A63]">Illustrative example. All data and quotations are fictional.</p>
    </article>
  );
}

/* FAQ --------------------------------------------------------------------------------- */

const FAQ = [
  {
    q: "Do I need to know how to code?",
    a: "You need to add a small tracking script to a compatible website. If you used an AI coding tool to build your site, it can help you install the snippet.",
  },
  {
    q: "Will you find five testers for me?",
    a: "No. You invite up to five people to try your task. First Five provides the testing, feedback, and research workflow.",
  },
  {
    q: "What can I test?",
    a: "One defined user journey on a compatible website or web application—for example, onboarding, feature discovery, or a simulated checkout.",
  },
  {
    q: "What happens if someone doesn't finish?",
    a: "You can review the supported activity captured during their attempt. If they answer the feedback questions, you'll also have their explanation. First Five won't invent a reason when feedback is missing.",
  },
  {
    q: "Is ₹99 a subscription?",
    a: "No. It's a one-time purchase for one study with up to five eligible participant attempts and one consolidated AI research report.",
  },
  {
    q: "When will I receive the report?",
    a: "After your study closes and the included attempts have been processed. Basic task outcomes may be available earlier.",
  },
];

/* Page ---------------------------------------------------------------------------------- */

const STEPS = [
  { n: "01", tag: "Connect", icon: Link2, title: "Connect your website", body: "Add a small tracking snippet to the website you want to test." },
  { n: "02", tag: "Choose", icon: Target, title: "Choose what to test", body: "Pick one important task and define what successful completion looks like." },
  { n: "03", tag: "Test", icon: Users, title: "Invite five people", body: "Share your study link. First Five captures supported task outcomes and collects feedback." },
  { n: "04", tag: "Understand", icon: Sparkles, title: "Know what to improve", body: "Review participant journeys, research findings, and recommendations for what to test next." },
];

const PRICE_INCLUDES = [
  "One website and one key user journey.",
  "Up to five invited participants.",
  "Task completion and interaction evidence.",
  "Short post-task interviews.",
  "Individual participant views.",
  "One consolidated AI research report.",
  "Recommended improvements to test.",
];

export function LandingPage() {
  const location = useLocation();

  useEffect(() => {
    captureUtm();
    track("landing_page_viewed");
    document.title = "First Five — Test Your Website With Real Users";
  }, []);

  // Support /#pricing links arriving from other pages.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView());
  }, [location.hash]);

  return (
    <>
      {/* HERO */}
      <section className="bg-[radial-gradient(circle_at_90%_12%,#E3F3EB_0%,rgba(227,243,235,0)_37%),linear-gradient(180deg,#F9FBF8_0%,#F5F8F4_100%)] pb-[66px] pt-9 lg:pb-[84px] lg:pt-[57px]">
        <div className={clsx(wrap, "grid items-center gap-[35px] lg:grid-cols-[1.04fr_0.96fr] lg:gap-[45px]")}>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-mint-border bg-[#E6F3EC] px-3 py-2 text-[11px] font-extrabold tracking-[0.2px] text-[#245E50]">
              <span className="h-[7px] w-[7px] rounded-full bg-[#2A9982]" aria-hidden />
              EARLY ACCESS · ONE STUDY FOR ₹99
            </div>
            <h1 className="mb-[21px] mt-6 max-w-[650px] text-[clamp(40px,8vw,61px)] font-extrabold leading-[1.065] tracking-[-2px] lg:text-[clamp(40px,4.8vw,68px)] lg:tracking-[-3px]">
              Your app is live.
              <br />
              But can people <em className="not-italic text-[#187768]">actually use it?</em>
            </h1>
            <p className="mb-7 max-w-[530px] text-[15px] leading-[1.67] text-[#56676A] sm:text-[17px]">
              Give five people one task on your website. See who completes it, where others get stuck, and what their feedback tells you to improve.
            </p>
            <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
              <PaidCta placement="hero" />
              <WaitlistCta placement="hero" />
            </div>
            <ul className="mt-[18px] flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-[1.6] text-[#5A696A]" aria-label="What's included">
              {["One-time payment", "Up to five invited testers", "One AI research report"].map((t) => (
                <li key={t} className="flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-accent" strokeWidth={3} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* TRUST LINE (factual product attributes only) */}
      <div className="border-y border-[#EAF0EC] bg-white">
        <ul className={clsx(wrap, "flex min-h-[83px] flex-wrap items-center justify-start gap-x-5 gap-y-3 py-[18px] text-[11px] font-semibold text-[#5A6F68] sm:justify-center sm:gap-x-[55px] sm:text-[12px]")}>
          <li className="flex items-center gap-2.5">
            <CheckSquare className="h-5 w-5 text-accent" strokeWidth={1.7} aria-hidden /> Built for first-time founders
          </li>
          <li className="flex items-center gap-2.5">
            <Check className="h-5 w-5 text-accent" strokeWidth={1.7} aria-hidden /> No analytics expertise needed
          </li>
          <li className="flex items-center gap-2.5">
            <ClipboardCheck className="h-5 w-5 text-accent" strokeWidth={1.7} aria-hidden /> Designed for web apps
          </li>
        </ul>
      </div>

      {/* PROBLEM */}
      <section className="py-[65px] sm:py-[90px]" aria-labelledby="problem-heading">
        <div className={clsx(wrap, "max-w-[820px] text-center")}>
          <Eyebrow>The problem</Eyebrow>
          <h2 id="problem-heading" className="mx-auto my-[14px] max-w-[650px] text-[clamp(30px,3.2vw,43px)] font-extrabold leading-[1.17] tracking-[-1.8px]">
            Your product works.
            <br />
            But do users know what to do?
          </h2>
          <div className="mx-auto max-w-[620px] space-y-4 text-[15px] leading-[1.7] text-[#5F706B]">
            <p>You know exactly how your product is supposed to work. Your users don't.</p>
            <p>They might miss the next button, take an unexpected route, or leave before completing the task.</p>
            <p>Without seeing real people use your product, it's easy to mistake your assumptions for their experience.</p>
          </div>
          <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-mint px-5 py-2.5 text-[15px] font-bold text-deep">
            <MousePointerClick className="h-4 w-4 text-accent" aria-hidden /> First Five helps you see the difference.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="scroll-mt-4 border-y border-[#E7EEEA] bg-white py-[65px] sm:py-[90px]" aria-labelledby="how-heading">
        <div className={wrap}>
          <div className="mx-auto mb-[23px] max-w-[650px] text-center sm:mb-11">
            <Eyebrow>Simple from start to insight</Eyebrow>
            <h2 id="how-heading" className="my-[14px] text-[clamp(30px,3.2vw,43px)] font-extrabold leading-[1.17] tracking-[-1.8px]">
              Four steps from launch to learning.
            </h2>
          </div>
          <ol className="grid gap-1.5 sm:grid-cols-2 sm:gap-[18px] lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="py-[14px] pr-2 sm:pt-[18px]">
                <div className="flex h-[45px] w-[45px] items-center justify-center rounded-[13px] border border-[#DBEDE3] bg-[#EAF5F0] text-[#1C7562]">
                  <s.icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="mt-3 text-[11px] font-extrabold tracking-[1px] text-[#566B65] sm:mt-6">
                  {s.n} — {s.tag.toUpperCase()}
                </div>
                <h3 className="my-[9px] text-[18px] font-bold tracking-[-0.5px]">{s.title}</h3>
                <p className="text-[13px] leading-[1.7] text-[#64746F]">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* EXAMPLE REPORT */}
      <section id="example" className="scroll-mt-4 py-[65px] sm:py-[90px]" aria-labelledby="example-heading">
        <div className={clsx(wrap, "grid items-center gap-[27px] lg:grid-cols-[0.85fr_1.15fr] lg:gap-[54px]")}>
          <div className="max-w-[660px]">
            <Eyebrow>The real output</Eyebrow>
            <h2 id="example-heading" className="my-4 text-[clamp(32px,3.5vw,45px)] font-extrabold leading-[1.15] tracking-[-1.8px]">
              Numbers show what happened. People help explain why.
            </h2>
            <p className="text-[15px] leading-[1.73] text-[#5F716B]">
              First Five connects task outcomes, real interactions, and post-task feedback into a research report that points you toward your next improvement.
            </p>
            <ul className="mt-[30px] flex flex-col gap-4">
              {["See who completed the task — and who couldn't.", "Read what people expected at moments that mattered.", "Get practical changes to test, with supporting evidence."].map((t) => (
                <li key={t} className="flex items-start gap-3 text-[13px] leading-[1.5] text-[#3B574D]">
                  <span className="inline-flex h-[23px] w-[23px] flex-none items-center justify-center rounded-full bg-mint-strong text-[#14715C]">
                    <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden />
                  </span>
                  <span className="pt-0.5">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <ExampleReportCard />
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="scroll-mt-4 border-y border-[#DFECE4] bg-[#EDF5EF] py-[65px] sm:py-[90px]" aria-labelledby="pricing-heading">
        <div className={wrap}>
          <div className="mx-auto grid max-w-[970px] items-center gap-[30px] lg:grid-cols-2 lg:gap-[70px]">
            <div>
              <Eyebrow>Simple early-access pricing</Eyebrow>
              <h2 id="pricing-heading" className="my-[14px] text-[clamp(32px,3.4vw,45px)] font-extrabold leading-[1.17] tracking-[-1.8px]">
                Your first usability study. ₹99.
              </h2>
              <p className="text-[15px] leading-[1.75] text-[#5E736B]">
                One important task. Up to five real attempts. A clearer view of what to improve. No subscription, no complicated plans.
              </p>
              <p className="mt-4 text-[15px] leading-[1.75] text-[#5E736B]">
                <strong className="text-[#365D4D]">Bring your own testers.</strong> You invite participants; First Five gives you the testing and research workflow.
              </p>
              <Link
                to="/waitlist?from=pricing"
                onClick={() => track("waitlist_cta_clicked", "pricing")}
                className="mt-4 inline-block text-[13px] font-bold text-[#1C6D5C] underline underline-offset-[3px] hover:text-deep"
              >
                Not ready to buy? Join the free waitlist →
              </Link>
            </div>
            <div className="w-full max-w-[510px] rounded-[18px] border border-[#D9E9DF] bg-white p-[23px] shadow-soft sm:p-[31px]">
              <span className="inline-block rounded-full bg-[#E4F4EB] px-2.5 py-[7px] text-[10px] font-extrabold text-[#1F6E5C]">EARLY ACCESS · ONE-TIME PURCHASE</span>
              <div className="mb-[5px] mt-[17px] flex items-baseline gap-2.5">
                <strong className="text-[58px] font-extrabold leading-none tracking-[-3px]">₹99</strong>
                <span className="text-[13px] text-[#5A6B65]">One study</span>
              </div>
              <ul className="my-[25px] grid gap-3">
                {PRICE_INCLUDES.map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-[13px] text-[#34564A]">
                    <Check className="h-4 w-4 flex-none text-[#169073]" strokeWidth={3} aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
              <PaidCta placement="pricing" className="w-full py-4">
                Get one study — ₹99
              </PaidCta>
              <p className="mb-0 mt-[13px] text-center text-[11px] leading-[1.6] text-[#5A6A63]">One-time payment · No recurring charges</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-4 py-[65px] sm:py-[90px]" aria-labelledby="faq-heading">
        <div className={wrap}>
          <div className="mx-auto mb-[23px] max-w-[650px] text-center sm:mb-11">
            <Eyebrow>Good to know</Eyebrow>
            <h2 id="faq-heading" className="my-[14px] text-[clamp(30px,3.2vw,43px)] font-extrabold leading-[1.17] tracking-[-1.8px]">
              Questions before your first test?
            </h2>
          </div>
          <div className="mx-auto max-w-[750px]">
            {FAQ.map((f) => (
              <details key={f.q} className="group border-b border-[#DCE6E0] py-[19px]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 rounded-md text-[15px] font-bold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#79BDB0] [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-[22px] font-normal leading-none text-[#2B7363] group-open:hidden" aria-hidden>
                    +
                  </span>
                  <span className="hidden text-[22px] font-normal leading-none text-[#2B7363] group-open:inline" aria-hidden>
                    −
                  </span>
                </summary>
                <p className="mt-3 max-w-[650px] text-[14px] leading-[1.7] text-[#5F7169]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-deep py-[72px] text-center text-white" aria-labelledby="final-heading">
        <div className={wrap}>
          <h2 id="final-heading" className="mx-auto mb-[18px] max-w-[660px] text-[clamp(31px,4vw,47px)] font-extrabold leading-[1.2] tracking-[-1.8px]">
            Before you build more, find out what needs fixing.
          </h2>
          <p className="mb-[26px] text-[15px] text-[#C5DDD4]">One user journey. Five perspectives. A better next decision.</p>
          <div className="flex flex-col justify-center gap-[11px] sm:flex-row">
            <Link
              to="/access"
              onClick={() => track("paid_cta_clicked", "final")}
              className="inline-flex items-center justify-center gap-2.5 rounded-[11px] bg-white px-[21px] py-[15px] text-[14px] font-bold text-[#1B5145] hover:bg-mint focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#79BDB0] focus-visible:ring-offset-2 focus-visible:ring-offset-deep"
            >
              Run your first test — ₹99 <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <WaitlistCta placement="final" variant="ghost" />
          </div>
        </div>
      </section>
    </>
  );
}
