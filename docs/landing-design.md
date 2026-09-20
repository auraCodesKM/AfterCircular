# AFTERCIRCULAR — LANDING PAGE & VISUAL SYSTEM

## PURPOSE

This document defines the visual, UX, content, interaction, and branding direction for the AfterCircular landing page.

`PRD.md` is the source of truth for the actual product.

This file is the source of truth for how that product should be presented visually.

The goal is NOT to create a generic SaaS landing page.

The goal is to create a premium, technically sophisticated landing page that feels like a real enterprise AI product.

The existing visual reference is intentionally retained:

- large editorial typography
- light/paper background
- generous whitespace
- LED-dot typography
- three large visual capability cards
- cinematic abstract visuals
- subtle gradients
- grain/noise
- technical visualizations
- smooth animation
- minimal enterprise aesthetic

The implementation may improve the existing design substantially, but it must remain recognizably within the same visual family.

---

# 1. PRODUCT IDENTITY

## Product

**AfterCircular**

## Tagline

**Turn regulatory change into action.**

## Product description

AfterCircular continuously monitors regulatory publications, extracts regulatory obligations, compares them against internal company policies, detects policy conflicts, produces evidence-grounded analysis, and routes required compliance actions through human approval.

Core loop:

```text
REGULATORY CHANGE
        ↓
OBLIGATION EXTRACTION
        ↓
POLICY RETRIEVAL
        ↓
IMPACT ANALYSIS
        ↓
CONFLICT DETECTION
        ↓
HUMAN REVIEW
        ↓
COMPLIANCE ACTION

The website must communicate that AfterCircular is a continuously operating intelligence system.

It must NOT look like:

a generic chatbot
a document Q&A application
a PDF summarizer
a generic RAG chatbot
a legal chatbot
a simple AI assistant

The important differentiators are:

continuous monitoring
persistent state
regulatory change detection
policy comparison
evidence-grounded reasoning
human approval
controlled actions
auditability
2. DESIGN PHILOSOPHY

The design should feel like:

AI infrastructure × regulatory intelligence × premium enterprise software

Desired qualities:

precise
calm
intelligent
technical
premium
trustworthy
modern
restrained
sophisticated

Avoid:

excessive startup hype
giant gradients everywhere
neon AI aesthetics
excessive glassmorphism
generic chatbot visuals
stock illustrations
generic corporate stock photography
excessive rounded cards
fake enterprise logos
fake customer testimonials
fake performance claims
3. VISUAL DNA

Preserve the existing visual identity:

Typography
Large editorial headline
Strong contrast between headline and body
Elegant modern sans-serif typography
Large whitespace
LED-dot treatment for one important word
Strong typographic hierarchy
Background

Prefer:

warm white / soft off-white
subtle paper texture
extremely subtle grain
faint technical patterns

Avoid a completely sterile pure-white SaaS template.

Color

Primary foundation:

near-black
white
warm off-white
soft gray

Accent colors may appear inside the visual cards:

muted rose
lavender
orange
soft red
subtle pink

These should remain controlled and sophisticated.

Do not introduce a rainbow palette.

4. HERO

The hero should be the strongest part of the page.

Headline

Use:

Turn regulatory change
into action.

The word:

action

should use the existing LED-dot visual treatment.

Do not remove this.

The LED-dot typography is one of the product's visual signatures.

Supporting text

Use:

AfterCircular continuously monitors regulatory publications, detects policy conflicts, provides evidence-grounded analysis, and routes every change through a human approval layer.

Keep it concise.

Do not add another large paragraph.

5. AUTHENTICATION

Authentication is required.

The landing page must expose:

Sign in

and

Sign up

Routes:

/signin
/signup

Use the existing visual language.

Preferred treatment:

[ Sign in ]  [ Sign up ]

or a similarly minimal arrangement.

Do not add:

Book a Demo
Contact Sales
Request a Demo
Get Started
Try for Free

The primary user action is entering the product.

The authentication controls should not dominate the hero.

6. HERO FEATURE CARDS

The hero contains three large visual cards.

They represent a single pipeline:

WATCH
  ↓
UNDERSTAND
  ↓
ACT

They should feel connected rather than like three unrelated marketing features.

CARD 01
Title

Continuous Monitoring

Regulatory Publications

Metric

24/7

Caption

Regulatory sources
continuously monitored

CTA

Explore

Visual

Retain the existing gauge/speed visualization.

Improve it subtly so it feels like:

a live monitoring signal
regulatory feed activity
continuous scanning

Possible subtle animation:

scanning pulse
moving indicator
signal sweep
small LIVE state

Do not turn the card into a literal dashboard.

CARD 02
Title

Evidence-Grounded Analysis

Policy Conflict Detection

Metric

100%

Unit

%

Caption

Evidence cited
per decision

CTA

Explore

Visual

Retain the existing context-window visualization.

Subtly evolve it toward:

regulatory evidence
policy evidence
retrieved context
clause comparison

The visual should communicate "understanding" rather than simply "large context window."

Do not fabricate benchmark claims.

The 100% figure represents the intended product behavior/design principle that important decisions should carry supporting evidence.

CARD 03
Title

Human-Controlled Action

Approval Before Execution

Metric

1

Unit

gate

Caption

Human approval
before execution

CTA

Explore

Visual

Retain the existing network/connection visualization.

Subtly communicate:

AI ANALYSIS
     ↓
APPROVAL GATE
     ↓
ACTION

The existing network visualization should remain abstract and elegant.

Do not turn it into a literal flowchart.

7. METRIC RULE

Numbers are allowed and encouraged because they strengthen the visual composition.

Use:

24/7
100%
1 gate

However, never present fabricated numbers as empirical benchmark results.

Do not use fake claims such as:

99.9% accuracy
97% detection rate
40% cost savings
99.99% uptime
90% reduction in compliance work

unless those numbers are actually measured by the system.

Product capability indicators are acceptable.

8. LOGO — AFTERCIRCULAR

Create a completely original AfterCircular logo.

The logo must be implemented as SVG, not as a raster image.

Logo concept

The mark should communicate:

continuous regulatory change → intelligence → controlled action

The visual concept should combine:

circular motion
continuity
transformation
structured information
an abstract "A" or circular form

Avoid overly literal imagery such as:

courthouse
shield
scales of justice
document icon
generic checkmark
generic AI brain

The logo should be abstract enough to become a recognizable product mark.

9. LOGO DESIGN LANGUAGE

Preferred characteristics:

geometric
minimal
intelligent
distinctive
scalable
monochrome first
one subtle accent color
recognizable at favicon size

The symbol should work:

alone
beside "AfterCircular"
in the navigation
in the dashboard
as favicon
as loading animation

The logo must remain recognizable when rendered at approximately:

16 × 16
24 × 24
32 × 32
48 × 48
64 × 64
10. ANIMATED SVG LOGO

Create an animated SVG version.

Suggested animation concept:

OPEN CIRCULAR ARC
       ↓
ROTATES / FLOWS
       ↓
COMPLETES THE CIRCLE
       ↓
SUBTLE PAUSE
       ↓
LOOPS

The animation should communicate continuous monitoring / continuous change.

Keep it extremely subtle.

No aggressive spinning.

No flashy morphing.

No excessive particles.

The logo should feel like enterprise infrastructure software, not a gaming logo.

Use SVG/CSS animation where practical.

Prefer CSS/SVG animation over a heavy JavaScript animation library.

Respect:

prefers-reduced-motion

When reduced motion is enabled, render the static logo.

11. LOGO FILES

Create reusable assets:

public/
└── brand/
    ├── aftercircular-mark.svg
    ├── aftercircular-mark-animated.svg
    ├── aftercircular-logo.svg
    └── aftercircular-favicon.svg

Where:

aftercircular-mark.svg

Static symbol only.

aftercircular-mark-animated.svg

Animated symbol.

aftercircular-logo.svg

Symbol + AfterCircular wordmark.

aftercircular-favicon.svg

Simplified symbol optimized for tiny sizes.

The favicon should NOT simply be a tiny full wordmark.

12. FAVICON

Set the AfterCircular mark as the actual application favicon.

Configure Next.js metadata correctly.

Support:

favicon
Apple touch icon where appropriate
Open Graph image later
metadata title
metadata description

Suggested metadata:

Title:

AfterCircular — Turn regulatory change into action.

Description:

Continuous regulatory intelligence for evidence-grounded, human-reviewed compliance action.

Do not use generic:

"AI app"

or

"Next.js app"

metadata.

13. NAVIGATION

Keep navigation extremely minimal.

Suggested:

[AfterCircular logo]

Product
How it works
Security

                         Sign in
                         Sign up

Do not overcrowd the navigation.

If the current hero design works better without a large conventional navigation bar, keep it minimal.

14. LANDING PAGE STRUCTURE

The complete landing page should eventually contain:

HERO
↓
THE PROBLEM
↓
WATCH
↓
UNDERSTAND
↓
ACT
↓
EVIDENCE
↓
MODEL INTELLIGENCE
↓
SECURITY
↓
RESPONSIBLE AI
↓
FINAL CTA
↓
FOOTER

Do not put all information into the hero.

The hero should remain visually clean.

15. PROBLEM SECTION

Explain the problem:

Regulatory teams currently have to:

monitor multiple sources
discover new publications
understand obligations
identify affected policies
determine whether existing policies conflict
coordinate review
track resulting actions

AfterCircular connects these steps.

Use concise copy.

Avoid huge walls of text.

16. HOW AFTERCIRCULAR WORKS

Show:

REGULATORY SOURCE
        ↓
NEW DOCUMENT
        ↓
OBLIGATION EXTRACTION
        ↓
AZURE AI SEARCH
        ↓
IMPACT ANALYSIS
        ↓
ALIGNED / CONFLICT
        ↓
HUMAN REVIEW
        ↓
COMPLIANCE ACTION

This should be presented as a sophisticated visual system rather than a boring flowchart.

17. EVIDENCE SECTION

Communicate:

Every important decision has an evidence trail.

Example:

REGULATORY SOURCE
SEBI Circular

        ↓

REGULATORY EVIDENCE
Section / clause

        ↓

INTERNAL POLICY
Acme policy

        ↓

IMPACT ANALYSIS

        ↓

CONFLICT DETECTED

        ↓

HUMAN REVIEW

Use fictional/sanitized demo information.

Do not make real legal claims.

18. MODEL INTELLIGENCE SECTION

AfterCircular should communicate that model choice is engineered rather than arbitrary.

Show:

QUALITY
COST
LATENCY
RELIABILITY

The actual system will evaluate available Foundry models using representative AfterCircular tasks.

Do not show fabricated benchmark results.

When real evaluation data exists, the UI can display:

model
quality
latency
cost
structured output success
tool-call success
evidence accuracy
19. RESPONSIBLE AI

Communicate the core principle:

AI detects.
AI analyzes.
AI drafts.

Humans approve.
Humans decide.

AfterCircular does not autonomously modify official company policies.

20. SECURITY

The landing page should explain the architectural principles:

tenant isolation
controlled access
private company policy data
evidence-based retrieval
controlled tools
human approval
auditability

Do not claim certifications that have not been obtained.

21. FINAL CTA

Use:

Turn regulatory change into action.

Buttons:

Sign in

Sign up

Keep the section minimal.

22. RESPONSIVE BEHAVIOR

Desktop:

large editorial hero
three cards horizontally
generous whitespace

Tablet:

preserve hierarchy
cards may become 2 + 1

Mobile:

cards stack
headline remains dominant
CTAs remain easily tappable
logo remains recognizable
no horizontal overflow
23. ACCESSIBILITY

Implement:

semantic HTML
correct heading hierarchy
keyboard navigation
visible focus states
accessible CTA labels
reduced-motion support
sufficient contrast
decorative SVGs marked appropriately
decorative videos hidden from screen readers
24. ANIMATION PRINCIPLES

Animation should communicate system behavior.

Examples:

Monitoring:
→ scanning

Analysis:
→ evidence/context moving into focus

Action:
→ approval gate

Logo:
→ continuous circular movement

Use subtle motion.

Avoid:

excessive particles
giant parallax
flashy 3D
constant movement everywhere
distracting looping effects
25. CORE BRAND MESSAGE

The visitor should understand:

AfterCircular watches regulatory changes and turns relevant changes into evidence-backed, human-reviewed compliance actions.

This sentence is the mental model for the entire landing page.

26. DESIGN QUALITY BAR

The final website should look like a serious enterprise AI product that could plausibly exist as a real startup.

It should not look like:

a university project
an AI-generated template
a generic dashboard
a chatbot clone

The design should feel intentional, restrained, technically sophisticated, and memorable.