"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowRight,
  Upload,
  Brain,
  AlertTriangle,
  ShieldCheck,
  FileSearch,
  Github,
} from "lucide-react";
import TrueFocus from "@/components/TrueFocus";
import LogoLoop from "@/components/LogoLoop";
import SiteNav from "@/components/SiteNav";
import {
  SiNextdotjs,
  SiReact,
  SiSupabase,
  SiPostgresql,
  SiTypescript,
  SiTailwindcss,
  SiRender,
  SiVercel,
} from "react-icons/si";
import { COLORS } from "@/lib/theme";

const TECH_LOGOS = [
  { node: <SiNextdotjs />, title: "Next.js" },
  { node: <SiReact />, title: "React" },
  { node: <SiTypescript />, title: "TypeScript" },
  { node: <SiSupabase />, title: "Supabase" },
  { node: <SiPostgresql />, title: "PostgreSQL" },
  { node: <SiTailwindcss />, title: "Tailwind" },
  { node: <SiRender />, title: "Render" },
  { node: <SiVercel />, title: "Vercel" },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Profile Input",
    desc: "Pick what fits you best, upload your resume, or type keywords. InternMatch accepts PDF, DOCX, and TXT.",
    icon: Upload,
  },
  {
    step: "02",
    title: "AI Extracts Keywords",
    desc: "Groq reads your resume (plus Python OCR when needed) and merges skills with your manual keywords.",
    icon: Brain,
  },
  {
    step: "03",
    title: "TinyFish Web Search",
    desc: "TinyFish browser agents search LinkedIn, Internshala, Wellfound, and Naukri in parallel and return structured matches.",
    icon: ShieldCheck,
  },
];

