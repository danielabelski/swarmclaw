import type {
  MissionBudget,
  MissionReportSchedule,
  MissionTemplate,
  MissionTemplateCategory,
} from '@/types'
import { DEFAULT_MISSION_WARN_FRACTIONS } from '@/types'

const HOUR = 3600
const DAY = 86_400

function budget(overrides: Partial<MissionBudget>): MissionBudget {
  return {
    maxUsd: null,
    maxTokens: null,
    maxToolCalls: null,
    maxWallclockSec: null,
    maxTurns: null,
    warnAtFractions: DEFAULT_MISSION_WARN_FRACTIONS,
    ...overrides,
  }
}

function report(intervalSec: number, format: MissionReportSchedule['format'] = 'markdown'): MissionReportSchedule {
  return { intervalSec, format, enabled: true, lastReportAt: null }
}

export const BUILT_IN_MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: 'daily-news-digest',
    name: 'Daily News Digest',
    description:
      'Scan news sources, pick the 5 most relevant stories for your interests, and write a short digest once a day.',
    icon: '📰',
    category: 'research',
    tags: ['daily', 'news', 'summary'],
    setupNote:
      'Edit the goal to list your interests and sources before starting (e.g., "AI infrastructure, open-source agents, Bloomberg / Hacker News").',
    defaults: {
      title: 'Daily News Digest',
      goal:
        'Every day, scan the latest news from my sources of interest, pick the 5 most relevant stories, and write a short markdown digest with title, 2-sentence summary, and link for each.',
      successCriteria: [
        'Exactly 5 stories per digest',
        'Each story has a title, summary, and source link',
        'Digest is less than 500 words',
      ],
      budget: budget({ maxUsd: 1, maxTokens: 40_000, maxTurns: 80, maxWallclockSec: 2 * HOUR }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'inbox-triage',
    name: 'Inbox Triage',
    description:
      'Classify new emails, draft replies to routine threads, and flag anything that needs your attention.',
    icon: '📬',
    category: 'communication',
    tags: ['email', 'triage', 'automation'],
    setupNote:
      'Connect your email connector and confirm send/reply permissions before starting this mission.',
    defaults: {
      title: 'Inbox Triage',
      goal:
        'Every hour, pull new emails, classify each as routine / needs-reply / urgent, draft replies to routine threads for my approval, and surface urgent items to me immediately.',
      successCriteria: [
        'Every new email is classified',
        'Routine replies are drafted, not sent without approval',
        'Urgent items are flagged within the same hour they arrive',
      ],
      budget: budget({ maxUsd: 3, maxTokens: 120_000, maxTurns: 200, maxWallclockSec: 12 * HOUR }),
      reportSchedule: report(6 * HOUR),
    },
  },
  {
    id: 'competitor-watch',
    name: 'Competitor Watch',
    description:
      'Track competitor websites, blogs, and releases; flag anything new and write a weekly summary.',
    icon: '🔭',
    category: 'monitoring',
    tags: ['competitive', 'weekly', 'monitoring'],
    setupNote:
      'List the competitors and specific URLs to watch in the goal field before starting.',
    defaults: {
      title: 'Competitor Watch',
      goal:
        'Check the listed competitors every 6 hours for product releases, pricing changes, blog posts, and notable social activity. Write a short summary of new signals and compile a weekly roll-up.',
      successCriteria: [
        'All listed competitors are checked every cycle',
        'New signals are captured with source links and timestamps',
        'A weekly roll-up is produced on Monday mornings',
      ],
      budget: budget({ maxUsd: 5, maxTokens: 200_000, maxTurns: 300, maxWallclockSec: 7 * DAY }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'weekly-research-report',
    name: 'Weekly Research Report',
    description:
      'Pick a research topic each Monday, dig into it across the week, and deliver a polished report by Friday.',
    icon: '🧠',
    category: 'research',
    tags: ['weekly', 'research', 'report'],
    setupNote:
      'Set the topic in the goal (or let the agent pick from a rotating list).',
    defaults: {
      title: 'Weekly Research Report',
      goal:
        'Produce a 1000-2000 word research report on the assigned topic. Gather at least 8 sources, compare viewpoints, surface open questions, and deliver a polished markdown document by end of week.',
      successCriteria: [
        'Report is between 1000 and 2000 words',
        'At least 8 distinct sources are cited with links',
        'Conclusion explicitly lists open questions or areas for follow-up',
      ],
      budget: budget({ maxUsd: 4, maxTokens: 250_000, maxTurns: 250, maxWallclockSec: 7 * DAY }),
      reportSchedule: report(2 * DAY),
    },
  },
  {
    id: 'social-listener',
    name: 'Social Listener',
    description:
      'Watch configured channels for mentions of your brand, keywords, or topics and surface notable threads.',
    icon: '👂',
    category: 'monitoring',
    tags: ['social', 'listening', 'realtime'],
    setupNote:
      'Connect Discord or Slack (or both) and list the keywords to watch for in the goal.',
    defaults: {
      title: 'Social Listener',
      goal:
        'Watch the connected channels for the configured keywords. When a match appears, capture the message, author, timestamp, and a 1-sentence context note. Summarize daily.',
      successCriteria: [
        'Every keyword match is captured with context',
        'No duplicate alerts for the same message',
        'A daily recap is produced listing the top 10 mentions',
      ],
      budget: budget({ maxUsd: 2, maxTokens: 100_000, maxTurns: 400, maxWallclockSec: 7 * DAY }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'launch-week-growth-sprint',
    name: 'Launch Week Growth Sprint',
    description:
      'Plan and run a public launch week with channel-specific copy, demo moments, feedback capture, and daily follow-up reports.',
    icon: '🚀',
    category: 'productivity',
    tags: ['launch', 'growth', 'release'],
    setupNote:
      'Set the product, audience, launch channels, and any hard no-posting boundaries in the goal. Connect social/community connectors only if you want the agent to draft posts there; keep public posting behind approval.',
    defaults: {
      title: 'Launch Week Growth Sprint',
      goal:
        'Prepare and run a one-week public launch for this project. Audit the current product and docs, write channel-specific launch assets for GitHub Releases, Product Hunt, Show HN, short social posts, and community updates, identify the top 5 demo moments, and produce a daily markdown launch report with feedback, metrics, and follow-up tasks. Do not post publicly without explicit approval.',
      successCriteria: [
        'Launch assets are drafted for GitHub Releases, Product Hunt, Show HN, social, and community channels',
        'Top demo moments and target audiences are listed with links, screenshots, or source references to use',
        'Feedback, metrics, objections, and follow-up tasks are captured in a daily launch report',
      ],
      budget: budget({ maxUsd: 4, maxTokens: 180_000, maxTurns: 220, maxWallclockSec: 7 * DAY }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'customer-support-triage',
    name: 'Customer Support Triage',
    description:
      'Classify incoming support tickets, draft first responses, and route complex issues to a human.',
    icon: '🛟',
    category: 'support',
    tags: ['support', 'triage', 'drafts'],
    setupNote:
      'Connect your helpdesk or email connector and confirm draft-only permissions before starting.',
    defaults: {
      title: 'Customer Support Triage',
      goal:
        'For each new support ticket, classify priority and category, draft a first response for human review, and flag tickets that require engineering or account-level escalation.',
      successCriteria: [
        'Every ticket receives a draft within one hour',
        'Priority and category are labeled consistently',
        'Escalations are clearly flagged with a reason',
      ],
      budget: budget({ maxUsd: 3, maxTokens: 150_000, maxTurns: 300, maxWallclockSec: 3 * DAY }),
      reportSchedule: report(12 * HOUR),
    },
  },
  {
    id: 'release-candidate-qa',
    name: 'Release Candidate QA',
    description:
      'Collect release readiness evidence across evals, approvals, failed runs, docs, packaging, and desktop smoke gates.',
    icon: '✅',
    category: 'productivity',
    tags: ['release', 'qa', 'evals', 'operator-quality'],
    setupNote:
      'Set the target version and release branch in the goal. Keep publishing, tagging, and merging behind explicit human approval.',
    defaults: {
      title: 'Release Candidate QA',
      goal:
        'Prepare a release candidate quality report for the target SwarmClaw version. Review recent failed runs, pending approvals, latest eval results, release notes, package metadata, install instructions, CI/build status, and desktop packaging notes. Summarize blockers, risk level, evidence links, and a go/no-go recommendation. Do not merge, tag, publish, deploy, or post publicly without explicit approval.',
      successCriteria: [
        'Failed runs and pending approvals are reviewed with evidence or clear no-findings notes',
        'Eval coverage, score trends, and any failed criteria are summarized',
        'Release notes, package metadata, install pins, and desktop smoke requirements are checked',
        'Final report includes blockers, risks, follow-up tasks, and a go/no-go recommendation',
      ],
      budget: budget({ maxUsd: 2, maxTokens: 120_000, maxTurns: 160, maxWallclockSec: DAY }),
      reportSchedule: report(6 * HOUR),
    },
  },
  {
    id: 'agent-cost-audit',
    name: 'Agent Cost Audit',
    description:
      'Inspect agent/provider spend, token usage, and high-cost runs, then recommend budget or routing adjustments.',
    icon: '💸',
    category: 'monitoring',
    tags: ['cost', 'usage', 'budget', 'quality'],
    setupNote:
      'Add any budget targets, providers, or agents that need special attention before starting.',
    defaults: {
      title: 'Agent Cost Audit',
      goal:
        'Audit recent SwarmClaw agent costs and token usage. Identify top-spend agents, expensive runs, provider anomalies, retry loops, and avoidable tool calls. Produce a markdown report with recommended budget caps, model routing changes, and follow-up quality checks. Do not change budgets or provider settings without approval.',
      successCriteria: [
        'Top cost drivers are listed with agent, provider, source, and supporting evidence',
        'At least 3 concrete cost-control recommendations are included',
        'Any suspected runaway, retry, or noisy automation pattern is flagged',
      ],
      budget: budget({ maxUsd: 1.5, maxTokens: 80_000, maxTurns: 100, maxWallclockSec: DAY }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'connector-smoke-test',
    name: 'Connector Smoke Test',
    description:
      'Verify configured connector health, delivery paths, approval boundaries, and recent connector-linked run evidence.',
    icon: '🔌',
    category: 'monitoring',
    tags: ['connectors', 'smoke-test', 'approval', 'quality'],
    setupNote:
      'Name the connectors and channels to test. Keep outbound messages or public replies approval-gated.',
    defaults: {
      title: 'Connector Smoke Test',
      goal:
        'Smoke test configured SwarmClaw connectors. Check connector status, recent inbound/outbound activity, approval requirements, related failed runs, and any available logs. Draft a concise pass/fail report per connector with evidence and remediation steps. Do not send public replies or change connector settings without approval.',
      successCriteria: [
        'Each targeted connector receives a pass, warn, or fail status',
        'Recent connector-linked failures or delivery issues are summarized with evidence',
        'Approval boundaries for outbound replies or sender permissions are explicitly checked',
      ],
      budget: budget({ maxUsd: 1.25, maxTokens: 70_000, maxTurns: 90, maxWallclockSec: 12 * HOUR }),
      reportSchedule: report(6 * HOUR),
    },
  },
  {
    id: 'failed-run-triage',
    name: 'Failed Run Triage',
    description:
      'Review recent failed runs, cluster root causes, and propose fixes with replay evidence.',
    icon: '🧯',
    category: 'support',
    tags: ['runs', 'triage', 'debugging', 'quality'],
    setupNote:
      'Optionally narrow the mission to a source, agent, task, or release window.',
    defaults: {
      title: 'Failed Run Triage',
      goal:
        'Triage recent failed SwarmClaw runs. Inspect run records, replay events, errors, retrieval evidence, source, owner, and timing. Cluster failures by likely root cause and write a prioritized remediation report with reproduction notes where possible. Do not modify code or settings unless explicitly asked.',
      successCriteria: [
        'Recent failed runs are grouped by likely root cause',
        'Each high-priority failure includes evidence from the run record or replay',
        'Remediation recommendations are prioritized by user impact and confidence',
      ],
      budget: budget({ maxUsd: 1.5, maxTokens: 90_000, maxTurns: 120, maxWallclockSec: DAY }),
      reportSchedule: report(6 * HOUR),
    },
  },
  {
    id: 'weekly-agent-quality-report',
    name: 'Weekly Agent Quality Report',
    description:
      'Produce a weekly operator report across eval trends, approvals, failed runs, missions, cost, and release risk.',
    icon: '📈',
    category: 'monitoring',
    tags: ['weekly', 'quality', 'report', 'evals'],
    setupNote:
      'Set the week or workspace scope in the goal if you want a narrower report.',
    defaults: {
      title: 'Weekly Agent Quality Report',
      goal:
        'Produce a weekly SwarmClaw agent quality report. Summarize eval trends, failed and recovered runs, pending or high-risk approvals, mission outcomes, cost changes, connector health, and release-readiness risks. Include a short executive summary and a prioritized action list for the next week.',
      successCriteria: [
        'Report includes eval, run, approval, mission, connector, and cost sections',
        'Top quality risks and regressions are clearly ranked',
        'Next-week action items are specific and tied to evidence',
      ],
      budget: budget({ maxUsd: 3, maxTokens: 180_000, maxTurns: 180, maxWallclockSec: 7 * DAY }),
      reportSchedule: report(DAY),
    },
  },
  {
    id: 'hello-world-demo',
    name: 'Hello World Demo',
    description:
      'A zero-cost first-run mission that summarizes the current working directory into a short markdown report. Great for first-time users to watch an agent complete a bounded task end-to-end.',
    icon: '👋',
    category: 'research',
    tags: ['demo', 'first-run', 'short'],
    setupNote:
      'No setup required. This demo mission runs in your workspace, reads a few files, and produces a short markdown summary. Best paired with a local Ollama model or any configured provider.',
    defaults: {
      title: 'Hello World Demo',
      goal:
        'List the files in the current working directory, pick the 3 that look most interesting, read a short excerpt from each, and write a markdown file `hello-world-report.md` with a one-paragraph summary of what this project appears to do. Do not modify any existing files.',
      successCriteria: [
        'Reads at least 3 files',
        'Writes hello-world-report.md with a clear one-paragraph summary',
        'Does not modify any pre-existing files',
      ],
      budget: budget({ maxUsd: 0.25, maxTokens: 20_000, maxTurns: 30, maxWallclockSec: 15 * 60 }),
      reportSchedule: report(HOUR),
    },
  },
]

const TEMPLATE_INDEX: Map<string, MissionTemplate> = new Map(
  BUILT_IN_MISSION_TEMPLATES.map((template) => [template.id, template]),
)

export function listMissionTemplates(): MissionTemplate[] {
  return BUILT_IN_MISSION_TEMPLATES.slice()
}

export function getMissionTemplate(id: string | null | undefined): MissionTemplate | null {
  if (!id || typeof id !== 'string') return null
  return TEMPLATE_INDEX.get(id.trim()) ?? null
}

export function listMissionTemplateCategories(): MissionTemplateCategory[] {
  const seen = new Set<MissionTemplateCategory>()
  for (const template of BUILT_IN_MISSION_TEMPLATES) seen.add(template.category)
  return Array.from(seen)
}
