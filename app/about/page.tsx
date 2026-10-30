import Link from "next/link";
import { COLORS } from "@/lib/theme";

const TEAM = [
  {
    initials: "BG",
    name: "Bhuvan GS",
    role: "Core Architecture & Backend",
    bio: "Builds end-to-end document intelligence systems with a focus on reliability, data integrity, and production-grade backend architecture.",
    contributions: [
      "Pipeline and API architecture",
      "Database modeling and optimization",
      "Core contradiction detection flow",
    ],
  },
  {
    initials: "VD",
    name: "Vijay Dayakaran",
    role: "Frontend & DevOps",
    bio: "Leads UI execution and deployment operations, ensuring InternMatch stays fast, intuitive, and stable from local development to production.",
    contributions: [
      "UI/UX implementation",
      "Deployment automation",
      "Performance and runtime tuning",
    ],
  },
];

export default function AboutPage() {
  return (
    <main
      className="min-h-screen px-6 pt-[140px] pb-16"
      style={{ backgroundColor: COLORS.bg, color: COLORS.text }}
    >
      <section className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <p
            className="text-xs uppercase tracking-[0.3em] mb-3"
            style={{ color: COLORS.textMuted }}
          >
            About InternMatch
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Meet the team
          </h1>
          <p className="max-w-2xl mx-auto" style={{ color: COLORS.textMuted }}>
            We build focused tooling for internship discovery, resume keyword
            extraction, and AI-assisted job matching.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {TEAM.map((member) => (
            <article
              key={member.name}
              className="rounded-2xl border p-7"
              style={{
                backgroundColor: COLORS.card,
                borderColor: COLORS.border,
              }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold mb-4"
                style={{ backgroundColor: COLORS.cardElev, color: COLORS.text }}
              >
                {member.initials}
              </div>
              <h2 className="text-2xl font-semibold tracking-tight mb-1">
                {member.name}
              </h2>
              <p className="text-sm mb-4" style={{ color: COLORS.textMuted }}>
                {member.role}
              </p>
              <p
                className="text-sm leading-relaxed mb-5"
                style={{ color: COLORS.textMuted }}
              >
                {member.bio}
              </p>

              <div
                className="pt-4 border-t"
                style={{ borderColor: COLORS.border }}
              >
                <p
                  className="text-xs uppercase tracking-widest mb-3"
                  style={{ color: COLORS.textDim }}
                >
                  Contributions
                </p>
                <ul
                  className="space-y-2 text-sm"
                  style={{ color: COLORS.textMuted }}
                >
                  {member.contributions.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <div
          className="rounded-2xl border p-6 text-center"
          style={{ backgroundColor: COLORS.card, borderColor: COLORS.border }}
        >
          <p className="text-sm mb-4" style={{ color: COLORS.textMuted }}>
            Ready to find internships with InternMatch?
          </p>
          <Link
            href="/upload"
            className="inline-flex items-center rounded-full px-6 py-3 font-semibold"
            style={{ backgroundColor: COLORS.accent, color: COLORS.bg }}
          >
            Get Started
          </Link>
        </div>
      </section>
    </main>
  );
}