export default function LandingPage() {
  return (
    <main
      className="min-h-screen w-full overflow-x-hidden"
      style={{ backgroundColor: COLORS.bg, color: COLORS.text }}
    >
      <SiteNav />

      {/* ===== HERO ===== */}
      <section className="relative w-full min-h-screen flex flex-col items-center justify-center pt-[180px] pb-24 px-6 text-center">
        {/* Subtle radial vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.04) 0%, transparent 60%)",
          }}
        />

        {/* Subtle grid background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 70%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 30%, transparent 70%)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="relative z-10 mb-8"
        >
          <span
            className="inline-block text-xs uppercase tracking-[0.3em] px-4 py-2 rounded-full border"
            style={{
              color: COLORS.textMuted,
              borderColor: COLORS.border,
              backgroundColor: COLORS.bgElev,
            }}
          >
            Internship Matching · OPEN TO ALL
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
          className="relative z-10 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight max-w-5xl leading-[1.02]"
          style={{ color: COLORS.text }}
        >
          InternMatch,
          <br />
          <span style={{ color: COLORS.textMuted }}>Powered by AI.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease: "easeOut" }}
          className="relative z-10 mt-8 max-w-2xl text-base sm:text-lg leading-relaxed"
          style={{ color: COLORS.textMuted }}
        >
          Tell us what fits you best or upload your resume. InternMatch extracts
          keywords and finds internships across major job boards in one flow.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="relative z-10 mt-12 flex flex-col sm:flex-row items-center gap-3"
        >
          <Link href="/upload">
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-semibold text-base"
              style={{
                backgroundColor: COLORS.accent,
                color: COLORS.bg,
              }}
            >
              Find Internships
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </Link>
        </motion.div>

        {/* Scroll cue */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 text-xs uppercase tracking-widest"
          style={{ color: COLORS.textDim }}
        >
          Scroll
        </motion.div>
      </section>

      {/* ===== TRUE FOCUS BANNER ===== */}
      <section
        className="py-28 px-6 border-y"
        style={{
          backgroundColor: COLORS.bg,
          borderColor: COLORS.border,
        }}
      >
        <div className="max-w-6xl mx-auto text-center">
          <p
            className="text-xs uppercase tracking-[0.3em] mb-8"
            style={{ color: COLORS.textMuted }}
          >
            What InternMatch Does
          </p>
          <div className="flex items-center justify-center text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight">
            <TrueFocus
              sentence="Extract Keywords Search Boards Match Internships"
              manualMode={true}
              blurAmount={4}
              borderColor="#FFFFFF"
              glowColor="rgba(255, 255, 255, 0.4)"
              animationDuration={0.5}
              pauseBetweenAnimations={1.5}
            />
          </div>
          <p
            className="mt-10 max-w-2xl mx-auto text-base leading-relaxed"
            style={{ color: COLORS.textMuted }}
          >
            Hover over the words. Each step maps to the pipeline — OCR, keyword
            extraction, and TinyFish-powered discovery on real job sites.
          </p>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="py-24 px-6" style={{ backgroundColor: COLORS.bg }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p
              className="text-xs uppercase tracking-[0.3em] mb-4"
              style={{ color: COLORS.textMuted }}
            >
              How It Works
            </p>
            <h2
              className="text-4xl sm:text-5xl font-bold tracking-tight"
              style={{ color: COLORS.text }}
            >
              Three steps, fully automated
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HOW_IT_WORKS.map((item, idx) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: idx * 0.1 }}
                  whileHover={{ y: -3 }}
                  className="p-8 rounded-2xl border transition-colors"
                  style={{
                    backgroundColor: COLORS.card,
                    borderColor: COLORS.border,
                  }}
                >
                  <div className="flex items-start justify-between mb-6">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center border"
                      style={{
                        backgroundColor: COLORS.cardElev,
                        borderColor: COLORS.border,
                      }}
                    >
                      <Icon
                        className="w-5 h-5"
                        style={{ color: COLORS.text }}
                      />
                    </div>
                    <span
                      className="text-xs font-mono"
                      style={{ color: COLORS.textDim }}
                    >
                      {item.step}
                    </span>
                  </div>
                  <h3
                    className="text-xl font-semibold mb-3"
                    style={{ color: COLORS.text }}
                  >
                    {item.title}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: COLORS.textMuted }}
                  >
                    {item.desc}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section
        className="py-20 px-6 border-y"
        style={{
          backgroundColor: COLORS.bgElev,
          borderColor: COLORS.border,
        }}
      >
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "4+", label: "Job boards" },
            { value: "100%", label: "Same UI shell" },
            { value: "Groq AI", label: "Keyword extract" },
            { value: "TinyFish", label: "Web agents" },
          ].map((stat) => (
            <div key={stat.label}>
              <div
                className="text-3xl sm:text-4xl font-bold tracking-tight"
                style={{ color: COLORS.text }}
              >
                {stat.value}
              </div>
              <div
                className="text-xs uppercase tracking-widest mt-2"
                style={{ color: COLORS.textMuted }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ===== TECH STACK LOGO LOOP ===== */}
      <section className="py-20" style={{ backgroundColor: COLORS.bg }}>
        <div className="text-center mb-10 px-6">
          <p
            className="text-xs uppercase tracking-[0.3em]"
            style={{ color: COLORS.textMuted }}
          >
            Built With
          </p>
        </div>
        <div style={{ color: COLORS.textMuted }}>
          <LogoLoop
            logos={TECH_LOGOS}
            speed={60}
            direction="left"
            logoHeight={36}
            gap={64}
            pauseOnHover={true}
            fadeOut={true}
            fadeOutColor={COLORS.bg}
            scaleOnHover={true}
            ariaLabel="Technologies used"
          />
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="py-24 px-6" style={{ backgroundColor: COLORS.bg }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl mx-auto text-center p-12 rounded-3xl border"
          style={{
            backgroundColor: COLORS.card,
            borderColor: COLORS.border,
          }}
        >
          <h2
            className="text-3xl sm:text-5xl font-bold tracking-tight mb-4"
            style={{ color: COLORS.text }}
          >
            Ready to find your next internship?
          </h2>
          <p
            className="max-w-xl mx-auto mb-8"
            style={{ color: COLORS.textMuted }}
          >
            Upload a resume or enter keywords — matches from LinkedIn,
            Internshala, Wellfound, and Naukri in one place.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/upload">
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-semibold"
                style={{ backgroundColor: COLORS.accent, color: COLORS.bg }}
              >
                Get Started
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </Link>
            <a
              href="https://github.com/BhuvanGS/InternMatch"
              target="_blank"
              rel="noreferrer"
            >
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.98 }}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-semibold border"
                style={{
                  borderColor: COLORS.borderStrong,
                  color: COLORS.text,
                }}
              >
                <Github className="w-4 h-4" />
                Star on GitHub
              </motion.button>
            </a>
          </div>
        </motion.div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer
        className="py-10 px-6 border-t"
        style={{
          backgroundColor: COLORS.bg,
          borderColor: COLORS.border,
        }}
      >
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm" style={{ color: COLORS.textMuted }}>
            InternMatch — AI Internship Assistant
          </p>
          <div
            className="flex items-center gap-6 text-sm"
            style={{ color: COLORS.textMuted }}
          >
            <a
              href="https://github.com/BhuvanGS/InternMatch"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
            <Link href="/about" className="hover:text-white transition-colors">
              About
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
