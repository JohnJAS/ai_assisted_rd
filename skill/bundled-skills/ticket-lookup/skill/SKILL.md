---
name: ticket-lookup
description: Use when a user asks to view, query, retrieve, or summarize an SR or AR ticket by its identifier from the configured requirements-management site.
---

# Ticket Lookup

Retrieve ticket content through the configured requirements-management site. This workflow is read-only except for the bounded prefilled-login submission described below.

## Trigger

Use this skill when the user asks to view, query, retrieve, inspect, or summarize one or more SR or AR ticket identifiers, such as `SR123456` or `AR12345`.

Match identifiers case-insensitively, normalize them to uppercase, and de-duplicate them while preserving the user's order. Do not invoke this skill for unrelated text that merely contains `SR` or `AR`.

## Configuration

Resolve the requirements-management URL from the project root in this order:

1. `.agents/ticket-lookup.local.json`
2. `.agents/ticket-lookup.json`

Each file has this schema:

```json
{
  "requirement_management_url": "https://requirements.example.internal",
  "allow_prefilled_login_submit": true
}
```

The shared `.agents/ticket-lookup.json` is team configuration and may be committed. `.agents/ticket-lookup.local.json` is an optional machine-specific override. Before creating the local override, ask for approval to add `.agents/ticket-lookup.local.json` to the target project's `.gitignore`.

The local file replaces the shared file's `requirement_management_url`. `allow_prefilled_login_submit` defaults to `true`; set it to `false` when this project requires manual login. Never hard-code a requirements-management URL in this skill. Do not store credentials, cookies, tokens, browser-profile paths, or personal account information in either configuration file.

Stop and report the required file and field when neither configuration file provides an absolute `http://` or `https://` `requirement_management_url`.

## Site Knowledge

Parse the configured URL with a URL parser and normalize its hostname to lowercase as `<host>`. Before browsing, read site knowledge in this order when the paths exist:

1. `.agents/sitemaps/<host>/`
2. `.agents/ticket-lookup/sites/<host>.md`

The sitemap is an optional externally maintained navigation asset. The Markdown file is shared project knowledge and may be committed; create it from `references/site-knowledge-template.md` when needed. Keep hosts isolated: never use one site's paths, selectors, APIs, or limitations for another host.

Apply the resolved project `knowledge_asset_write_mode` when it is available. If no current request or shared `.agents/agent-seed.json` mode exists, report `mode-selection-required` and ask the owner to run Agent Seed first-run setup; do not choose a fallback mode inside ticket-lookup. With `full-access`, update the site file after a successful lookup. With `agent-approve`, update it after the owner has confirmed the lookup scope. With `ask-each-change`, ask before creating or editing it.

Record only durable navigation paths, UI behavior, API shapes, parsing requirements, and reproducible limitations. Prefix every entry with `Observed`, `Verified`, or `Inferred`. Do not record ticket content, ticket body text, credentials, cookies, tokens, personal account data, or one-off incident details.

## Lookup Workflow

1. Identify the requested SR and AR ticket identifiers.
2. Resolve the configured URL before opening a browser.
3. Parse the configured URL, derive `<host>`, and read its sitemap and site knowledge file before exploring the UI.
4. Confirm that the configured browser-automation skill is available. When it is missing, explain that browser retrieval depends on the configured external integration and request approval to follow its installation flow. Do not mark the ticket as read.
5. Use the configured browser-automation skill to open the configured URL. Reuse an authenticated browser session when available. Do not install an extension, configure the browser, or type credentials.
6. If the site shows a login page and `allow_prefilled_login_submit` is `true` (the default), and the browser visibly shows the username and password fields already populated, click the site's login button once without reading or filling either value. If the option is `false`, stop and ask the user to log in. Do not retry. Hand MFA, CAPTCHA, consent, or any unexpected page to the user.
7. Search the visible site UI for each requested identifier and extract the content relevant to the user's question.
8. After each successful lookup, add only newly learned reusable site knowledge to `.agents/ticket-lookup/sites/<host>.md` using the resolved write mode and provenance labels. Do not duplicate existing entries.
9. Report found, not-found, inaccessible, and browser/session failures separately for each ticket.

## Safety

Only perform read-only browser actions except for the single prefilled-login button click allowed above. Do not create, edit, comment on, transition, submit, delete, or otherwise modify ticket data. Never read, copy, log, or transmit credential values.
