"use client";

import { FaGithub } from "react-icons/fa";
import CardNav from "./CardNav";

/**
 * Global site navigation. Renders the CardNav reactbits component
 * configured for our monochrome theme.
 */
export default function SiteNav() {
  return (
    <CardNav
      logo="/InternMatch.svg"
      logoAlt="InternMatch"
      baseColor="#0F0F0F"
      menuColor="#FAFAFA"
      buttonBgColor="#FAFAFA"
      buttonTextColor="#000000"
      ctaHref="/upload"
      ctaLabel="Get Started"
      items={[
        {
          label: "About",
          bgColor: "#171717",
          textColor: "#FAFAFA",
          links: [
            { label: "About Us", href: "/about", ariaLabel: "About InternMatch" },
            {
              label: "How it works",
              href: "/about",
              ariaLabel: "How InternMatch works",
            },
          ],
        },
        {
          label: "GitHub",
          bgColor: "#171717",
          textColor: "#FAFAFA",
          links: [
            {
              label: "Bhuvan GS",
              href: "https://github.com/BhuvanGS",
              ariaLabel: "Bhuvan GS GitHub",
              icon: <FaGithub aria-hidden="true" />,
            },
            {
              label: "Vijay Dayakaran",
              href: "https://github.com/VijayDayakaran",
              ariaLabel: "Vijay Dayakaran GitHub",
              icon: <FaGithub aria-hidden="true" />,
            },
          ],
        },
      ]}
    />
  );
}
